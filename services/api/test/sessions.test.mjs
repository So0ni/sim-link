import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';
import { initializeAdmin } from '../src/modules/auth/credentials.mjs';
import { openStore } from '../src/platform/store.mjs';
import { createAuthService, sessionName } from '../src/modules/auth/service.mjs';
const origin = 'https://sim.example.test';
const password = 'fictional-session-password';
async function login(app, ua) {
  const response = await app.inject({ method:'POST', url:'/api/v1/auth/login', headers:{origin,'user-agent':ua}, payload:{password} });
  assert.equal(response.statusCode,200);
  return {origin, cookie:response.headers['set-cookie'].split(';')[0], 'x-csrf-token':response.json().csrfToken, 'user-agent':ua};
}
const list = async (app, headers) => (await app.inject({url:'/api/v1/auth/sessions', headers})).json().sessions;

test('session list timestamps, current marker, foreground-only activity, CSRF and revocation isolation', async t => {
  let stamp=100000;
  const app=createApp({origin,now:()=>stamp}); t.after(()=>app.close());
  await initializeAdmin(app.store,password);
  assert.equal((await app.inject('/api/v1/auth/sessions')).statusCode,401);
  const first=await login(app,'Mozilla/5.0 (iPhone) Version/18 Safari/605');
  stamp+=1000;
  const second=await login(app,'Mozilla/5.0 (Windows) Chrome/130');
  const entries=await list(app,first);
  assert.equal(entries[0].current,true);
  assert.equal(entries[0].name,'iPhone · Safari');
  assert.equal(entries[0].createdAt,100000);
  assert.equal(entries[0].lastActiveAt,100000);
  assert.equal(entries[1].current,false);
  assert.equal(entries[1].name,'Windows · Chrome');
  assert.equal(Object.hasOwn(entries[0],'hash'),false);
  stamp+=1000;
  await app.inject({url:'/api/v1/messages',headers:first});
  assert.equal((await list(app,first))[0].lastActiveAt,100000);
  await app.inject({method:'POST',url:'/api/v1/auth/resume',headers:first});
  assert.equal((await list(app,first))[0].lastActiveAt,stamp);
  assert.equal((await list(app,first))[0].createdAt,100000);
  const target=entries[1].id;
  app.store.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?)').run('sub',target,'https://fcm.googleapis.com/fictional','key','auth',stamp);
  app.store.prepare('INSERT INTO devices(id,name,token_hash,created_at) VALUES(?,?,?,?)').run('gateway','Test gateway','fake-hash',stamp);
  const url=`/api/v1/auth/sessions/${target}`;
  assert.equal((await app.inject({method:'DELETE',url,headers:{origin,cookie:first.cookie}})).statusCode,403);
  assert.equal((await app.inject({method:'DELETE',url,headers:{...first,origin:'https://evil.test'}})).statusCode,403);
  assert.equal((await app.inject({method:'DELETE',url,headers:first})).statusCode,200);
  assert.equal((await list(app,first)).length,1);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/resume',headers:second})).statusCode,401);
  assert.equal(app.store.prepare('SELECT count(*) n FROM push_subscriptions').get().n,0);
  assert.equal(app.store.prepare('SELECT count(*) n FROM devices').get().n,1);
  assert.equal(app.store.prepare('SELECT count(*) n FROM session_details').get().n,1);
  stamp+=91*86400000;
  assert.equal((await app.inject({url:'/api/v1/auth/sessions',headers:first})).statusCode,401);
});

test('v8 sessions migrate without invented login dates; resume persists and never revives a revoked session', async t => {
  const dir=mkdtempSync(join(tmpdir(),'simlink-sessions-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'db');let db=openStore(path);
  await initializeAdmin(db,password);
  let stamp=100000;let auth=createAuthService(db,()=>stamp);
  const raw=await auth.login(password,'Firefox/130');
  db.exec('DROP TABLE session_details; PRAGMA user_version=8;');db.close();
  db=openStore(path);auth=createAuthService(db,()=>stamp);
  const session=auth.read(raw);
  assert.equal(auth.list(session.id)[0].createdAt,null);
  assert.equal(auth.list(session.id)[0].lastActiveAt,null);
  stamp+=1000;auth.resume(session,'Firefox/130');
  assert.equal(auth.list(session.id)[0].createdAt,null);
  assert.equal(auth.list(session.id)[0].lastActiveAt,stamp);
  db.close();db=openStore(path);t.after(()=>db.close());auth=createAuthService(db,()=>stamp);
  assert.equal(auth.list(session.id)[0].lastActiveAt,stamp);
  auth.revoke(session.id);
  assert.throws(()=>auth.resume(session),/session_expired/);
  assert.equal(auth.list(session.id).length,0);
});

test('device descriptions use coarse names instead of storing arbitrary User-Agent data',()=>{
  assert.equal(sessionName('personal-device-secret <script>'),'未知系统 · 浏览器');
  assert.equal(sessionName('Mozilla (Android) Chrome/130 EdgA/130'),'Android · Edge');
});
