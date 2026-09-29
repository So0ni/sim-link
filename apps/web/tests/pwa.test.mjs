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
