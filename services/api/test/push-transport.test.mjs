import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import webpush from 'web-push';
import { sendNotification } from '../src/modules/push/transport.mjs';
test('transport cancels a stalled request at total deadline and preserves HTTP rejection status',async t=>{
 t.mock.method(webpush,'generateRequestDetails',()=>({endpoint:'https://push.example.test',method:'POST',headers:{},body:Buffer.from('fictional')}));
 let status=null,aborted=false;
 t.mock.method(https,'request',(url,options,callback)=>{
  const req=new EventEmitter();req.end=()=>{
   if(status!==null){const res=new EventEmitter();res.statusCode=status;res.resume=()=>{};callback(res);queueMicrotask(()=>res.emit('end'));}
  };
  options.signal.addEventListener('abort',()=>{aborted=true;req.emit('error',new Error('deadline'));});
  return req;
 });
 const alive=setTimeout(()=>{},1000);
 try {await assert.rejects(sendNotification({},'fake',{},5),/deadline/);assert.equal(aborted,true);}
 finally {clearTimeout(alive);}
 status=503;await assert.rejects(sendNotification({},'fake',{}),e=>e.statusCode===503);
 status=201;await sendNotification({},'fake',{});
});
