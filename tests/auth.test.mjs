import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createAuth} from '../auth.mjs';
import {Store,sqliteAdapter} from '../store.mjs';
import {unseal,seal} from '../security.mjs';
const id='11111111-1111-4111-8111-111111111111';
const claims={sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'};
const access=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.test-signature';
const verified={id,email:'alice@example.test',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false,user_metadata:{role:'admin',downloads:999}};
function response(){const headers={};return {getHeader:name=>headers[name],setHeader:(name,value)=>{headers[name]=value;},headers};}
function cookies(res){return (res.headers['Set-Cookie']||[]).map(v=>v.split(';')[0]).join('; ');}
async function setup(t){
 const store=new Store(await sqliteAdapter(':memory:')),key=randomBytes(32),requests=[];let revoked=false,unverified=false;
 const upstream=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
  requests.push({url:req.url,body,authorization:req.headers.authorization});
  res.setHeader('Content-Type','application/json');
  const user={...verified,email_confirmed_at:unverified?null:verified.email_confirmed_at};
  if(req.url.startsWith('/auth/v1/token')){
   const grant=new URL(req.url,'http://localhost').searchParams.get('grant_type');
   if(grant==='pkce'&&(!body.code_verifier||body.auth_code!=='authorized-code')){res.writeHead(400);return res.end(JSON.stringify({error:'invalid_grant'}));}
   revoked=false;return res.end(JSON.stringify({access_token:access,refresh_token:'test-refresh-token',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user}));
  }
  if(req.url.startsWith('/auth/v1/user')){
   if(revoked||req.headers.authorization!=='Bearer '+access){res.writeHead(401);return res.end(JSON.stringify({error:'invalid_token',message:'Invalid token'}));}
   return res.end(JSON.stringify(user));
  }
  if(req.url.startsWith('/auth/v1/logout')){revoked=true;return res.end('{}');}
  if(req.url.startsWith('/auth/v1/admin/users/'))return res.end(JSON.stringify({user}));
  if(req.url.startsWith('/auth/v1/signup'))return res.end(JSON.stringify({user}));
  if(req.url.startsWith('/auth/v1/recover'))return res.end('{}');
  res.writeHead(404);res.end('{}');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+upstream.address().port;
 const auth=createAuth({store,key,origin:'http://localhost:3000',url,publishableKey:'test-publishable-not-a-real-key',serviceKey:'test-service-not-a-real-key',google:true});
 t.after(async()=>{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await store.close();});
 return {auth,store,key,requests,url,revoke:()=>{revoked=true;},unverify:()=>{unverified=true;}};
}
test('real Supabase SDK uses server validation, HttpOnly opaque session, encryption and logout',async t=>{
 const {auth,store,key,requests,revoke}=await setup(t);const res=response();
 await auth.action('login',{headers:{}},res,{email:verified.email,password:'test-password'});
 const raw=JSON.stringify(res.headers);assert.match(raw,/HttpOnly/);assert(!raw.includes(access));assert(!raw.includes('refresh'));
 const req={headers:{cookie:cookies(res)}};let user=await auth.resolve(req,response());assert.equal(user.id,id);assert.equal(user.downloads,undefined);
 assert(requests.some(r=>r.url==='/auth/v1/user'&&r.authorization==='Bearer '+access));
 const rows=await store.db.tx(q=>q('SELECT * FROM vydo_sessions'));assert.equal(rows.length,1);assert(!rows[0].payload.includes(access));
 // An expired token must be refreshed via Supabase, not accepted from decoded claims.
 const state=unseal(key,rows[0].payload);
 for(const k of Object.keys(state.storage))if(k.endsWith('-auth-token')){const saved=JSON.parse(state.storage[k]);saved.expires_at=1;state.storage[k]=JSON.stringify(saved);}
 await store.saveSession(rows[0].id,seal(key,state),id,Date.now()+100000);
 user=await auth.resolve(req,response());assert.equal(user.id,id);assert(requests.some(r=>r.url.includes('grant_type=refresh_token')));
 await auth.logout(user,req,response());assert.equal(await auth.resolve(req,response()),null);
});
test('unverified email cannot receive authenticated identity',async t=>{
 const {auth,unverify}=await setup(t);unverify();await assert.rejects(auth.action('login',{headers:{}},response(),{email:verified.email,password:'test-password'}),/Verifica/);
});
test('Google and email PKCE verification, missing-verifier rejection and recovery are prepared with real SDK',async t=>{
 const {auth,url,requests}=await setup(t);const res=response();
 const oauth=await auth.action('google',{headers:{}},res,{});const target=new URL(oauth.url);assert.equal(target.origin,url);assert.equal(target.searchParams.get('provider'),'google');assert(target.searchParams.has('code_challenge'));
 const req={headers:{cookie:cookies(res)}};
 await assert.rejects(auth.callback({headers:{}},response(),'authorized-code'),/mismo navegador/);
 assert.equal(await auth.callback(req,response(),'authorized-code'),'/');assert(requests.some(r=>r.url.includes('grant_type=pkce')&&r.body.code_verifier));
 const signup=response();await auth.action('signup',{headers:{}},signup,{email:verified.email,password:'test-password'});
 assert(requests.some(r=>r.url.startsWith('/auth/v1/signup')&&r.body.code_challenge));
 const recovery=response();await auth.action('recover',{headers:{}},recovery,{email:verified.email});
 assert(requests.some(r=>r.url.startsWith('/auth/v1/recover')&&r.body.code_challenge));
 assert.equal(await auth.callback({headers:{cookie:cookies(recovery)}},response(),'authorized-code',true),'/?account=recovery');
});
test('account deletion revokes sessions first, uses server-only admin key and erases metadata',async t=>{
 const {auth,store,requests}=await setup(t);const res=response();await auth.action('login',{headers:{}},res,{email:verified.email,password:'test-password'});
 const req={headers:{cookie:cookies(res)}},user=await auth.resolve(req,response());await store.profile(user.id);
 await auth.deleteAccount(user);
 assert.equal((await store.db.tx(q=>q('SELECT * FROM vydo_profiles'))).length,0);
 const logout=requests.findIndex(r=>r.url.includes('/logout')&&r.url.includes('global'));
 const deletion=requests.findIndex(r=>r.url.includes('/admin/users/'));
 assert(logout>=0&&deletion>logout);assert.equal(requests[deletion].authorization,'Bearer test-service-not-a-real-key');
 assert.equal(await auth.resolve(req,response()),null);
});
