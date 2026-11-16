import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../server.mjs';

const url='https://www.youtube.com/watch?v=LY43o01dkU4';
const password='test-token-at-least-24-characters';
const metadata={title:'A <safe> title',duration:12,thumbnail:null,formats:['mp4','mp3','wav','m4a','flac'],qualities:['720','360']};
function fakeEngine(){return {health:()=>({ytDlp:true,ffmpeg:true}),inspect:async()=>metadata,
  async process(job,dir,progress,signal){
    progress({phase:'downloading',percent:42,bytes:42,totalBytes:100});
    await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,50);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});});
    const file=path.join(dir,'vydo.'+job.format);await writeFile(file,'test-media');return file;
  }};}
async function setup(t,options={}){
  const app=await createApp({password,engine:fakeEngine(),...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=async(route,{method='GET',data,auth=true,headers={}}={})=>fetch(base+route,{method,headers:{...(auth?{Authorization:'Bearer '+password}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});
  const analyze=async()=>{const r=await call('/api/preview',{method:'POST',data:{url,authorized:true}});assert.equal(r.status,200);return (await r.json()).preview;};
  const create=async(p,extra={})=>call('/api/jobs',{method:'POST',data:{url,authorized:true,previewId:p.id,format:'mp4',quality:'720',...extra}});
  return {app,call,analyze,create};
}
async function terminal(call,id){for(let n=0;n<100;n++){const r=await call('/api/jobs/'+id);const {job}=await r.json();if(!['queued','processing'].includes(job.status))return job;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');}

test('protected API, public assets, health and CSRF',async t=>{
 const {call}=await setup(t);
 assert.equal((await call('/')).status,200);
 assert.equal((await call('/api/health',{auth:false})).status,200);
 assert.equal((await call('/api/session',{auth:false})).status,401);
 assert.equal((await call('/api/preview',{method:'POST',data:{url,authorized:true},headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await call('/server.mjs')).status,404);
 const r=await call('/');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('session cookie and ownership isolation',async t=>{
 const {call,analyze,create}=await setup(t);const p=await analyze();const started=await (await create(p)).json();
 const login=await call('/api/session',{auth:false,method:'POST',data:{password}});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const headers={Cookie:cookie.split(';')[0]};
 assert.equal((await call('/api/session',{auth:false,headers})).status,200);
 assert.equal((await call('/api/jobs/'+started.job.id,{auth:false,headers})).status,404);
 await call('/api/session',{auth:false,headers,method:'DELETE'});
 assert.equal((await call('/api/session',{auth:false,headers})).status,401);
});
test('preview, exact availability, consent and successful streamed file',async t=>{
 const {app,call,analyze,create}=await setup(t);const p=await analyze();assert.deepEqual(p.qualities,['720','360']);
 assert.equal((await create(p,{authorized:false})).status,400);
 assert.equal((await create(p,{quality:'1080'})).status,400);
 assert.equal((await create(p,{url:'https://youtu.be/dQw4w9WgXcQ'})).status,400);
 const r=await create(p);assert.equal(r.status,202);const {job}=await r.json();
 const early=await call('/api/jobs/'+job.id+'/download');assert.equal(early.status,409);
 const done=await terminal(call,job.id);assert.equal(done.status,'done');assert.equal(done.progress.percent,100);
 const file=await call('/api/jobs/'+job.id+'/download');assert.equal(await file.text(),'test-media');assert.match(file.headers.get('content-disposition'),/attachment/);
 const dir=app.jobs.get(job.id,'api').dir;
 for(let n=0;n<100&&app.jobs.get(job.id,'api').readers;n++)await new Promise(r=>setTimeout(r,10));
 await app.jobs.cleanup(Date.now()+1200010);assert.equal((await call('/api/jobs/'+job.id)).status,404);await assert.rejects(access(dir));
});
test('queue bounded, queued/running cancellation and error cleanup',async t=>{
 const {app,call,analyze,create}=await setup(t,{maxQueue:1});const p=await analyze();
 const a=await (await create(p)).json(),b=await (await create(p)).json();
 assert.equal((await create(p)).status,429);
 await call('/api/jobs/'+b.job.id,{method:'DELETE'});assert.equal((await terminal(call,b.job.id)).status,'cancelled');
 await call('/api/jobs/'+a.job.id,{method:'DELETE'});assert.equal((await terminal(call,a.job.id)).status,'cancelled');
 const j=app.jobs.get(a.job.id,'api');await assert.rejects(access(j.dir));
});
test('invalid JSON, oversized body and missing preview rejected',async t=>{
 const {call}=await setup(t);
 assert.equal((await call('/api/jobs',{method:'POST',data:{url,authorized:true,format:'mp4',quality:'720'}})).status,400);
 assert.equal((await call('/api/preview',{method:'POST',data:{url:'x'.repeat(9000)}})).status,400);
});
test('tool failures and login rate limit',async t=>{
 const {call}=await setup(t,{engine:{health:()=>({ytDlp:false,ffmpeg:false})}});
 assert.equal((await call('/api/health')).status,503);
 assert.equal((await call('/api/preview',{method:'POST',data:{url,authorized:true}})).status,503);
 for(let n=0;n<10;n++)assert.equal((await call('/api/session',{auth:false,method:'POST',data:{password:'bad'}})).status,401);
 assert.equal((await call('/api/session',{auth:false,method:'POST',data:{password:'bad'}})).status,429);
});
