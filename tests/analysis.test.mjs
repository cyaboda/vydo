import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,sqliteAdapter} from '../store.mjs';
import {createAnalysis} from '../analysis.mjs';
import {toolFailure,retryAfterSeconds} from '../media-errors.mjs';
import {run,createEngine} from '../engine.mjs';
const metadata={title:'Public fixture',duration:5,formats:['mp4'],qualities:['360']};
async function fixture(t,inspect){let now=1000000;const store=new Store(await sqliteAdapter(':memory:'),{clock:()=>now});
 const analysis=createAnalysis({store,engine:{inspect},report:()=>{}});t.after(async()=>{await analysis.close();await store.close();});return {store,analysis,advance:ms=>{now+=ms;}};}
test('duplicate analyses coalesce, successful metadata is cached briefly and expires',async t=>{
 let calls=0;const {analysis,advance}=await fixture(t,async()=>{calls++;await new Promise(r=>setTimeout(r,20));return metadata;});
 const [a,b]=await Promise.all([analysis.inspect('same'),analysis.inspect('same')]);assert.equal(calls,1);assert.deepEqual(a,b);
 a.title='Changed by caller';assert.equal((await analysis.inspect('same')).title,metadata.title);assert.equal(calls,1);
 advance(61000);await analysis.inspect('same');assert.equal(calls,2);
});
test('one cancelled subscriber does not cancel another; cancellation of all stops the source',async t=>{
 let stopped=0;const {analysis}=await fixture(t,(_,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(metadata),40);
  signal.addEventListener('abort',()=>{clearTimeout(timer);stopped++;reject(Error('aborted'));},{once:true});}));
 const a=new AbortController(),b=new AbortController(),first=analysis.inspect('same',a.signal),second=analysis.inspect('same',b.signal);
 a.abort();await assert.rejects(first,/cancelado/);assert.equal((await second).title,metadata.title);assert.equal(stopped,0);
 const c=new AbortController(),last=analysis.inspect('different',c.signal);await new Promise(r=>setTimeout(r,10));c.abort();await assert.rejects(last,/cancelado/);
 await new Promise(r=>setTimeout(r,10));assert.equal(stopped,1);
});
test('only a confirmed 429 pauses analyses; expiry permits one new probe with progressive backoff',async t=>{
 let calls=0;const {analysis,advance}=await fixture(t,async()=>{calls++;throw toolFailure('HTTP Error 429',{tool:'yt-dlp'});});
 await assert.rejects(analysis.inspect('first'),e=>e.retryAfter===1800&&e.status===503);
 await assert.rejects(analysis.inspect('other'),e=>e.retryAfter===1800&&e.diagnostic.code==='YOUTUBE_COOLDOWN');assert.equal(calls,1);
 advance(1801000);await assert.rejects(analysis.inspect('other'),e=>e.retryAfter===3600);assert.equal(calls,2);
});
test('403, private videos and internal errors never open the 429 circuit',async t=>{
 for(const text of ['HTTP Error 403','Private video','Unable to extract signature']){
  let calls=0;const {analysis}=await fixture(t,async()=>{calls++;throw toolFailure(text,{tool:'yt-dlp'});});
  await assert.rejects(analysis.inspect('first'));await assert.rejects(analysis.inspect('second'));assert.equal(calls,2);
 }
});
test('Retry-After delta/date are respected; malformed values use fallback and 403 stays distinct',async t=>{
 const now=Date.parse('2026-11-18T12:00:00Z');
 assert.equal(retryAfterSeconds('120',now),120);assert.equal(retryAfterSeconds('Wed, 18 Nov 2026 12:05:00 GMT',now),300);
 for(const value of ['-1','garbage','999999999999999999999999'])assert.equal(retryAfterSeconds(value,now),undefined);
 assert.equal(toolFailure('HTTP Error 429\nRetry-After: 300',{tool:'yt-dlp',now}).retryAfter,300);
 assert.equal(toolFailure('HTTP Error 403: rate limit title',{tool:'yt-dlp'}).diagnostic.code,'YOUTUBE_HTTP_403');
 const {analysis}=await fixture(t,async()=>{throw toolFailure('HTTP Error 429\nRetry-After: 7200',{tool:'yt-dlp'});});
 await assert.rejects(analysis.inspect('first'),e=>e.retryAfter===7200);
});
test('a subprocess is stopped promptly on confirmed 429 without retrying or logging stderr',async()=>{
 const entries=[],started=Date.now();
 await assert.rejects(run(process.execPath,['-e','process.stderr.write("HTTP Error 429\\nRetry-After: 30\\nSECRET_COOKIE=value\\n");setInterval(()=>{},1000)'],
  {tool:'yt-dlp',stage:'inspect',timeout:10000,onDiagnostic:e=>entries.push(e)}),e=>e.diagnostic.upstreamStatus===429&&e.retryAfter===30&&!e.internal);
 assert(Date.now()-started<5000);assert.equal(entries.length,1);assert(!JSON.stringify(entries).includes('SECRET_COOKIE'));
});
test('inspect has a short deadline, spaced requests and no HTTP/extractor retries',async()=>{
 let options,args;const engine=createEngine({execute:async(_,a,o)=>{args=a;options=o;return JSON.stringify({...metadata,id:'fixture',formats:[{height:360,vcodec:'h264',acodec:'aac'}]});}});
 await engine.inspect('https://youtu.be/LY43o01dkU4');assert.equal(options.timeout,45000);
 for(const flag of ['--retries','--fragment-retries','--extractor-retries'])assert.equal(args[args.indexOf(flag)+1],'0');
 assert.equal(args[args.indexOf('--socket-timeout')+1],'10');assert.equal(args[args.indexOf('--sleep-requests')+1],'1');
});
