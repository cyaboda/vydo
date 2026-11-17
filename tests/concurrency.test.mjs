import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sqliteAdapter} from '../store.mjs';

test('independent Node processes cannot exceed the simultaneous SQLite reservation',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'vydo-multiprocess-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
 const file=path.join(dir,'shared.sqlite'),initial=await sqliteAdapter(file);await initial.close();
 const module=new URL('../store.mjs',import.meta.url).href;
 function child(i){return new Promise((resolve,reject)=>{
  const code=`import {Store,sqliteAdapter} from ${JSON.stringify(module)};const s=new Store(await sqliteAdapter(process.argv[1]));try{await s.reserve({id:process.argv[2],subject:'ip:same',ip:'network',registered:false,worker:'child',title:'Title',videoId:'LY43o01dkU4',format:'mp3',quality:'720'});console.log('accepted');}catch(e){if(e.status===429)console.log('limited');else throw e;}finally{await s.close();}`;
  const p=spawn(process.execPath,['--input-type=module','-e',code,file,'job'+i],{windowsHide:true});let output='',error='';p.stdout.on('data',d=>{output+=d;});p.stderr.on('data',d=>{error+=d;});p.on('error',reject);p.on('close',exit=>exit?reject(Error(error)):resolve(output.trim()));
 });}
 const results=await Promise.all(Array.from({length:5},(_,i)=>child(i)));assert.equal(results.filter(x=>x==='accepted').length,1);assert.equal(results.filter(x=>x==='limited').length,4);
});
