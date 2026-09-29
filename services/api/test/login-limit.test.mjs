import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';
import { initializeAdmin } from '../src/modules/auth/credentials.mjs';
import { createLoginLimit, loginSource } from '../src/modules/auth/login-limit.mjs';
import { createRateLimit } from '../src/platform/rate-limit.mjs';
import { openStore } from '../src/platform/store.mjs';
const origin='https://sim.example.test', password='fictional-admin-password';
const bad=()=>{throw Object.assign(new Error('invalid_credentials'),{statusCode:401});};
test('per-source escalation persists, blocked retries do not extend cooldown, success clears and inactivity expires',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'simlink-limit-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'db');let now=1000000;let db=openStore(path);
 let limiter=createLoginLimit(db,()=>now,createRateLimit(db,()=>now));
 for(let i=0;i<4;i++)await assert.rejects(limiter.verify('192.0.2.1',bad),{statusCode:401});
 await assert.rejects(limiter.verify('192.0.2.1',bad),{statusCode:429,retryAfter:60});
 now+=10000;await assert.rejects(limiter.verify('192.0.2.1',bad),{retryAfter:50});
 assert.equal(await limiter.verify('192.0.2.2',async()=>true),true);
 db.close();db=openStore(path);t.after(()=>db.close());limiter=createLoginLimit(db,()=>now,createRateLimit(db,()=>now));
 await assert.rejects(limiter.verify('192.0.2.1',bad),{retryAfter:50});
 now+=50000;await assert.rejects(limiter.verify('192.0.2.1',bad),{retryAfter:120});
 for (const delay of [240,480,900,900]) {
   now += (db.prepare('SELECT blocked_until FROM login_failures').get().blocked_until - now);
   await assert.rejects(limiter.verify('192.0.2.1',bad),{retryAfter:delay});
 }
 now+=900000;await limiter.verify('192.0.2.1',async()=>true);
 await assert.rejects(limiter.verify('192.0.2.1',bad),{statusCode:401});
 now+=15*60000;await assert.rejects(limiter.verify('192.0.2.1',bad),{statusCode:401});
 assert.equal(db.prepare('SELECT failures FROM login_failures').get().failures,1);
});
test('global budget, bounded hash concurrency and IPv6 source grouping',async t=>{
 let now=1000000;const db=openStore(':memory:');t.after(()=>db.close());const limiter=createLoginLimit(db,()=>now,createRateLimit(db,()=>now));
 let release; const slow=new Promise(resolve=>{release=resolve;});
 const a=limiter.verify('192.0.2.1',()=>slow),b=limiter.verify('192.0.2.2',()=>slow);
 await assert.rejects(limiter.verify('192.0.2.3',()=>true),{retryAfter:2});release(true);await Promise.all([a,b]);
 for(let i=0;i<28;i++)await limiter.verify('192.0.2.4',async()=>true);
 await assert.rejects(limiter.verify('192.0.2.5',()=>true),{retryAfter:60});now+=60000;
 assert.equal(await limiter.verify('192.0.2.5',async()=>true),true);
 assert.equal(loginSource('::ffff:192.0.2.1'),'192.0.2.1');
 assert.equal(loginSource('2001:db8:1:2::1'),loginSource('2001:0db8:0001:0002::ffff'));
});
test('proxy allowlist rejects spoofed headers and isolates trusted forwarded clients; 429 includes exact delay',async t=>{
 let now=1000000;
 const app=createApp({origin,now:()=>now,trustedProxyAddresses:'127.0.0.1'});t.after(()=>app.close());await initializeAdmin(app.store,password);
 const login=(remoteAddress,forwarded,pw='fictional-wrong-password')=>app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress,headers:{origin,'x-forwarded-for':forwarded},payload:{password:pw}});
 for(let i=0;i<4;i++)assert.equal((await login('192.0.2.1',`198.51.100.${i}`)).statusCode,401);
 const blocked=await login('192.0.2.1','198.51.100.99');assert.equal(blocked.statusCode,429);assert.equal(blocked.headers['retry-after'],'60');
 now+=10000;assert.equal((await login('192.0.2.1','198.51.100.100',password)).headers['retry-after'],'50');
 for(let i=0;i<5;i++)await login('127.0.0.1','203.0.113.1');
 assert.equal((await login('127.0.0.1','203.0.113.2',password)).statusCode,200);
 // Adding a forged leftmost address cannot bypass the nearest untrusted hop.
 assert.equal((await login('127.0.0.1','198.51.100.42, 203.0.113.1')).statusCode,429);
 assert.throws(()=>createApp({trustedProxyAddresses:'true'}),/TRUSTED_PROXIES/);
 assert.throws(()=>createApp({trustedProxyAddresses:'0.0.0.0\/0'}),/TRUSTED_PROXIES/);
});

test('unconfigured proxy ignores forwarded identity and HTTP cooldown leaves existing sessions valid',async t=>{
 const app=createApp({origin});t.after(()=>app.close());await initializeAdmin(app.store,password);
 const request=(pw,ip)=>app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'192.0.2.10',headers:{origin,'x-forwarded-for':ip},payload:{password:pw}});
 const login=await request(password,'198.51.100.1');
 for(let i=0;i<4;i++)assert.equal((await request('fictional-wrong-password',`198.51.100.${i}`)).statusCode,401);
 assert.equal((await request('fictional-wrong-password','198.51.100.99')).statusCode,429);
 assert.equal((await app.inject({url:'/api/v1/auth/session',headers:{cookie:login.headers['set-cookie'].split(';')[0]}})).statusCode,200);
});
