// Opt-in network integration check. Never run against content without authorization.
import {createApp} from '../server.mjs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {parseYoutubeUrl} from '../lib.mjs';

if(process.env.VYDO_TEST_AUTHORIZED!=='yes'||!process.env.VYDO_TEST_URL)throw Error('Set VYDO_TEST_URL and VYDO_TEST_AUTHORIZED=yes only for authorized content.');
const url=parseYoutubeUrl(process.env.VYDO_TEST_URL);
const password=randomBytes(32).toString('hex');
const app=await createApp({password});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+app.server.address().port;
async function api(route,data){const r=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+password,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value;}
const report={date:new Date().toISOString(),url,results:[]};
try{
 const {preview}=await api('/api/preview',{url,authorized:true});report.preview=preview;console.log('Preview:',preview.title,preview.qualities);
 const requested=(process.env.VYDO_TEST_FORMATS||'mp4:360,mp3').split(',');
 for(const spec of requested){
   const [format,quality='720']=spec.split(':');
   const {job:started}=await api('/api/jobs',{url,authorized:true,previewId:preview.id,format,quality});
   let job,phase;
   for(let n=0;n<1300;n++){
     ({job}=await api('/api/jobs/'+started.id));
     if(job.progress.phase!==phase){phase=job.progress.phase;console.log(format,quality,phase);}
     if(!['queued','processing'].includes(job.status))break;
     await new Promise(r=>setTimeout(r,1000));
   }
   if(job.status!=='done')throw Error(job.error||'Integration timed out');
   const response=await fetch(base+'/api/jobs/'+job.id+'/download',{headers:{Authorization:'Bearer '+password}});
   if(!response.ok)throw Error('File endpoint failed');
   const bytes=(await response.arrayBuffer()).byteLength;
   const internal=app.jobs.get(job.id,'api');
   const check=spawnSync(process.env.FFMPEG_BIN||'ffmpeg',['-v','info','-i',internal.file,'-f','null','-'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});
   if(check.status!==0)throw Error('FFmpeg could not decode downloaded output');
   const streams=check.stderr.split(/\r?\n/).filter(s=>/Stream.*(Video:|Audio:)/.test(s)).map(s=>s.trim());
   if(format==='mp4'&&!streams.some(s=>new RegExp(`\\d+x${quality}\\b`).test(s)))throw Error('Unexpected MP4 resolution');
   report.results.push({format,quality:format==='mp4'?quality:null,bytes,decode:'passed',streams});
   console.log('PASS',format,quality,bytes,'bytes');
 }
 report.status='passed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;console.error(e.message);}
finally{await app.close();if(process.env.VYDO_TEST_REPORT)await writeFile(process.env.VYDO_TEST_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
