import {toolFailure} from '../media-errors.mjs';
import {createTurnstile} from '../turnstile.mjs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {cookie,setCookie} from '../security.mjs';
const video='https://www.youtube.com/watch?v=LY43o01dkU4';
const metadata={title:'A <safe> title',duration:12,thumbnail:null,formats:['mp4','mp3','wav','m4a','flac'],qualities:['720','360']};
export function fakeEngine({internal=false,source=false,delay=50}={}) {return {health:()=>({ytDlp:true,ffmpeg:true}),inspect:async()=>metadata,
 async process(job,dir,progress,signal){
  progress({phase:'downloading',percent:42,bytes:42,totalBytes:100});
  await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delay);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});});
  if(internal)throw Object.assign(Error('Internal conversion failure'),{internal:true});if(source)throw Error('Source unavailable');
  const file=path.join(dir,'vydo.'+job.format);await writeFile(file,'test-media');return file;
 }};}
export function fakeAuth(){return {config:{enabled:true,google:false,canDelete:true},
 async resolve(req){const id=cookie(req,'test_user');return ['alice','bob'].includes(id)?{id,email:id+'@example.test',recent:Date.now()}:null;},
 async action(action,req,res,data){if(action==='login'){const id=data.email.split('@')[0];if(!['alice','bob'].includes(id))throw Object.assign(Error('Bad login'),{status:401});setCookie(res,'test_user',id);return {ok:true};}return {message:'Verification required'};},
 async logout(user,req,res){setCookie(res,'test_user','',{maxAge:0});return {ok:true};},async deleteAccount(){return {ok:true};}};}
export function client(base){const jar=new Map();return async(route,{method='GET',data,headers={}}={})=>{
 const response=await fetch(base+route,{method,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join(';'),...(data?{'Content-Type':'application/json'}:{}),Origin:base,...headers},body:data?JSON.stringify(data):undefined});
 for(const value of response.headers.getSetCookie()){const [name,v]=value.split(';')[0].split('=');if(v)jar.set(name,v);else jar.delete(name);}
 return response;
};}
export async function setup(t,options={}){
 const app=await createApp({engine:fakeEngine(),key:randomBytes(32),storeOptions:{filename:':memory:'},...options});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port,call=client(base);
 const analyze=async(c=call)=>{const response=await c('/api/preview',{method:'POST',data:{url:video}});assert.equal(response.status,200);return (await response.json()).preview;};
 const create=async(p,extra={},c=call)=>c('/api/jobs',{method:'POST',data:{url:video,previewId:p.id,format:'mp4',quality:'720',...extra}});
 return {app,call,base,analyze,create};
}
export async function terminal(call,id){for(let n=0;n<150;n++){const {job}=await (await call('/api/jobs/'+id)).json();if(!['queued','processing'].includes(job.status))return job;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');}

test('public access has no password barrier; internals and admin remain protected',async t=>{
 const {call}=await setup(t,{adminToken:'a'.repeat(32)});
 assert.equal((await call('/')).status,200);
 const session=await (await call('/api/session')).json();assert.equal(session.user,null);assert.equal(session.quota.remaining,5);assert.equal(session.auth.enabled,false);assert.equal(session.ad,null);
 for(const route of ['/server.mjs','/.env','/data/secret.key','/node_modules/pg/package.json'])assert.equal((await call(route)).status,404);
 assert.equal((await call('/api/profile')).status,401);assert.equal((await call('/api/admin/health')).status,401);
 assert.equal((await call('/api/admin/health',{headers:{Authorization:'Bearer '+'a'.repeat(32)}})).status,200);
 const html=await (await call('/')).text();assert(!html.includes('id="gate"'));assert(!html.includes('github.com'));
 for(const asset of ['/LOGO_BLACK.webp','/LOGO_WHITE.webp'])assert.equal((await call(asset)).headers.get('content-type'),'image/webp');
 assert.equal((await call('/theme.js')).status,200);
 assert.equal((await call('/api/preview',{method:'POST',data:{url:video},headers:{Origin:'https://evil.test'}})).status,403);
});
test('separate anonymous browsers on one IP share quota but never job ownership',async t=>{
 const {call,base,analyze,create}=await setup(t);const p=await analyze();const {job}=await (await create(p)).json();
 const other=client(base);assert.equal((await other('/api/jobs/'+job.id)).status,404);
 assert.equal((await (await other('/api/session')).json()).quota.remaining,4);
 assert.equal((await create(p,{},other)).status,400);
});
test('preview validation, exact quality, direct analysis, streaming and TTL preserved',async t=>{
 const title='Canción 日本語 (Official Video)';
 const {app,call,analyze,create}=await setup(t,{engine:{...fakeEngine(),inspect:async()=>({...metadata,title})}});const p=await analyze();
 assert.equal((await create(p,{quality:'1080'})).status,400);
 assert.equal((await create(p,{url:'https://youtu.be/dQw4w9WgXcQ'})).status,400);
 const started=await create(p);assert.equal(started.status,202);const {job}=await started.json();
 assert.equal((await call('/api/jobs/'+job.id+'/download')).status,409);
 assert.equal((await terminal(call,job.id)).status,'done');
 const file=await call('/api/jobs/'+job.id+'/download');assert.equal(await file.text(),'test-media');assert.match(file.headers.get('content-disposition'),/attachment/);
 let receipt;
 for(let n=0;n<100;n++){
   receipt=(await (await call('/api/jobs/'+job.id)).json()).job;
   if(receipt.transferCount===1)break;
   await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(receipt.transferCount,1);assert(receipt.downloadedAt);
 assert.equal(receipt.filename,title+'.mp4');assert.match(receipt.id,/^[a-f0-9]{48}$/);
 assert.equal(decodeURIComponent(file.headers.get('content-disposition').split("filename*=UTF-8''")[1]),title+'.mp4');
 const internal=app.jobs.items.get(job.id);for(let n=0;n<100&&internal.readers;n++)await new Promise(r=>setTimeout(r,5));
 const dir=internal.dir;await app.jobs.cleanup(Date.now()+1200010);assert.equal((await call('/api/jobs/'+job.id)).status,404);await assert.rejects(access(dir));
});
test('guest cannot accept a sixth download; spoofed X-Forwarded-For does not reset quota',async t=>{
 const {call,analyze,create}=await setup(t,{engine:fakeEngine({delay:1})});const p=await analyze();
 for(let n=0;n<5;n++){const result=await create(p);assert.equal(result.status,202);await terminal(call,(await result.json()).job.id);}
 const denied=await create(p);assert.equal(denied.status,429);assert(Number(denied.headers.get('retry-after'))>0);
 const session=await (await call('/api/session',{headers:{'X-Forwarded-For':'203.0.113.50'}})).json();assert.equal(session.quota.remaining,0);
});
test('registered users get fifteen; profiles/history isolated; logout restores guest identity',async t=>{
 const {call,base,analyze,create}=await setup(t,{auth:fakeAuth(),engine:fakeEngine({delay:1})});
 await call('/api/auth/login',{method:'POST',data:{email:'alice@example.test',password:'test-password'}});
 const p=await analyze();for(let n=0;n<15;n++){const r=await create(p);assert.equal(r.status,202);await terminal(call,(await r.json()).job.id);}
 assert.equal((await create(p)).status,429);assert.equal((await (await call('/api/session')).json()).quota.remaining,0);
 const alice=await (await call('/api/profile')).json();assert.equal(alice.history.length,15);
 const bob=client(base);await bob('/api/auth/login',{method:'POST',data:{email:'bob@example.test',password:'test-password'}});
 assert.equal((await (await bob('/api/session')).json()).quota.remaining,15);assert.equal((await (await bob('/api/profile')).json()).history.length,0);
 await bob('/api/profile/history/'+alice.history[0].id,{method:'DELETE'});assert.equal((await (await call('/api/profile')).json()).history.length,15);
 await call('/api/profile/history/'+alice.history[0].id,{method:'DELETE'});assert.equal((await (await call('/api/session')).json()).quota.remaining,0);
 await call('/api/profile',{method:'PATCH',data:{name:'Alice',format:'flac',quality:'1080'}});
 assert.equal((await (await call('/api/session')).json()).profile.name,'Alice');
 await call('/api/session',{method:'DELETE'});assert.equal((await (await call('/api/session')).json()).user,null);
});
test('simultaneous POST requests accept only one job for an identity',async t=>{
 const {analyze,create}=await setup(t,{engine:fakeEngine({delay:200})});const p=await analyze();
 const responses=await Promise.all(Array.from({length:6},()=>create(p)));
 assert.equal(responses.filter(r=>r.status===202).length,1);assert(responses.filter(r=>r.status!==202).every(r=>r.status===429));
});
test('internal failure refunds; source failure and user cancellation consume accepted quota',async t=>{
 for(const options of [{internal:true},{source:true},{}]){
  const {call,analyze,create}=await setup(t,{engine:fakeEngine(options)});const p=await analyze();const {job}=await (await create(p)).json();
  if(!options.internal&&!options.source)await call('/api/jobs/'+job.id,{method:'DELETE'});
  await terminal(call,job.id);const session=await (await call('/api/session')).json();assert.equal(session.quota.remaining,options.internal?5:4);
 }
});
test('unconfigured Auth stays optional; ads off by default and configured only by server',async t=>{
 const {call}=await setup(t);assert.equal((await call('/api/auth/login',{method:'POST',data:{email:'a@example.test',password:'test-password'}})).status,503);
 assert.equal((await call('/api/preview',{method:'POST',data:{url:'x'.repeat(9000)}})).status,400);
 const configured=await setup(t,{adConfig:{provider:'test-only',image:'https://ads.example.test/image.png',target:'https://ads.example.test/offer'}});
 const data=await (await configured.call('/api/session')).json();assert.equal(data.ad.provider,'test-only');
 assert.match((await configured.call('/')).headers.get('content-security-policy'),/https:\/\/ads.example.test/);
});

test('ephemeral cloud deployment refuses SQLite fallback when PostgreSQL is required',()=>{
 const result=spawnSync(process.execPath,['server.mjs'],{env:{...process.env,REQUIRE_POSTGRES:'true',DATABASE_URL:''},encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(result.status,1);assert.match(result.stderr,/Configura DATABASE_URL/);
});

test('signup requires name, matching passwords and server-verified captcha before calling Auth',async t=>{
 const auth=fakeAuth(),originalAction=auth.action;let signups=0,verified=0;
 auth.action=async(action,req,res,data)=>{if(action==='signup'){signups++;assert.equal(data.name,'Álex Mendoza');}return originalAction(action,req,res,data);};
 const gate=createTurnstile({origin:'https://vydo.download',siteKey:'real-shaped-fixture',secretKey:'private-test-secret',request:async()=>{verified++;return Response.json({success:true,hostname:'vydo.download',action:'signup'});}});
 const {call}=await setup(t,{auth,turnstile:gate});
 const data={name:'  Álex Mendoza  ',email:'alice@example.test',password:'strong-test-password',confirmPassword:'strong-test-password',captchaToken:'test-token'};
 for(const change of [{name:' '},{confirmPassword:'different-password'},{captchaToken:''}]){
  const result=await call('/api/auth/signup',{method:'POST',data:{...data,...change}});assert.equal(result.status,400);assert.equal(signups,0);
 }
 const ok=await call('/api/auth/signup',{method:'POST',data});assert.equal(ok.status,200);assert.equal(signups,1);assert.equal(verified,1);
 const publicState=await (await call('/api/session')).json();assert.equal(publicState.auth.signup,true);assert(!JSON.stringify(publicState).includes('private-test-secret'));
});
test('missing Turnstile configuration disables signup clearly while downloads remain public',async t=>{
 const {call,analyze}=await setup(t,{auth:fakeAuth()});
 const state=await (await call('/api/session')).json();assert.equal(state.auth.signup,false);assert.equal(state.quota.limit,5);
 const result=await call('/api/auth/signup',{method:'POST',data:{name:'Álex',email:'a@example.test',password:'test-password',confirmPassword:'test-password',captchaToken:'token'}});
 assert.equal(result.status,503);await analyze();
});

test('confirmed 429 suspends only analysis, provides Retry-After and consumes no visitor or account quota',async t=>{
 for(const registered of [false,true]){let calls=0;const engine={...fakeEngine(),inspect:async()=>{calls++;throw toolFailure('HTTP Error 429',{tool:'yt-dlp'});}};
 const {app,call}=await setup(t,{auth:fakeAuth(),engine});const now=Date.now();app.store.clock=()=>now;if(registered)await call('/api/auth/login',{method:'POST',data:{email:'alice@example.test',password:'test-password'}});
 const before=(await (await call('/api/session')).json()).quota;
 for(let n=0;n<2;n++){const response=await call('/api/preview',{method:'POST',data:{url:video}});assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'1800');
 const result=await response.json();assert.equal(result.retryAfter,1800);assert.match(result.error,/YouTube limita/);}
 assert.equal(calls,1);const after=(await (await call('/api/session')).json()).quota;assert.equal(after.remaining,before.remaining);assert.equal(after.used,0);
 assert.equal((await call('/api/health')).status,200);assert.equal((await call('/')).status,200);if(registered)assert.equal((await call('/api/profile')).status,200);
 }
});

test('coalesced metadata never shares preview ownership between visitors',async t=>{
 let calls=0;const {call,base,create}=await setup(t,{engine:{...fakeEngine(),inspect:async()=>{calls++;await new Promise(r=>setTimeout(r,25));return metadata;}}});
 const other=client(base);await call('/api/session');await other('/api/session');
 const responses=await Promise.all([call('/api/preview',{method:'POST',data:{url:video}}),other('/api/preview',{method:'POST',data:{url:video}})]);
 const [a,b]=await Promise.all(responses.map(r=>r.json()));assert.equal(calls,1);assert.notEqual(a.preview.id,b.preview.id);assert.equal((await create(a.preview,{},other)).status,400);
 await call('/api/preview',{method:'POST',data:{url:video}});assert.equal(calls,1);
});
