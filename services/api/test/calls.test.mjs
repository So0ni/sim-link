import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { initializeAdmin } from '../src/modules/auth/credentials.mjs';
import { createCallsService } from '../src/modules/calls/service.mjs';
import { createPushService } from '../src/modules/push/service.mjs';
import { openStore } from '../src/platform/store.mjs';
import { createECDH } from 'node:crypto';
const origin='https://calls.example.test';
const call={eventId:'fictional-call',number:'+12025550147',outcome:'missed',startedAt:1000,durationSeconds:0,simKey:null};
async function setup(t) {
 const app=createApp({origin,now:()=>10000});t.after(()=>app.close());await initializeAdmin(app.store,'fictional-call-test-password');
 const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{password:'fictional-call-test-password'}});
 const headers={origin,cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrfToken};
 const invitation=await app.inject({method:'POST',url:'/api/v1/pairings',headers});
 const device=(await app.inject({method:'POST',url:'/api/v1/device/pair',payload:{pairingToken:invitation.json().pairingToken,name:'Fictional gateway',apiVersion:1}})).json();
 const upload={method:'POST',url:'/api/v1/device/calls',headers:{authorization:`Bearer ${device.deviceToken}`},payload:call};
 return {app,headers,device,upload};
}
test('call routes isolate credentials, preserve idempotent facts, and mark viewing independently of outcome',async t=>{
 const {app,headers,device,upload}=await setup(t);
 assert.equal((await app.inject('/api/v1/calls')).statusCode,401);
 assert.equal((await app.inject({url:'/api/v1/calls/status',headers:upload.headers})).statusCode,401);
 assert.equal((await app.inject({...upload,headers})).statusCode,401);
 const first=await app.inject(upload);assert.equal(first.statusCode,200);
 const replay=await app.inject(upload);assert.equal(replay.json().duplicate,true);assert.equal(replay.json().sequence,first.json().sequence);
 for(const change of [{number:null},{outcome:'incoming'},{durationSeconds:10}])assert.equal((await app.inject({...upload,payload:{...call,...change}})).statusCode,409);
 assert.equal((await app.inject({...upload,payload:{...call,eventId:'future',startedAt:9999999}})).statusCode,400);
 assert.equal((await app.inject({...upload,payload:{...call,eventId:'bad',outcome:'outgoing'}})).statusCode,400);
 const id=first.json().sequence;
 assert.equal((await app.inject({method:'POST',url:`/api/v1/calls/${id}/view`,headers:{cookie:headers.cookie,origin}})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:`/api/v1/calls/${id}/view`,headers})).statusCode,200);
 const detail=(await app.inject({url:`/api/v1/calls/${id}`,headers})).json();assert.equal(detail.outcome,'missed');assert.equal(detail.viewedAt,10000);
 const list=await app.inject({url:'/api/v1/calls',headers});assert.equal(list.headers['cache-control'],'no-store');assert.equal(list.json().calls.length,1);
 assert.equal((await app.inject({url:'/api/v1/calls?before=invalid',headers})).statusCode,400);
 await app.inject({method:'DELETE',url:`/api/v1/devices/${device.deviceId}`,headers});
 assert.equal((await app.inject(upload)).statusCode,401);assert.equal((await app.inject({url:`/api/v1/calls/${id}`,headers})).statusCode,200);
});
test('call status distinguishes unreported, disabled, denied and pending; pagination preserves repeated calls',async t=>{
 const {app,headers,upload}=await setup(t);
 assert.equal((await app.inject({url:'/api/v1/calls/status',headers})).json().devices[0].enabled,null);
 const status=await app.inject({...upload,url:'/api/v1/device/calls/status',payload:{enabled:true,permission:false,checkedAt:null,pending:2}});assert.equal(status.statusCode,200);
 const device=(await app.inject({url:'/api/v1/calls/status',headers})).json().devices[0];assert.equal(device.permission,0);assert.equal(device.checkedAt,null);assert.equal(device.pending,2);
 for(let i=0;i<101;i++)assert.equal((await app.inject({...upload,payload:{...call,eventId:`call-${i}`}})).statusCode,200);
 const first=(await app.inject({url:'/api/v1/calls',headers})).json();assert.equal(first.calls.length,100);
 const second=(await app.inject({url:`/api/v1/calls?before=${first.nextCursor}`,headers})).json();assert.equal(second.calls.length,1);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.calls,...second.calls].map(c=>c.sequence)).size,101);
});
test('only recent missed calls enqueue one private push; old calls still persist',async()=>{
 const db=openStore(':memory:');let now=10_000_000;const payloads=[];
 try{
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('hash','session',now+100000,now);
  const push=createPushService(db,()=>now,origin,async(_,body)=>payloads.push(JSON.parse(body)));
  const ecdh=createECDH('prime256v1');ecdh.generateKeys();
  push.subscribe({id:'session'},{endpoint:'https://web.push.apple.com/fictional',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}});
  const service=createCallsService(db,()=>now,push.enqueueCall);
  const fresh={...call,startedAt:now};service.receive({id:'d'},fresh);service.receive({id:'d'},fresh);
  service.receive({id:'d'},{...fresh,eventId:'answered',outcome:'incoming'});service.receive({id:'d'},{...call,eventId:'old'});
  await push.drain();assert.equal(payloads.length,1);assert.match(payloads[0].url,/^\/#\/calls\/\d+$/);assert.ok(!JSON.stringify(payloads[0]).includes(call.number));assert.equal(service.list().calls.length,3);
 }finally{db.close();}
});
test('SIM enrichment is device-owned, monotonic, idempotent and never re-notifies',async t=>{
 const {app,headers,device,upload}=await setup(t);
 const key='11111111-1111-4111-8111-111111111111';
 const other='22222222-2222-4222-8222-222222222222';
 const report={...upload,url:'/api/v1/device/sims',payload:{status:'available',sims:[{key,subscriptionId:1,slotIndex:0,carrier:'Fictional'}]}};
 assert.equal((await app.inject(report)).statusCode,200);
 const first=(await app.inject(upload)).json();
 await app.inject({method:'POST',url:`/api/v1/calls/${first.sequence}/view`,headers});
 const enriched={...upload,payload:{...call,simKey:key}};
 assert.equal((await app.inject(enriched)).statusCode,200);
 assert.equal((await app.inject(enriched)).json().duplicate,true);
 assert.equal((await app.inject(upload)).statusCode,200);
 let detail=(await app.inject({url:`/api/v1/calls/${first.sequence}`,headers})).json();
 assert.equal(detail.simKey,key);assert.equal(detail.viewedAt,10000);assert.equal(detail.syncedAt,first.syncedAt);
 assert.equal((await app.inject({...upload,payload:{...call,simKey:other}})).statusCode,409);
 assert.equal((await app.inject({...upload,payload:{...call,eventId:'unknown-sim',simKey:other}})).statusCode,503);
 const db=app.store;let pushes=0;
 const service=createCallsService(db,()=>10000,()=>pushes++);
 service.receive({id:device.deviceId},{...call,eventId:'notify-once'});
 service.receive({id:device.deviceId},{...call,eventId:'notify-once',simKey:key});
 assert.equal(pushes,1);
 assert.throws(()=>service.receive({id:'different-device'},{...call,eventId:'foreign',simKey:key}));
 assert.equal(service.get(first.sequence).simKey,key);
});
