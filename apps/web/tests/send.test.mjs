import test from 'node:test';
import assert from 'node:assert/strict';
import {recipientNumber,reconcileSubmission} from '../src/features/send/model.ts';
import {ApiError} from '../src/shared/api/client.ts';
test('requires explicit international recipient; alphanumeric senders not reply targets',()=>{
 assert.equal(recipientNumber('Example'),null);assert.equal(recipientNumber('13800000000'),null);assert.equal(recipientNumber('+1 (555) 555-0123'),'+15555550123');
});
test('ambiguous submission queries original key; retransmission keeps exact payload',async()=>{
 const request={requestId:'original',simId:'same-sim',recipient:'+15555550123',body:'Fictional'};let posted;
 const api={request:async(path,options)=>{if(!options)throw new ApiError(404);posted=options.body;return{id:'command'};}};
 assert.equal((await reconcileSubmission(api,request)).id,'command');assert.equal(posted,request);
 posted=undefined;assert.equal((await reconcileSubmission({request:async()=>({id:'existing'})},request)).id,'existing');assert.equal(posted,undefined);
 await assert.rejects(()=>reconcileSubmission({request:async()=>{throw new Error('offline');}},request));
});

test('conversation timeline joins only the original device, SIM and recipient, including outbound-only threads',async()=>{
 const {threads,matchesThread}=await import('../src/features/inbox/threads.ts');
 const message={sequence:1,deviceId:'d',simKey:'a',sender:'+1 (202) 555-0123',body:'Fictional incoming',receivedAt:20,isRead:false,readVersion:0};
 const base={id:'sent',deviceId:'d',simKey:'a',recipient:'+12025550123',body:'Fictional reply',createdAt:30};
 const result=threads([message],[base,{...base,id:'other-card',simKey:'b',createdAt:40},{...base,id:'other-device',deviceId:'d2',createdAt:10}]);
 assert.equal(result.length,3);const original=result.find(c=>c.messages.length);
 assert.deepEqual(original.timeline.map(x=>x.id),['in:1','out:sent']);assert.equal(original.messages[0].isRead,false);
 assert.equal(result[0].commands[0].id,'other-card');assert.equal(result[0].messages.length,0);
 assert.ok(matchesThread(original,JSON.stringify(['d','a','+12025550123'])));
 assert.equal(matchesThread(original,JSON.stringify(['d','b','+12025550123'])),false);
 assert.equal(matchesThread(original,'invalid'),false);
});
