import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,sqliteAdapter} from '../store.mjs';
import {clientIP,networkIP,seal,unseal} from '../security.mjs';
const hour=3600000;
const reservation=(id,registered=false)=>({id,subject:registered?'u:user':'ip:guest',ip:'shared-network',registered,worker:'test-worker',userId:registered?'user':null,title:'Title',videoId:'LY43o01dkU4',format:'mp3',quality:'720'});
async function setup(t,filename=':memory:'){
 let now=10000000;const store=new Store(await sqliteAdapter(filename),{clock:()=>now});t.after(()=>store.close());return {store,advance:ms=>{now+=ms;}};
}
test('sliding guest 5/hour and registered 15/hour, no quota reset on reads',async t=>{
 for(const registered of [false,true]){
  const {store,advance}=await setup(t);const limit=registered?15:5;
  for(let n=0;n<limit;n++){await store.reserve(reservation('job'+n,registered));await store.finish('job'+n,'done');advance(1000);}
  assert.equal((await store.quota(registered?'u:user':'ip:guest',registered)).remaining,0);
  await assert.rejects(store.reserve(reservation('extra',registered)),e=>e.status===429&&e.retryAfter>0);
  advance(hour-limit*1000);assert.equal((await store.quota(registered?'u:user':'ip:guest',registered)).remaining,1);
  await store.reserve(reservation('new',registered));
 }
});
test('one simultaneous job atomically; internal failures refund, cancellation and source errors do not',async t=>{
 const {store}=await setup(t);
 const attempts=await Promise.allSettled(Array.from({length:8},(_,i)=>store.reserve(reservation('race'+i))));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 await store.finish('race0','error',true);assert.equal((await store.quota('ip:guest',false)).remaining,5);
 await store.reserve(reservation('cancel'));await store.finish('cancel','cancelled',false);
 await store.reserve(reservation('source'));await store.finish('source','error',false);
 assert.equal((await store.quota('ip:guest',false)).remaining,3);
});
test('leases refund abandoned workers and block stale heartbeat',async t=>{
 const {store,advance}=await setup(t);await store.reserve(reservation('crashed'));advance(90001);
 assert.equal((await store.quota('ip:guest',false)).remaining,5);
 assert.deepEqual(await store.heartbeat('test-worker',['crashed']),[]);
 await assert.rejects(store.finish('crashed','done'),/caducó/);
 await store.reserve(reservation('next'));assert.deepEqual(await store.heartbeat('test-worker',['next']),['next']);
});
test('quota survives database close/reopen and failed local enqueue releases reservation',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'vydo-store-test-'));let b;t.after(async()=>{await b?.close();await rm(dir,{recursive:true,force:true});});
 const filename=path.join(dir,'persist.sqlite');const a=new Store(await sqliteAdapter(filename));
 await a.reserve(reservation('saved'));await a.finish('saved','done');await a.close();
 b=new Store(await sqliteAdapter(filename));
 assert.equal((await b.quota('ip:guest',false)).remaining,4);
 await b.reserve(reservation('not-enqueued'));await b.release('not-enqueued');assert.equal((await b.quota('ip:guest',false)).remaining,4);
});
test('history isolation, deleting history never restores quota, shared IP accounts remain independent',async t=>{
 const {store}=await setup(t);await store.reserve(reservation('first',true));await store.finish('first','done');
 await store.reserve({...reservation('second',true),subject:'u:other',userId:'other'});await store.finish('second','done');
 assert.equal((await store.history('user')).length,1);await store.deleteHistory('other','first');assert.equal((await store.history('user')).length,1);
 await store.deleteHistory('user','first');assert.equal((await store.history('user')).length,0);assert.equal((await store.quota('u:user',true)).remaining,14);
 await store.updateProfile('user',{name:'User',format:'flac',quality:'1080'});assert.equal((await store.profile('other')).format,'mp3');
 await store.saveSession('session','encrypted','user',Date.now()+10000);await store.eraseUser('user');assert.equal(await store.session('session'),null);
});
test('IP headers ignored from untrusted peers; trusted chains parsed right to left; IPv6 guard',()=>{
 const req={socket:{remoteAddress:'192.0.2.5'},headers:{'x-forwarded-for':'203.0.113.10'}};
 assert.equal(clientIP(req), '192.0.2.5');
 assert.equal(clientIP(req,['192.0.2.0/24']), '203.0.113.10');
 req.headers['x-forwarded-for']='198.51.100.99, 203.0.113.10';assert.equal(clientIP(req,['192.0.2.0/24']),'203.0.113.10');
 req.headers['x-forwarded-for']='bad';assert.throws(()=>clientIP(req,['192.0.2.0/24']));
 assert.equal(networkIP('2001:db8:1:2:1234::1'),networkIP('2001:db8:1:2:abcd::5'));
 const key=randomBytes(32),encrypted=seal(key,{token:'secret'});assert(!encrypted.includes('secret'));assert.deepEqual(unseal(key,encrypted),{token:'secret'});assert.throws(()=>unseal(randomBytes(32),encrypted));
});

test('session compare-and-swap prevents a concurrent stale refresh from overwriting newer tokens',async t=>{
 const {store}=await setup(t);const version=await store.saveSession('sid','first','user',Date.now()+100000,-1);
 await store.saveSession('sid','refreshed','user',Date.now()+100000,version);
 await assert.rejects(store.saveSession('sid','stale','user',Date.now()+100000,version),/otra solicitud/);
 assert.equal((await store.session('sid')).payload,'refreshed');
});

test('initial profile name is stored safely and never overwrites existing preferences',async t=>{
 const {store}=await setup(t);assert.equal((await store.profile('name-user','Álex <name>')).name,'Álex <name>');
 await store.updateProfile('name-user',{name:'Edited',format:'flac',quality:'1080'});const profile=await store.profile('name-user','Different metadata');
 assert.equal(profile.name,'Edited');assert.equal(profile.format,'flac');assert.equal(profile.quality,'1080');
});
