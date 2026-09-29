import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../src/platform/store.mjs';
import { createPushService } from '../src/modules/push/service.mjs';
import { createInboxService } from '../src/modules/inbox/service.mjs';
import { createApp } from '../src/app.mjs';
import { initializeAdmin } from '../src/modules/auth/credentials.mjs';
function subscription() {const curve=createECDH('prime256v1');return {endpoint:'https://fcm.googleapis.com/fcm/send/fictional',keys:{p256dh:curve.generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')}};}
function fixture(t){const db=openStore(':memory:');t.after(()=>db.close());let stamp=10000000;const session={id:'test-session'};db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('hash',session.id,stamp+86400000,stamp);let sender=async()=>{};const push=createPushService(db,()=>stamp,'https://sim.test',(...args)=>sender(...args));const inbox=createInboxService(db,()=>stamp,push.enqueueMessage);return {db,session,push,inbox,advance:n=>stamp+=n,now:()=>stamp,setSender:fn=>sender=fn};}
test('atomic outbox, duplicate and old upload suppression; notification includes sender but never SMS body',async t=>{
 const f=fixture(t);const {id}=f.push.subscribe(f.session,subscription());const deliveries=[];f.setSender(async(...args)=>deliveries.push(args));
 const body={eventId:'new',sender:'+12025550123',body:'TEST ONLY private body',subscriptionId:1,receivedAt:f.now()};
 f.inbox.receive({id:'device'},body);f.inbox.receive({id:'device'},body);f.inbox.receive({id:'device'},{...body,eventId:'old',receivedAt:f.now()-3600001});
 assert.equal(f.db.prepare('SELECT count(*) n FROM push_jobs').get().n,1);await Promise.all([f.push.drain(),f.push.drain()]);assert.equal(deliveries.length,1);
 const payload=JSON.parse(deliveries[0][1]);assert.match(payload.body,/12025550123/);assert.ok(!deliveries[0][1].includes(body.body));assert.deepEqual(JSON.parse(decodeURIComponent(payload.url.split('/inbox/')[1])),['device',1,body.sender]);assert.equal(f.push.status(f.session).subscriptions[0].lastDelivery.state,'accepted');
 f.push.remove(f.session,id);assert.equal(f.db.prepare('SELECT count(*) n FROM push_jobs').get().n,0);
 const rollback=createInboxService(f.db,f.now,()=>{throw Error('queue failure');});assert.throws(()=>rollback.receive({id:'device'},{...body,eventId:'rollback'}));assert.equal(f.db.prepare("SELECT count(*) n FROM messages WHERE event_id='rollback'").get().n,0);
});
test('retry backoff, expiry, dead subscriptions and logout cleanup',async t=>{
 const f=fixture(t);let calls=0;f.setSender(async()=>{calls++;throw {statusCode:503};});const {id}=f.push.subscribe(f.session,subscription());f.push.test(f.session,id);await f.push.drain();assert.equal(calls,1);await f.push.drain();assert.equal(calls,1);f.advance(30000);await f.push.drain();assert.equal(calls,2);f.advance(3600000);await f.push.drain();assert.equal(calls,2);assert.equal(f.push.status(f.session).subscriptions[0].lastDelivery.state,'expired');
 f.push.test(f.session,id);f.setSender(async()=>{throw {statusCode:410};});await f.push.drain();assert.equal(f.push.status(f.session).subscriptions.length,0);const next=f.push.subscribe(f.session,subscription());f.push.test(f.session,next.id);f.db.prepare('DELETE FROM sessions').run();await f.push.drain();assert.equal(f.db.prepare('SELECT count(*) n FROM push_jobs').get().n,0);
});
test('reject arbitrary endpoints and invalid keys; session ownership and explicit rebind',t=>{
 const f=fixture(t),sub=subscription();for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://example.org/a','https://fcm.googleapis.com.evil.test/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a'])assert.throws(()=>f.push.subscribe(f.session,{...sub,endpoint}));assert.throws(()=>f.push.subscribe(f.session,{...sub,keys:{...sub.keys,p256dh:'x'}}));const {id}=f.push.subscribe(f.session,sub);assert.throws(()=>f.push.test({id:'other'},id));f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('otherhash','other',f.now()+100000,0);f.push.test(f.session,id);f.push.subscribe({id:'other'},sub);assert.equal(f.push.status(f.session).subscriptions.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM push_jobs').get().n,0);
});
test('v6 migration preserves messages; keys and pending jobs survive restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'simlink-push-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db');let db=openStore(path);db.exec('DROP TABLE session_details; DROP TABLE login_failures; DROP TABLE push_jobs; DROP TABLE push_subscriptions; DROP TABLE push_identity; PRAGMA user_version=6;');db.prepare("INSERT INTO messages(device_id,event_id,sender,body,received_at,synced_at) VALUES('d','e','Test','TEST ONLY',1,1)").run();db.close();db=openStore(path);const session={id:'persist'};db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('hash',session.id,999999,1);let push=createPushService(db,()=>1000,'https://sim.test',async()=>{});const key=push.status(session).publicKey;const {id}=push.subscribe(session,subscription());push.test(session,id);db.close();db=openStore(path);try{let calls=0;push=createPushService(db,()=>2000,'https://sim.test',async()=>calls++);assert.equal(push.status(session).publicKey,key);await push.drain();assert.equal(calls,1);assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n,1);}finally{db.close();}
});
test('routes enforce browser auth and CSRF; status hides credentials; logout revokes subscriptions',async t=>{
 const origin='https://sim.test',app=createApp({origin,pushSender:async()=>{}});t.after(()=>app.close());await initializeAdmin(app.store,'fictional-password');assert.equal((await app.inject('/api/v1/push')).statusCode,401);const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{password:'fictional-password'}});const headers={origin,cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrfToken},sub=subscription();assert.equal((await app.inject({method:'POST',url:'/api/v1/push/subscriptions',headers:{cookie:headers.cookie,origin},payload:sub})).statusCode,403);const response=await app.inject({method:'POST',url:'/api/v1/push/subscriptions',headers,payload:sub});assert.equal(response.statusCode,200,response.body);const status=await app.inject({url:'/api/v1/push',headers});assert.ok(!status.body.includes(sub.endpoint));assert.ok(!status.body.includes(sub.keys.auth));await app.inject({method:'POST',url:'/api/v1/auth/logout',headers});assert.equal(app.store.prepare('SELECT count(*) n FROM push_subscriptions').get().n,0);
});
