import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const project = `simlink-check-${process.pid}`;
const port = process.env.SIMLINK_TEST_PORT ?? '18788';
const origin = `http://localhost:${port}`;
const env = { ...process.env, PUBLIC_ORIGIN: origin, ALLOW_INSECURE_LOCAL: '1', SIMLINK_PORT: port };
function compose(args, input) {
  const result = spawnSync('docker', ['compose', '-p', project, ...args], { cwd, env, input, encoding: 'utf8', timeout: 300000 });
  if (result.status !== 0) throw new Error(`Compose ${args[0]} failed: ${result.stderr ?? result.error}`);
  return result;
}
let headers;
async function request(path, method = 'GET', body, requestHeaders = headers) {
  const response = await fetch(`${origin}${path}`, { method, headers: { connection: 'close', ...requestHeaders, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, 200, `${method} ${path}`);
  return { response, body: await response.json() };
}
try {
  compose(['up', '-d', '--build', '--wait']);
  const page = await fetch(`${origin}/`, { headers: { connection: 'close' } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length >= 2, 'bundled JS and CSS');
  for (const asset of assets) assert.equal((await fetch(`${origin}${asset}`, { headers: { connection: 'close' } })).status, 200);
  assert.equal((await fetch(`${origin}/api/v1/messages`, { headers: { connection: 'close' } })).status, 401);
  const password = randomBytes(24).toString('base64url');
  compose(['exec', '-T', 'api', 'node', 'src/admin.mjs'], password);
  const login = await request('/api/v1/auth/login', 'POST', { password }, { origin });
  headers = { origin, cookie: login.response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': login.body.csrfToken };
  const invitation = (await request('/api/v1/pairings', 'POST')).body;
  const device = (await request('/api/v1/device/pair', 'POST', { pairingToken: invitation.pairingToken, name: 'Compose smoke test', apiVersion: 1 }, {})).body;
  const event = { eventId: 'compose-fictional-1', sender: 'Example', body: 'Fictional compose test', subscriptionId: null, receivedAt: Date.now() };
  const deviceHeaders = { authorization: `Bearer ${device.deviceToken}` };
  await request('/api/v1/device/messages', 'POST', event, deviceHeaders);
  compose(['up', '-d', '--force-recreate', '--wait']);
  await request('/api/v1/auth/session');
  const replay = await request('/api/v1/device/messages', 'POST', event, deviceHeaders);
  assert.equal(replay.body.duplicate, true);
  assert.equal((await request('/api/v1/messages')).body.messages.length, 1);
  console.info('Compose passed: bundled UI/assets, private API, initialize, authenticate, pair, ingest, recreate, persist session, deduplicate.');
} finally {
  // This unique project contains only test-created credentials and fictional messages.
  compose(['down', '-v']);
}
