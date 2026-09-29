import test from 'node:test';
import assert from 'node:assert/strict';
import {ViewCache,VIEW_CACHE_KEY} from '../src/shared/api/viewCache.ts';
import {senderAvatar} from '../src/features/inbox/model.ts';
import {ApiClient} from '../src/shared/api/client.ts';
import {SessionController} from '../src/features/auth/session.ts';
const fixture=()=>{
 const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 return {values,storage};
};
const snapshot={sims:[],messages:[{sequence:1,deviceId:'fictional',sender:'+12025550123',body:'Fictional cache test',receivedAt:1,isRead:false,readVersion:0}],updatedAt:100};
test('view cache restores only after activating the same verified session',()=>{
 const {storage}=fixture();const first=new ViewCache(storage);
 first.set('inbox',snapshot);assert.equal(storage.getItem(VIEW_CACHE_KEY),null);
 first.activate('session-a',Date.now()+100000);first.set('inbox',snapshot);
 const reopened=new ViewCache(storage);assert.equal(reopened.get('inbox'),undefined);
 reopened.activate('session-a',Date.now()+100000);assert.deepEqual(reopened.get('inbox'),snapshot);
 reopened.activate('session-b',Date.now()+100000);assert.equal(reopened.get('inbox'),undefined);
});
test('expired, corrupted and invalid snapshots fail closed; unavailable storage keeps memory usable',()=>{
 const {storage}=fixture();const cache=new ViewCache(storage);cache.activate('a',Date.now()+100000);cache.set('inbox',snapshot);
 const data=JSON.parse(storage.getItem(VIEW_CACHE_KEY));data.entries.inbox.savedAt=Date.now()-86400001;storage.setItem(VIEW_CACHE_KEY,JSON.stringify(data));
 const stale=new ViewCache(storage);stale.activate('a',Date.now()+100000);assert.equal(stale.get('inbox'),undefined);
 data.entries.inbox.savedAt=Date.now();data.entries.inbox.value.messages='invalid';storage.setItem(VIEW_CACHE_KEY,JSON.stringify(data));
 const invalid=new ViewCache(storage);invalid.activate('a',Date.now()+100000);assert.equal(invalid.get('inbox'),undefined);
 storage.setItem(VIEW_CACHE_KEY,'{broken');const broken=new ViewCache(storage);broken.activate('a',Date.now()+100000);assert.equal(broken.get('inbox'),undefined);
 const unavailable=new ViewCache({getItem(){throw Error('blocked');},setItem(){throw Error('quota');},removeItem(){throw Error('blocked');}});
 unavailable.activate('a',Date.now()+100000);unavailable.set('inbox',snapshot);assert.deepEqual(unavailable.get('inbox'),snapshot);
 unavailable.clear();assert.equal(unavailable.get('inbox'),undefined);
});
test('logout and unauthorized clear memory and disk, late writes cannot repopulate',async()=>{
 const {storage}=fixture();const api=new ApiClient();api.views=new ViewCache(storage);
 const auth=new SessionController(api);api.request=async path=>path==='/auth/session'?{id:'a',expiresAt:Date.now()+100000,csrfToken:'fictional'}:{};
 await auth.restore();api.views.set('inbox',snapshot);await auth.logout();api.views.set('inbox',snapshot);
 assert.equal(api.views.get('inbox'),undefined);assert.equal(storage.getItem(VIEW_CACHE_KEY),null);
 await auth.restore();api.views.set('inbox',snapshot);api.onUnauthorized();assert.equal(storage.getItem(VIEW_CACHE_KEY),null);
});
test('phone avatars use trailing digits; named senders use a Unicode initial',()=>{
 assert.equal(senderAvatar('+12025550123'),'23');assert.equal(senderAvatar('+86 138-0000-5678'),'78');
 assert.equal(senderAvatar('Service'),'S');assert.equal(senderAvatar('通知'),'通');assert.equal(senderAvatar(''),'?');
});

test('disk snapshot is bounded while tab navigation retains all loaded messages',()=>{
 const {storage}=fixture();const cache=new ViewCache(storage);cache.activate('a',Date.now()+100000);
 const many={...snapshot,messages:Array.from({length:510},(_,i)=>({...snapshot.messages[0],sequence:i+1}))};
 cache.set('inbox',many);assert.equal(cache.get('inbox').messages.length,510);
 const restarted=new ViewCache(storage);restarted.activate('a',Date.now()+100000);
 assert.equal(restarted.get('inbox').messages.length,500);assert.equal(restarted.get('inbox').messages[0].sequence,11);
});
