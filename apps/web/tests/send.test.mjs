import test from 'node:test';
import assert from 'node:assert/strict';
import {recipientNumber,reconcileSubmission} from '../src/features/send/model.ts';
import {ApiError} from '../src/shared/api/client.ts';
test('requires explicit international recipient; alphanumeric senders not reply targets',()=>{
 assert.equal(recipientNumber('Example'),null);assert.equal(recipientNumber('13800000000'),null);assert.equal(recipientNumber('+1 (555) 555-0123'),'+15555550123');
});
test('ambiguous submission queries original key; retransmission keeps exact payload',async()=>{
 const request={requestId:'original',simId:'same-sim',recipient:'+15555550123',body:'Fictional',waitOffline:false};let posted;
 const api={request:async(path,options)=>{if(!options)throw new ApiError(404);posted=options.body;return{id:'command'};}};
 assert.equal((await reconcileSubmission(api,request)).id,'command');assert.equal(posted,request);
 posted=undefined;assert.equal((await reconcileSubmission({request:async()=>({id:'existing'})},request)).id,'existing');assert.equal(posted,undefined);
 await assert.rejects(()=>reconcileSubmission({request:async()=>{throw new Error('offline');}},request));
});
