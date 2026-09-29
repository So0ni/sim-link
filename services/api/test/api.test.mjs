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

test('LAN HTTP requires explicit opt-in, uses non-Secure dev cookies and still enforces Origin', async t => {
  assert.throws(() => createApp({ origin: 'http://192.168.1.10:8787' }), /HTTPS/);
  const lan = 'http://192.168.1.10:8787';
  const app = createApp({ origin: lan, insecureHttp: true });
  t.after(() => app.close());
  await initializeAdmin(app.store, password);
  const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: lan }, payload: { password } });
  assert.equal(result.statusCode, 200);
  assert.match(result.headers['set-cookie'], /^simlink-local=/);
  assert.doesNotMatch(result.headers['set-cookie'], /; Secure/);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'http://other.test' }, payload: { password } })).statusCode, 403);
});


test('one-time pairing secret is not a device credential; independent device token survives invitation expiry', async t => {
  let stamp = 1000000;
  const { app, headers } = await fixture(t, { now: () => stamp });
  const device = await pair(app, headers);
  assert.notEqual(device.deviceToken, device.payload.pairingToken);
  assert.match(device.deviceToken, /^[A-Za-z0-9_-]{43}$/);
  const stored = app.store.prepare('SELECT token_hash FROM devices WHERE id=?').get(device.deviceId);
  assert.notEqual(stored.token_hash, device.deviceToken);
  const upload = token => app.inject({ method: 'POST', url: '/api/v1/device/messages', headers: { authorization: `Bearer ${token}` }, payload: event });
  assert.equal((await upload(device.payload.pairingToken)).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/device/pair', payload: device.payload })).statusCode, 400);
  stamp += 300001;
  assert.equal((await upload(device.deviceToken)).statusCode, 200);
  const second = await pair(app, headers);
  assert.notEqual(second.deviceToken, device.deviceToken);
  await app.inject({ method: 'DELETE', url: `/api/v1/devices/${device.deviceId}`, headers });
  assert.equal((await upload(device.deviceToken)).statusCode, 401);
  assert.equal((await upload(second.deviceToken)).statusCode, 200);
});

test('heartbeats use server time; unpair removes device but preserves messages and invalidates credentials', async t => {
  let stamp = 1000000;
  const { app, headers } = await fixture(t, { now: () => stamp });
  const device = await pair(app, headers);
  const auth = { authorization: `Bearer ${device.deviceToken}` };
  const list = async () => (await app.inject({ url: '/api/v1/devices', headers })).json().devices;
  assert.equal((await list())[0].presence, 'unknown');
  assert.equal((await app.inject({ method:'POST',url:'/api/v1/device/heartbeat',payload:{} })).statusCode,401);
  const beat = () => app.inject({ method:'POST',url:'/api/v1/device/heartbeat',headers:auth,payload:{} });
  assert.equal((await beat()).json().receivedAt,stamp);
  assert.equal((await list())[0].presence,'online');
  stamp += 35 * 60000 + 1;
  assert.equal((await list())[0].presence,'offline');
  await beat();
  assert.equal((await list())[0].presence,'online');
  await app.inject({method:'POST',url:'/api/v1/device/messages',headers:auth,payload:event});
  assert.equal((await app.inject({method:'POST',url:'/api/v1/device/unpair',headers:auth,payload:{}})).statusCode,200);
  assert.deepEqual(await list(),[]);
  assert.equal(app.store.prepare('SELECT count(*) AS n FROM devices').get().n,0);
  assert.equal((await beat()).statusCode,401);
  assert.equal((await app.inject({url:'/api/v1/messages',headers})).json().messages.length,1);
});

test('v1 migration removes revoked devices without losing SMS IDs or active credentials', async t => {
  const { default: Database } = await import('better-sqlite3');
  const { openStore } = await import('../src/platform/store.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'simlink-migrate-'));
  t.after(() => rmSync(folder,{recursive:true,force:true}));
  const path = join(folder,'old.sqlite');
  const db = new Database(path);
  db.exec(`CREATE TABLE pairings(hash TEXT PRIMARY KEY,expires_at INTEGER);
    CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,token_hash TEXT,created_at INTEGER,revoked_at INTEGER);
    CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,device_id TEXT REFERENCES devices(id),event_id TEXT,sender TEXT,body TEXT,subscription_id INTEGER,received_at INTEGER,synced_at INTEGER,UNIQUE(device_id,event_id));
    INSERT INTO devices VALUES('old','Old','hash-old',1,2),('live','Live','hash-live',1,NULL);
    INSERT INTO messages VALUES(7,'old','event','Example','Fictional',1,1,2);
    PRAGMA user_version=1;`);
  db.close();
  const migrated = openStore(path);
  try {
    assert.equal(migrated.pragma('user_version',{simple:true}),7);
    assert.deepEqual(migrated.prepare('SELECT id,token_hash,last_seen_at FROM devices').all(),[{id:'live',token_hash:'hash-live',last_seen_at:null}]);
    assert.equal(migrated.prepare('SELECT device_id FROM messages WHERE sequence=7').get().device_id,'old');
    assert.deepEqual(migrated.prepare('SELECT is_read,read_version FROM messages WHERE sequence=7').get(), {is_read:0,read_version:0});
    assert.deepEqual(migrated.pragma('foreign_key_check'),[]);
    migrated.prepare("INSERT INTO messages(device_id,event_id,sender,body,received_at,synced_at) VALUES('live','next','Example','Fictional',1,2)").run();
    assert.equal(migrated.prepare('SELECT MAX(sequence) AS n FROM messages').get().n,8);
  } finally { migrated.close(); }
});

test('SIM inventory keeps names/numbers, rejects reused mappings, and preserves historical message identity', async t => {
  const { app, headers } = await fixture(t);
  const device = await pair(app, headers);
  const auth = { authorization: `Bearer ${device.deviceToken}` };
  const key = '00000000-0000-4000-8000-000000000001';
  const sim = { key, subscriptionId: 1, slotIndex: 0, carrier: 'Fictional Mobile' };
  const report = payload => app.inject({ method: 'POST', url: '/api/v1/device/sims', headers: auth, payload });
  const list = async () => (await app.inject({ url: '/api/v1/sims', headers })).json().sims;
  assert.equal((await app.inject('/api/v1/sims')).statusCode, 401);
  assert.equal((await report({ status: 'available', sims: [sim, sim] })).statusCode, 400);
  assert.equal((await report({ status: 'available', sims: [sim] })).statusCode, 200);
  const initial = (await list())[0];
  const update = { method: 'PATCH', url: `/api/v1/sims/${initial.id}`, headers, payload: { name: 'Backup', phoneNumber: '+1 (202) 555-0100' } };
  assert.equal((await app.inject({ ...update, headers: { cookie: headers.cookie, origin } })).statusCode, 403);
  assert.equal((await app.inject(update)).statusCode, 200);
  assert.equal((await app.inject({ ...update, payload: { name: 'Backup', phoneNumber: 'bad-number' } })).statusCode, 400);
  assert.equal((await report({ status: 'available', sims: [sim] })).statusCode, 200);
  assert.equal((await list())[0].phoneNumber, '+12025550100');
  assert.equal((await list())[0].name, 'Backup');
  assert.equal((await report({ status: 'available', sims: [{ ...sim, slotIndex: 1 }] })).statusCode, 409);
  assert.equal((await list())[0].state, 'active'); // rollback all status changes
  const upload = { method: 'POST', url: '/api/v1/device/messages', headers: auth, payload: { ...event, simKey: key } };
  assert.equal((await app.inject(upload)).statusCode, 200);
  const replacementKey = '00000000-0000-4000-8000-000000000002';
  assert.equal((await report({ status: 'available', sims: [{ ...sim, key: replacementKey }] })).statusCode, 200);
  assert.equal((await list())[0].state, 'inactive');
  assert.equal((await list())[1].name, '');
  assert.equal((await list())[1].phoneNumber, '');
  assert.equal((await app.inject(upload)).json().duplicate, true);
  assert.equal((await app.inject({ ...upload, payload: { ...event, simKey: replacementKey } })).statusCode, 409);
  assert.equal((await report({ status: 'permission_required', sims: [] })).statusCode, 200);
  assert.equal((await list())[1].state, 'unknown');
  assert.equal((await report({ status: 'available', sims: [] })).statusCode, 200);
  assert.equal((await list())[1].state, 'inactive');
  await app.inject({ method: 'DELETE', url: `/api/v1/devices/${device.deviceId}`, headers });
  assert.equal((await list())[0].state, 'detached');
  assert.equal((await list())[0].name, 'Backup');
  assert.equal((await app.inject({ url: '/api/v1/messages', headers })).json().messages[0].simKey, key);
  assert.equal((await report({ status: 'available', sims: [sim] })).statusCode, 401);
});

test('installation claims require an existing credential; recovery needs a targeted admin invitation and rotates credentials', async t => {
  const { app, headers } = await fixture(t);
  const old = await pair(app, headers);
  const installationId = '00000000-0000-4000-8000-000000000011';
  const auth = { authorization: `Bearer ${old.deviceToken}` };
  const identity = { method:'POST', url:'/api/v1/device/identity', headers:auth, payload:{installationId,deviceId:old.deviceId} };
  assert.equal((await app.inject({...identity,headers:{}})).statusCode,401);
  assert.equal((await app.inject({...identity,payload:{...identity.payload,deviceId:'wrong'}})).statusCode,409);
  const claimed = await app.inject(identity);
  assert.equal(claimed.statusCode,200);
  assert.equal(claimed.json().deviceId,old.deviceId);
  const serverId = claimed.json().serverId;
  assert.equal((await app.inject({...identity,payload:{...identity.payload,serverId}})).statusCode,200);
  assert.equal((await app.inject({...identity,payload:{...identity.payload,serverId:'00000000-0000-4000-8000-000000000099'}})).statusCode,409);
  assert.equal((await app.inject({...identity,payload:{...identity.payload,installationId:'00000000-0000-4000-8000-000000000012'}})).statusCode,409);
  await app.inject({method:'POST',url:'/api/v1/device/messages',headers:auth,payload:event});
  await app.inject({method:'POST',url:'/api/v1/device/sims',headers:auth,payload:{status:'available',sims:[{key:'00000000-0000-4000-8000-000000000033',subscriptionId:1,slotIndex:0,carrier:'Test'}]}});
  const simId = (await app.inject({url:'/api/v1/sims',headers})).json().sims[0].id;
  await app.inject({method:'PATCH',url:`/api/v1/sims/${simId}`,headers,payload:{name:'Backup',phoneNumber:'+12025550100'}});
  const generic = (await app.inject({method:'POST',url:'/api/v1/pairings',headers})).json();
  const pairing = {method:'POST',url:'/api/v1/device/pair',payload:{pairingToken:generic.pairingToken,name:'Different label',apiVersion:1,installationId}};
  assert.equal((await app.inject(pairing)).statusCode,409);
  const recoveryRequest = {method:'POST',url:`/api/v1/devices/${old.deviceId}/pairing`,headers};
  assert.equal((await app.inject({...recoveryRequest,headers:{origin,cookie:headers.cookie}})).statusCode,403);
  const invite = (await app.inject(recoveryRequest)).json();
  const recover = {...pairing,payload:{...pairing.payload,pairingToken:invite.pairingToken}};
  assert.equal((await app.inject({...recover,payload:{...recover.payload,installationId:'00000000-0000-4000-8000-000000000012'}})).statusCode,409);
  const result = await app.inject(recover);
  assert.equal(result.statusCode,200);
  assert.equal(result.json().deviceId,old.deviceId);
  assert.equal(result.json().serverId,serverId);
  assert.notEqual(result.json().deviceToken,old.deviceToken);
  assert.equal((await app.inject(identity)).statusCode,401);
  assert.equal((await app.inject(recover)).statusCode,400);
  const active = (await app.inject({url:'/api/v1/devices',headers})).json().devices;
  assert.equal(active.length,1);
  assert.equal(active[0].name,'Test gateway');
  assert.equal((await app.inject({url:'/api/v1/sims',headers})).json().sims[0].phoneNumber,'+12025550100');
  assert.equal((await app.inject({url:'/api/v1/messages',headers})).json().messages[0].deviceId,old.deviceId);
  // Unpair removes active credentials but retains a separately recoverable installation identity.
  await app.inject({method:'DELETE',url:`/api/v1/devices/${old.deviceId}`,headers});
  assert.deepEqual((await app.inject({url:'/api/v1/devices',headers})).json().devices,[]);
  assert.equal((await app.inject({url:'/api/v1/devices/recoverable',headers})).json().devices[0].id,old.deviceId);
  const retiredInvite = (await app.inject(recoveryRequest)).json();
  const restored = await app.inject({...recover,payload:{...recover.payload,pairingToken:retiredInvite.pairingToken}});
  assert.equal(restored.statusCode,200);
  assert.equal(restored.json().deviceId,old.deviceId);
  assert.deepEqual((await app.inject({url:'/api/v1/devices/recoverable',headers})).json().devices,[]);
});

test('reading changes authenticate admins, compare versions and sync old messages independently', async t => {
  const { app, headers } = await fixture(t);
  const device = await pair(app, headers);
  const auth = { authorization: `Bearer ${device.deviceToken}` };
  await app.inject({method:'POST',url:'/api/v1/device/messages',headers:auth,payload:event});
  const loginB = await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{password}});
  const b = {cookie:loginB.headers['set-cookie'].split(';')[0],origin,'x-csrf-token':loginB.json().csrfToken};
  const patch = (h, messages, isRead) => app.inject({method:'PATCH',url:'/api/v1/messages/reading',headers:h,payload:{messages,isRead}});
  const initial = [{sequence:1,readVersion:0}];
  for (const [h,status] of [[{origin},401],[{...auth,origin},401],[{...headers,'x-csrf-token':'bad'},403],[{...headers,origin:'https://evil.test'},403]]) {
    assert.equal((await patch(h,initial,true)).statusCode,status);
  }
  assert.equal((await app.inject('/api/v1/messages/reading')).statusCode,401);
  const first = (await patch(headers,initial,true)).json();
  assert.deepEqual(first,{states:[{sequence:1,isRead:true,readVersion:1}],conflicts:[]});
  assert.deepEqual((await app.inject({url:'/api/v1/messages/reading?after=0',headers:b})).json().states,first.states);
  const unread = (await patch(b,[{sequence:1,readVersion:1}],false)).json();
  assert.equal(unread.states[0].readVersion,2);
  const stale = (await patch(headers,initial,true)).json();
  assert.deepEqual(stale,{states:unread.states,conflicts:[1]});
  await app.inject({method:'POST',url:'/api/v1/device/messages',headers:auth,payload:{...event,eventId:'later'}});
  assert.equal((await app.inject({url:'/api/v1/messages?after=1',headers})).json().messages[0].isRead,false);
  assert.deepEqual((await app.inject({url:'/api/v1/messages/reading?after=1',headers})).json().states,unread.states);
  assert.equal((await patch(headers,[{sequence:99,readVersion:0}],true)).statusCode,404);
  assert.equal((await patch(headers,[...initial,...initial],true)).statusCode,400);
  assert.equal((await app.inject({url:'/api/v1/messages/reading?after=-1',headers})).statusCode,400);
});

test('reading pagination tolerates rows moving ahead; state and clock persist on restart', async t => {
  const dir = mkdtempSync(join(tmpdir(),'simlink-reading-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const database = join(dir,'test.sqlite');
  let app = createApp({origin,database});
  await initializeAdmin(app.store,password);
  const login = await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{password}});
  const headers = {origin,cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrfToken};
  const device = await pair(app,headers);
  for (let i=0;i<105;i++) await app.inject({method:'POST',url:'/api/v1/device/messages',headers:{authorization:`Bearer ${device.deviceToken}`},payload:{...event,eventId:`fictional-${i}`}});
  const patch = (messages,isRead) => app.inject({method:'PATCH',url:'/api/v1/messages/reading',headers,payload:{messages,isRead}});
  await patch(Array.from({length:100},(_,i)=>({sequence:i+1,readVersion:0})),true);
  await patch(Array.from({length:5},(_,i)=>({sequence:i+101,readVersion:0})),true);
  const first = (await app.inject({url:'/api/v1/messages/reading?after=0',headers})).json();
  assert.equal(first.states.length,100);
  await patch([{sequence:1,readVersion:1}],false);
  const next = (await app.inject({url:`/api/v1/messages/reading?after=${first.nextCursor}`,headers})).json();
  assert.deepEqual(next.states.map(s=>s.sequence),[101,102,103,104,105,1]);
  await app.close();
  app = createApp({origin,database});
  try {
    assert.equal((await app.inject({url:'/api/v1/messages',headers})).json().messages[0].isRead,false);
    assert.equal((await patch([{sequence:1,readVersion:106}],true)).json().states[0].readVersion,107);
  } finally { await app.close(); }
});
