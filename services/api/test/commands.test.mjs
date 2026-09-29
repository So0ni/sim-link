import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.mjs';
import { initializeAdmin } from '../src/modules/auth/credentials.mjs';
async function fixture(t) {
 let stamp=1000000; const app=createApp({origin:'https://test.example',now:()=>stamp});t.after(()=>app.close());
 await initializeAdmin(app.store,'fictional-password-only');
 const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://test.example'},payload:{password:'fictional-password-only'}});
 const headers={origin:'https://test.example',cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrfToken};
 const post=(url,payload,h=headers)=>app.inject({method:'POST',url,headers:h,payload});
 async function pair() {const invitation=(await post('/api/v1/pairings')).json();return (await post('/api/v1/device/pair',{pairingToken:invitation.pairingToken,name:'Fictional phone',apiVersion:1},{})).json();}
 const device=await pair(); const dh={authorization:`Bearer ${device.deviceToken}`};const simKey=randomUUID();
 await post('/api/v1/device/sims',{status:'available',sims:[{key:simKey,subscriptionId:1,slotIndex:0,carrier:'Test'}]},dh);
 const sim=(await app.inject({url:'/api/v1/sims',headers})).json().sims[0];
 const input=()=>({requestId:randomUUID(),simId:sim.id,recipient:'+15555550123',body:'Fictional remote test'});
 const cap=enabled=>post('/api/v1/device/send-capability',{enabled},dh);
 const claim=id=>post('/api/v1/device/commands/claim',{requestId:id},dh);
 const report=(id,claimRequestId,parts,rejection=null)=>post(`/api/v1/device/commands/${id}/result`,{claimRequestId,parts,rejection,interrupted:false},dh);
 return{app,headers,post,dh,device,sim,input,cap,claim,report,pair,advance:n=>{stamp+=n;}};
}
test('send capability opt-in, separate credentials, CSRF and automatic offline queuing',async t=>{
 const f=await fixture(t);const body=f.input();
 assert.equal((await f.post('/api/v1/commands',body,{origin:'https://test.example'})).statusCode,401);
 assert.equal((await f.post('/api/v1/commands',body,{...f.headers,'x-csrf-token':'invalid'})).statusCode,403);
 assert.equal((await f.post('/api/v1/commands',body,{...f.dh,origin:'https://test.example'})).statusCode,401);
 assert.equal((await f.post('/api/v1/commands',body)).statusCode,409);
 await f.cap(true);f.advance(60001);
 const queued=(await f.post('/api/v1/commands',body)).json();
 assert.equal(queued.expiresAt-queued.createdAt,3600000);
 for(const waitOffline of [true,false]) assert.equal((await f.post('/api/v1/commands',{...body,waitOffline})).json().id,queued.id);
 await f.cap(false);assert.equal((await f.claim(randomUUID())).json().command,null);
});
test('duplicate submission and claim response loss do not mint another command or lease',async t=>{
 const f=await fixture(t);await f.cap(true);const body=f.input();
 const [a,b]=await Promise.all([f.post('/api/v1/commands',body),f.post('/api/v1/commands',body)]);
 assert.equal(a.json().id,b.json().id);assert.equal((await f.post('/api/v1/commands',{...body,body:'changed'})).statusCode,409);
 const claimId=randomUUID();const claimed=(await f.claim(claimId)).json().command;
 assert.equal(claimed.id,a.json().id);assert.equal((await f.claim(claimId)).json().command.id,claimed.id);
 assert.equal((await f.claim(randomUUID())).json().command,null);
 assert.equal((await f.post(`/api/v1/commands/${claimed.id}/cancel`)).statusCode,409);
 f.advance(121000);assert.equal((await f.app.inject({url:`/api/v1/commands/request/${body.requestId}`,headers:f.headers})).json().state,'unknown');
 assert.equal((await f.claim(randomUUID())).json().command,null);
});
test('cancellation, expiry and mapping changes forbid later claim; revocation preserves history',async t=>{
 const f=await fixture(t);await f.cap(true);
 const a=(await f.post('/api/v1/commands',f.input())).json();await f.post(`/api/v1/commands/${a.id}/cancel`);assert.equal((await f.claim(randomUUID())).json().command,null);
 const b=(await f.post('/api/v1/commands',f.input())).json();f.advance(3600000);assert.equal((await f.claim(randomUUID())).json().command,null);
 assert.equal(f.app.store.prepare('SELECT state FROM commands WHERE id=?').get(b.id).state,'cancelled');
 await f.cap(true);const c=(await f.post('/api/v1/commands',f.input())).json();
 await f.post('/api/v1/device/sims',{status:'available',sims:[]},f.dh);assert.equal((await f.claim(randomUUID())).json().command,null);
 assert.equal(f.app.store.prepare('SELECT reason FROM commands WHERE id=?').get(c.id).reason,'sim_changed');
 await f.app.inject({method:'DELETE',url:`/api/v1/devices/${f.device.deviceId}`,headers:f.headers});assert.equal((await f.claim(randomUUID())).statusCode,401);assert.equal(f.app.store.prepare('SELECT COUNT(*) n FROM commands').get().n,3);
});
test('part reports merge monotonically, late success resolves unknown, device scope enforced',async t=>{
 const f=await fixture(t);await f.cap(true);const c=(await f.post('/api/v1/commands',f.input())).json();const claimId=randomUUID();await f.claim(claimId);
 assert.equal((await f.report(c.id,randomUUID(),[-1])).statusCode,409);
 const other=await f.pair();assert.equal((await f.post(`/api/v1/device/commands/${c.id}/result`,{claimRequestId:claimId,parts:[-1],rejection:null,interrupted:false},{authorization:`Bearer ${other.deviceToken}`})).statusCode,404);
 assert.equal((await f.report(c.id,claimId,[-1,null])).json().state,'unknown');
 assert.equal((await f.report(c.id,claimId,[null,null])).json().parts[0],-1);
 assert.equal((await f.report(c.id,claimId,[-1,-1])).json().state,'sent');
 assert.equal((await f.report(c.id,claimId,[null,null])).json().state,'sent');
 assert.equal((await f.report(c.id,claimId,[1,-1])).statusCode,409);
 const d=(await f.post('/api/v1/commands',f.input())).json();const dc=randomUUID();await f.claim(dc);
 assert.equal((await f.report(d.id,dc,[-1,1])).json().state,'partial');
 const e=(await f.post('/api/v1/commands',f.input())).json();const ec=randomUUID();await f.claim(ec);
 assert.equal((await f.report(e.id,ec,[],'expired')).json().state,'rejected');
});

test('claim vs cancel and concurrent claim have a single winner',async t=>{
 const f=await fixture(t);await f.cap(true);
 const c=(await f.post('/api/v1/commands',f.input())).json();
 const [cancel,claim]=await Promise.all([f.post(`/api/v1/commands/${c.id}/cancel`),f.claim(randomUUID())]);
 if(cancel.statusCode===200)assert.equal(claim.json().command,null);else{assert.equal(cancel.statusCode,409);assert.equal(claim.json().command.id,c.id);}
 const d=(await f.post('/api/v1/commands',f.input())).json();
 const claims=await Promise.all([f.claim(randomUUID()),f.claim(randomUUID())]);
 assert.equal(claims.filter(r=>r.json().command?.id===d.id).length,1);
});

test('v5 migration preserves data; claimed commands and results survive store restart',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {openStore}=await import('../src/platform/store.mjs');const {createCommandService}=await import('../src/modules/commands/service.mjs');
 const dir=mkdtempSync(join(tmpdir(),'simlink-commands-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite');
 let db=openStore(path);db.exec('DROP TABLE push_jobs; DROP TABLE push_subscriptions; DROP TABLE push_identity; DROP TABLE commands; ALTER TABLE devices DROP COLUMN send_capability; ALTER TABLE devices DROP COLUMN send_capability_at; PRAGMA user_version=5;');
 db.prepare("INSERT INTO messages(device_id,event_id,sender,body,received_at,synced_at,is_read,read_version) VALUES('old-device','event','Fictional','Historical',1,1,1,7)").run();db.close();
 db=openStore(path);assert.equal(db.pragma('user_version',{simple:true}),7);assert.equal(db.prepare('SELECT is_read,read_version FROM messages').get().read_version,7);
 const sim=randomUUID(),key=randomUUID(),device=randomUUID();
 db.prepare("INSERT INTO devices(id,name,token_hash,created_at,send_capability,send_capability_at) VALUES(?,'Test','hash',1,1,1000)").run(device);
 db.prepare("INSERT INTO sims(id,device_id,local_key,subscription_id,slot_index,carrier,state,reported_at) VALUES(?,?,?,1,0,'Test','active',1)").run(sim,device,key);
 let service=createCommandService(db,()=>1000);const request={requestId:randomUUID(),simId:sim,recipient:'+15555550123',body:'Fictional persisted command'};const c=service.create(request);const claimId=randomUUID();service.claim(device,claimId);db.close();
 db=openStore(path);try{
  service=createCommandService(db,()=>5000);assert.equal(service.create(request).id,c.id);assert.equal(service.claim(device,randomUUID()).command,null);assert.equal(service.claim(device,claimId).command.id,c.id);
  service.report(device,c.id,{claimRequestId:claimId,parts:[-1],rejection:null,interrupted:false});assert.equal(service.find(request.requestId).state,'sent');
 }finally{db.close();}
});

test('one-hour queue boundary, background expiry, and late claimed results',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const f=await fixture(t);await f.cap(true);
 const first=f.input();const c=(await f.post('/api/v1/commands',first)).json();
 const claimId=randomUUID();await f.claim(claimId);
 const second=f.input();const waiting=(await f.post('/api/v1/commands',second)).json();
 f.advance(3599999);t.mock.timers.tick(30000);
 assert.equal(f.app.store.prepare('SELECT state FROM commands WHERE id=?').get(waiting.id).state,'pending');
 assert.equal((await f.post('/api/v1/commands',second)).json().expiresAt,waiting.expiresAt);
 f.advance(1);t.mock.timers.tick(30000);
 const expired=f.app.store.prepare('SELECT state,reason FROM commands WHERE id=?').get(waiting.id);
 assert.deepEqual(expired,{state:'cancelled',reason:'expired'});
 assert.equal((await f.claim(randomUUID())).json().command,null);
 assert.equal((await f.app.inject({url:`/api/v1/commands/request/${first.requestId}`,headers:f.headers})).json().state,'unknown');
 assert.equal((await f.report(c.id,claimId,[-1])).json().state,'sent');
});
