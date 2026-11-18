import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnstile} from '../turnstile.mjs';
const options={siteKey:'production-site-fixture',secretKey:'private-test-fixture',origin:'https://vydo.download'};
test('Turnstile performs server Siteverify and validates hostname/action without exposing secret',async()=>{
 let calls=0;
 const gate=createTurnstile({...options,request:async(url,req)=>{
  calls++;assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(req.method,'POST');
  assert.deepEqual(JSON.parse(req.body),{secret:options.secretKey,response:'one-use-token'});
  return Response.json({success:true,hostname:'vydo.download',action:'signup'});
 }});
 assert(!JSON.stringify(gate.config).includes(options.secretKey));
 await assert.rejects(gate.verify(''),/Completa/);assert.equal(calls,0);
 await gate.verify('one-use-token');assert.equal(calls,1);
});
test('Turnstile fails closed for wrong hostname/action, replay, upstream failure and missing configuration',async()=>{
 for(const response of [{success:true,hostname:'evil.example',action:'signup'},{success:true,hostname:'vydo.download',action:'login'},
  {success:false,'error-codes':['timeout-or-duplicate']},{success:false,'error-codes':['invalid-input-response']}]){
  const gate=createTurnstile({...options,request:async()=>Response.json(response)});
  await assert.rejects(gate.verify('token'),e=>e.status===400&&!e.message.includes(options.secretKey));
 }
 const failed=createTurnstile({...options,request:async()=>{throw Error('network');}});
 await assert.rejects(failed.verify('token'),e=>e.status===503);
 const missing=createTurnstile({origin:options.origin,siteKey:'',secretKey:''});assert.equal(missing.config.enabled,false);
 await assert.rejects(missing.verify('token'),e=>e.status===503);
 assert.equal(createTurnstile({...options,siteKey:'1x00000000000000000000AA'}).config.enabled,false);
});
