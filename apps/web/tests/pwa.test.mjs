import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/pwa/sw.js', import.meta.url), 'utf8');
function fixture({ failInstall = false, storage = new Map() } = {}) {
  const events = {}, writes = [], requests = [];
  let claims = 0, skips = 0;
  const assets = ['/index.html','/assets/app.js','/manifest.webmanifest'];
  const context = {
    URL, Set,
    Request: class { constructor(path, options) { this.url = new URL(path,'https://sim.test').href; Object.assign(this, options); } },
    self: { location: {origin:'https://sim.test'}, addEventListener: (type, listener) => events[type] = listener,
      clients: { claim: async () => { claims++; } }, skipWaiting: async () => { skips++; } },
    caches: {
      keys: async () => [...storage.keys()],
      delete: async key => storage.delete(key),
      open: async key => {
        if (!storage.has(key)) storage.set(key,new Map());
        const entries = storage.get(key);
        return {
          addAll: async list => {
            writes.push(...list);
            if (failInstall) throw Error('offline install');
            list.forEach(r => entries.set(new URL(r.url).pathname,`cached:${new URL(r.url).pathname}`));
          },
          match: async path => entries.get(path),
        };
      },
    },
    fetch: async request => {requests.push(request); return 'network';},
  };
  vm.runInNewContext(source.replace('__BUILD_ID__','test').replace('__PRECACHE__',JSON.stringify(assets)),context);
  const event = async (type, input={}) => {
    let wait;
    events[type]({...input,waitUntil: p=>wait=p});
    await wait;
  };
  const fetchEvent = async (path, options={}) => {
    let response;
    events.fetch({request:{url:new URL(path,'https://sim.test').href,method:'GET',mode:'cors',...options},respondWith:p=>response=p});
    return response === undefined ? undefined : await response;
  };
  return {event,fetchEvent,storage,writes,requests,claims:()=>claims,skips:()=>skips};
}
test('precache is atomic and anonymous; first install never forces waiting worker activation', async()=>{
  const f=fixture();await f.event('install');
  assert.equal(f.skips(),0);
  assert.ok(f.writes.every(r=>r.credentials==='omit'&&r.cache==='reload'));
  assert.deepEqual(f.writes.map(r=>new URL(r.url).pathname),['/index.html','/assets/app.js','/manifest.webmanifest']);
  const failed=fixture({failInstall:true});await assert.rejects(failed.event('install'));
  assert.equal(failed.storage.size,0);
});
test('offline navigation and build assets use shell; private paths, queries, writes and other origins bypass worker', async()=>{
  const f=fixture();await f.event('install');
  assert.equal(await f.fetchEvent('/',{mode:'navigate'}),'cached:/index.html');
  assert.equal(await f.fetchEvent('/assets/app.js'),'cached:/assets/app.js');
  for(const path of ['/api/v1/messages','/api/v1/auth/session','/api/v1/messages/reading','/.well-known/sim-gateway','/healthz','/unknown.js','/?secret=x','/assets/app.js?x=1','https://other.test/assets/app.js']) {
    assert.equal(await f.fetchEvent(path,{mode:'navigate'}),undefined,path);
  }
  assert.equal(await f.fetchEvent('/index.html',{method:'POST'}),undefined);
  assert.equal(f.writes.length,3);
});
test('activation removes only old shell caches; user acceptance explicitly activates update', async()=>{
  const storage=new Map([['simlink-shell-old',new Map()],['unrelated',new Map()]]);
  const f=fixture({storage});await f.event('install');await f.event('activate');
  assert.equal(f.claims(),1);
  assert.deepEqual([...storage.keys()],['unrelated','simlink-shell-test']);
  await f.event('message',{data:{type:'other'}});assert.equal(f.skips(),0);
  await f.event('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(f.skips(),1);
});

test('manifest icons are complete PNGs with stable identity and no private start URL',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.id,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/#/inbox');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons){
    const png=readFileSync(new URL('../public'+icon.src,import.meta.url));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);
  }
  assert.ok(manifest.icons.some(i=>i.purpose.includes('maskable')));
});

test('first activation is silent; a waiting update prompts and controller replacement reloads once',async t=>{
  const originals=new Map(['navigator','window','document','location','matchMedia'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  t.after(()=>{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const worker=new EventTarget();worker.state='installing';
  const reg=new EventTarget();reg.installing=worker;reg.waiting=worker;
  reg.update=async()=>{};
  const serviceWorker=new EventTarget();serviceWorker.controller=null;serviceWorker.register=async()=>reg;serviceWorker.ready=Promise.resolve(reg);
  let reloads=0;
  for(const [key,value] of Object.entries({navigator:{serviceWorker,onLine:true},window:Object.assign(new EventTarget(),{isSecureContext:true}),document:Object.assign(new EventTarget(),{visibilityState:'visible'}),location:{reload:()=>reloads++},matchMedia:()=>Object.assign(new EventTarget(),{matches:false})}))Object.defineProperty(globalThis,key,{value,configurable:true});
  const {pwa,startPwa}=await import('../src/pwa/controller.ts');
  startPwa();await new Promise(resolve=>setImmediate(resolve));
  worker.state='installed';worker.dispatchEvent(new Event('statechange'));
  assert.equal(pwa.snapshot().update,false);
  reg.waiting=null;serviceWorker.controller=worker;serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(reloads,0);
  const update=new EventTarget();update.state='installing';let accepted=false;update.postMessage=data=>{accepted=data.type==='ACTIVATE_UPDATE';};
  reg.installing=update;reg.dispatchEvent(new Event('updatefound'));reg.waiting=update;update.state='installed';update.dispatchEvent(new Event('statechange'));
  assert.equal(pwa.snapshot().update,true);pwa.activate();assert.equal(accepted,true);
  serviceWorker.dispatchEvent(new Event('controllerchange'));serviceWorker.dispatchEvent(new Event('controllerchange'));assert.equal(reloads,1);
});

test('push shows sender only for the bound live session; offline fallback is private; safe click deep links',async()=>{
  const events={},shown=[],opened=[];let response={ok:true,status:200,json:async()=>({id:'session'})};
  const context={URL,Set,AbortSignal,AbortController,setTimeout,clearTimeout,self:{location:{origin:'https://sim.test'},addEventListener:(type,fn)=>events[type]=fn,
    registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}},
    fetch:async()=>{if(response instanceof Error)throw response;return response;}};
  vm.runInNewContext(source.replace('__BUILD_ID__','test').replace('__PRECACHE__','[]'),context);
  async function fire(type,data){let promise;events[type]({...data,waitUntil:p=>promise=p});await promise;}
  const payload={sessionId:'session',body:'+12025550123 发来一条短信',url:'/#/inbox/test-conversation',tag:'message:1'};
  await fire('push',{data:{json:()=>payload}});assert.equal(shown[0][0],payload.body);assert.equal(shown[0][1].body,undefined);assert.equal(shown[0][1].data.url,payload.url);
  response={ok:false,status:401};await fire('push',{data:{json:()=>payload}});assert.equal(shown.length,1);
  response={ok:true,status:200,json:async()=>({id:'different'})};await fire('push',{data:{json:()=>payload}});assert.equal(shown.length,1);
  response=new Error('offline');payload.preview='FICTIONAL PRIVATE PREVIEW';await fire('push',{data:{json:()=>payload}});assert.equal(shown[1][0],'新通知');assert.ok(!JSON.stringify(shown[1]).includes(payload.preview));assert.ok(!shown[1][1].body.includes('12025550123'));assert.equal(shown[1][1].data.url,'/#/inbox');
  await fire('notificationclick',{notification:{close(){},data:{url:payload.url}}});assert.equal(opened[0],'https://sim.test'+payload.url);
  for(const url of ['https://evil.test/','/api/v1/auth/logout','/#/send'])await fire('notificationclick',{notification:{close(){},data:{url}}});assert.equal(opened.length,1);
  await fire('notificationclick',{notification:{close(){},data:{url:'/#/calls/7'}}});assert.equal(opened[1],'https://sim.test/#/calls/7');
  await fire('notificationclick',{notification:{close(){},data:{url:'/#/calls/javascript:bad'}}});assert.equal(opened.length,2);
});

test('slow session check falls back privately without waiting for another push; badge failure never blocks display',async()=>{
 const events={},shown=[],badges=[],reports=[];let mode='slow',timeout,signal;
 const context={URL,Set,AbortController,Number,Promise,Date,
  setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{},
  self:{location:{origin:'https://sim.test'},addEventListener:(name,fn)=>events[name]=fn,
   navigator:{setAppBadge:async n=>{badges.push(n);throw Error('denied');},clearAppBadge:async()=>badges.push(0)},
   registration:{showNotification:async(title,options)=>shown.push({title,...options})}},
  fetch:async(path,options)=>{
   if(path.includes('/receipt')){reports.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({ok:true})};}
   if(mode==='slow')return new Promise((resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(Error('timeout')));});
   return {ok:true,status:200,json:async()=>({sessionId:'s',csrfToken:'fictional',unreadCount:530})};
  }};
 vm.runInNewContext(source.replace('__BUILD_ID__','test').replace('__PRECACHE__','[]'),context);
 let pending;const payload={sessionId:'s',jobId:'fake-job',body:'Private sender',url:'/#/inbox/example',tag:'message:1'};
 const fire=()=>{events.push({data:{json:()=>payload},waitUntil:p=>pending=p});};
 fire();assert.equal(shown.length,0);timeout();await pending;
 assert.equal(signal.aborted,true);assert.equal(shown[0].body,'打开 SIMLink 查看新通知');assert.equal(badges.length,0);
 mode='online';fire();await pending;assert.equal(shown[1].title,payload.body);assert.equal(shown[1].body,undefined);assert.deepEqual(badges,[530]);
 payload.preview='Fictional SMS preview';fire();await pending;assert.equal(shown[2].title,payload.body);assert.equal(shown[2].body,payload.preview);
 assert.ok(reports.some(r=>r.shownAt===null));assert.ok(reports.some(r=>Number.isSafeInteger(r.shownAt)));
});
test('logout during verification suppresses stale notification and clears badge',async()=>{
 const events={},shown=[],badges=[];let resolve;
 const context={URL,Set,AbortController,setTimeout,clearTimeout,self:{location:{origin:'https://sim.test'},addEventListener:(n,f)=>events[n]=f,
  navigator:{clearAppBadge:async()=>badges.push(0)},registration:{showNotification:async()=>shown.push(1)}},
  fetch:()=>new Promise(r=>resolve=r)};
 vm.runInNewContext(source.replace('__BUILD_ID__','test').replace('__PRECACHE__','[]'),context);
 let push,clear;events.push({data:{json:()=>({sessionId:'s',body:'Private'})},waitUntil:p=>push=p});
 events.message({data:{type:'CLEAR_BADGE'},waitUntil:p=>clear=p});await clear;
 resolve({ok:true,status:200,json:async()=>({sessionId:'s',unreadCount:8})});await push;
 assert.deepEqual(shown,[]);assert.deepEqual(badges,[0]);
});
test('badge OS writes are ordered, zero clears, invalid values ignored',async t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');t.after(()=>{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;});
 const seen=[];Object.defineProperty(globalThis,'navigator',{configurable:true,value:{setAppBadge:async n=>seen.push(n),clearAppBadge:async()=>seen.push(0)}});
 const {updateAppBadge}=await import('../src/pwa/badge.ts');
 await Promise.all([updateAppBadge(530),updateAppBadge(0),updateAppBadge(-1),updateAppBadge(NaN)]);assert.deepEqual(seen,[530,0]);
});
