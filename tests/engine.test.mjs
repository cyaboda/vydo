import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,stat,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {preview,downloadProgress,run,createEngine} from '../engine.mjs';
const info={title:'Video',id:'LY43o01dkU4',duration:3,availability:'public',formats:[{height:360,vcodec:'h264',acodec:'aac'},{height:1080,vcodec:'vp9',acodec:'none'},{height:720,vcodec:'h264',has_drm:true}]};
test('metadata exposes exact resolutions and safe thumbnails only',()=>{
 const p=preview({...info,thumbnail:'https://evil.test/x'},1800);assert.equal(p.thumbnail,null);assert.deepEqual(p.qualities,['1080','360']);assert.equal(p.formats.length,5);
 assert.match(preview({...info,thumbnail:'https://i.ytimg.com/vi/x/default.jpg'},1800).thumbnail,/ytimg/);
 for(const x of [{is_live:true},{duration:2000},{availability:'needs_auth'},{has_drm:true}])assert.throws(()=>preview({...info,...x},1800));
});
test('progress is derived from downloaded bytes and handles unknown totals',()=>{
 assert.equal(downloadProgress('vydo:{"downloaded_bytes":25,"total_bytes":100}').percent,25);
 assert.equal(downloadProgress('vydo:{"downloaded_bytes":25}').percent,null);
 assert.equal(downloadProgress('bad'),null);assert.equal(downloadProgress('vydo:bad'),null);
});
test('subprocess output, bounded output, cancellation, failure and timeout',async()=>{
 assert.equal((await run(process.execPath,['-e','console.log("ok")'])).trim(),'ok');
 await assert.rejects(run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:50}),/tiempo/);
 await assert.rejects(run(process.execPath,['-e','console.log("x".repeat(2000))'],{maxOutput:100}),/límite/);
 await assert.rejects(run(process.execPath,['-e','process.exit(1)']),/procesar/);
 const c=new AbortController();const p=run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:c.signal});c.abort();await assert.rejects(p,/cancelado/);
});
test('engine uses isolated configuration and exact quality, never cookies or DRM bypass',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'vydo-engine-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[];const engine=createEngine({execute:async(bin,args,opts)=>{
   calls.push(args);if(args.includes('--skip-download'))return JSON.stringify(info);
   if(args.includes('-f')){await writeFile(path.join(dir,'source.mp4'),'source');opts.onLine('vydo:{"downloaded_bytes":2,"total_bytes":4}');}
   else {await writeFile(args.at(-1),'result');opts.onLine('out_time_us=1500000');}
   return '';
 }});
 await engine.inspect('https://www.youtube.com/watch?v=LY43o01dkU4');
 const updates=[];await engine.process({url:'https://www.youtube.com/watch?v=LY43o01dkU4',format:'mp4',quality:'360',duration:3},dir,p=>updates.push(p));
 const args=calls[1];assert.equal(args[args.indexOf('-f')+1],'bv[height=360]+ba/b[height=360]');assert(args.includes('--ignore-config'));assert(args.includes('--no-plugin-dirs'));
 assert(!args.some(a=>/cookies|allow-unplayable|username|password/.test(a)));assert(updates.some(p=>p.percent===50));assert(calls[2].includes('libx264'));
});

test('real FFmpeg converts a synthetic source into all five formats',{skip:!process.env.FFMPEG_BIN},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'vydo-ffmpeg-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const bin=process.env.FFMPEG_BIN,fixture=path.join(dir,'fixture.mp4');
 await run(bin,['-y','-f','lavfi','-i','color=c=blue:s=640x360:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',fixture]);
 for(const format of ['mp4','mp3','wav','m4a','flac']){
   const target=await mkdtemp(path.join(dir,'convert-'));
   const engine=createEngine({ffmpeg:bin,execute:async(binary,args,options)=>{
     if(args.includes('-f')&&args.includes('--no-playlist')){await copyFile(fixture,path.join(target,'source.mp4'));return '';}
     return run(binary,args,options);
   }});
   const file=await engine.process({format,quality:'360',url:'https://youtu.be/LY43o01dkU4',duration:1},target,()=>{});
   assert((await stat(file)).size>100);
   await run(bin,['-v','error','-i',file,'-f','null','-']);
 }
});
