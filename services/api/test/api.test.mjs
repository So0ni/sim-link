import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';
import { initializeAdmin } from '../src/modules/auth/credentials.mjs';
const origin = 'https://sim.example.test';
const password = 'fictional-test-password';
const event = { eventId: 'test-event-1', sender: 'Example', body: 'Fictional message', subscriptionId: 1, receivedAt: 1000 };
async function fixture(t, options = {}) {
  const app = createApp({ origin, ...options });
  t.after(() => app.close());
  await initializeAdmin(app.store, password);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { password } });
  assert.equal(login.statusCode, 200);
  const headers = { origin, cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().csrfToken };
  return { app, headers, login };
}
async function pair(app, headers) {
  const invitation = await app.inject({ method: 'POST', url: '/api/v1/pairings', headers });
  assert.equal(invitation.statusCode, 200);
  const payload = { pairingToken: invitation.json().pairingToken, name: 'Test gateway', apiVersion: 1 };
  const response = await app.inject({ method: 'POST', url: '/api/v1/device/pair', payload });
  assert.equal(response.statusCode, 200);
  return { ...response.json(), payload };
}

test('private routes require separate browser and device credentials; CSRF and Origin enforced', async t => {
  const { app, headers, login } = await fixture(t);
  assert.match(login.headers['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=7776000; Secure/);
  for (const url of ['/api/v1/messages', '/api/v1/devices', '/api/v1/auth/session']) assert.equal((await app.inject(url)).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/pairings', headers: { ...headers, origin: 'https://evil.test' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/pairings', headers: { cookie: headers.cookie, origin } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/device/messages', headers, payload: event })).statusCode, 401);
  const device = await pair(app, headers);
  assert.equal((await app.inject({ url: '/api/v1/messages', headers: { authorization: `Bearer ${device.deviceToken}` } })).statusCode, 401);
});

test('pairing consumption is atomic under competing requests and expires', async t => {
  let stamp = 1000000;
  const { app, headers } = await fixture(t, { now: () => stamp });
  const invitation = (await app.inject({ method: 'POST', url: '/api/v1/pairings', headers })).json();
  const request = { method: 'POST', url: '/api/v1/device/pair', payload: { pairingToken: invitation.pairingToken, name: 'Test', apiVersion: 1 } };
  assert.deepEqual((await Promise.all([app.inject(request), app.inject(request)])).map(r => r.statusCode).sort(), [200, 400]);
  const expiring = (await app.inject({ method: 'POST', url: '/api/v1/pairings', headers })).json();
  stamp += 300000;
  assert.equal((await app.inject({ ...request, payload: { ...request.payload, pairingToken: expiring.pairingToken } })).statusCode, 400);
});

test('upload replay ACKs same row, conflicts reject, cursor and device scoping preserve data', async t => {
  const { app, headers } = await fixture(t);
  const device = await pair(app, headers);
  const upload = { method: 'POST', url: '/api/v1/device/messages', headers: { authorization: `Bearer ${device.deviceToken}` }, payload: event };
  const results = await Promise.all([app.inject(upload), app.inject(upload)]);
  assert.deepEqual(results.map(r => r.json().duplicate).sort(), [false, true]);
  assert.equal(results[0].json().sequence, results[1].json().sequence);
  assert.equal((await app.inject({ ...upload, payload: { ...event, body: 'Changed content' } })).statusCode, 409);
  const second = await pair(app, headers);
  assert.equal((await app.inject({ ...upload, headers: { authorization: `Bearer ${second.deviceToken}` } })).statusCode, 200);
  const list = await app.inject({ url: '/api/v1/messages', headers });
  assert.equal(list.headers['cache-control'], 'no-store');
  assert.equal(list.json().messages.length, 2);
  assert.equal((await app.inject({ url: `/api/v1/messages?after=${list.json().nextCursor}`, headers })).json().messages.length, 0);
  await app.inject({ method: 'DELETE', url: `/api/v1/devices/${device.deviceId}`, headers });
  assert.equal((await app.inject(upload)).statusCode, 401);
});

test('sessions persist across reopen; logout cannot be undone by resume', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'simlink-api-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, 'test.sqlite');
  let app = createApp({ origin, database });
  await initializeAdmin(app.store, password);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { password } });
  const headers = { origin, cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().csrfToken };
  const device = await pair(app, headers);
  await app.inject({ method: 'POST', url: '/api/v1/device/messages', headers: { authorization: `Bearer ${device.deviceToken}` }, payload: event });
  await app.close();
  app = createApp({ origin, database });
  try {
    assert.equal((await app.inject({ url: '/api/v1/auth/session', headers })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/v1/messages', headers })).json().messages.length, 1);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/resume', headers })).statusCode, 401);
  } finally { await app.close(); }
});

test('only explicit foreground resume slides expiry; revoked sessions stay revoked', async t => {
  let stamp = 1000000;
  const { app, headers } = await fixture(t, { now: () => stamp });
  const first = (await app.inject({ url: '/api/v1/auth/session', headers })).json();
  stamp += 86400001;
  assert.equal((await app.inject({ url: '/api/v1/auth/session', headers })).json().expiresAt, first.expiresAt);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/resume', headers })).statusCode, 200);
  assert.ok((await app.inject({ url: '/api/v1/auth/session', headers })).json().expiresAt > first.expiresAt);
  await app.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${first.id}`, headers });
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/resume', headers })).statusCode, 401);
});

test('expired sessions cannot renew', async t => {
  let stamp = 1000000;
  const { app, headers } = await fixture(t, { now: () => stamp });
  stamp += 90 * 86400000;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/resume', headers })).statusCode, 401);
});

test('pairing attempts are rate limited and malformed payloads rejected', async t => {
  const { app, headers } = await fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/v1/device/pair', payload: { pairingToken: 'x'.repeat(43), name: 'Test', apiVersion: 1 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/device/pair', payload: { pairingToken: 'x'.repeat(43), name: 'Test', apiVersion: 1 } })).statusCode, 429);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { password, extra: true } })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/v1/messages?after=-1', headers })).statusCode, 400);
});

test('unsafe public HTTP origin is rejected', () => {
  assert.throws(() => createApp({ origin: 'http://example.com', insecureLocal: true }), /HTTPS/);
});
