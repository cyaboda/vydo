import {spawn, spawnSync} from 'node:child_process';
import {readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {QUALITIES} from './lib.mjs';
import {toolFailure} from './media-errors.mjs';

export function preview(info, maxDuration) {
  if (info.is_live || info.is_upcoming || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > maxDuration)
    throw Error('Solo se admiten videos finalizados de duración permitida.');
  if (info.has_drm || !['public', 'unlisted', undefined, null].includes(info.availability))
    throw Error('No se admite contenido protegido o con acceso restringido.');
  const formats = (info.formats || []).filter(f => !f.has_drm);
  const qualities = [...QUALITIES].filter(q => formats.some(f => f.height === Number(q) && f.vcodec && f.vcodec !== 'none'));
  const audio = formats.some(f => f.acodec && f.acodec !== 'none');
  let thumbnail = null;
  try { const u = new URL(info.thumbnail); if (u.protocol === 'https:' && ['i.ytimg.com','i9.ytimg.com'].includes(u.hostname)) thumbnail = u.href; } catch {}
  return {id:info.id, title:String(info.title || 'Video').slice(0,300), duration:info.duration,
    thumbnail, qualities, formats:[...(qualities.length ? ['mp4'] : []), ...(audio ? ['mp3','wav','m4a','flac'] : [])]};
}

// Each percentage describes the current tool/stage, never a fabricated overall percentage.
export function downloadProgress(line) {
  if (!line.startsWith('vydo:')) return null;
  try { const p = JSON.parse(line.slice(5)); const total = p.total_bytes || p.total_bytes_estimate;
    return {phase:'downloading', percent:total > 0 ? Math.min(100, p.downloaded_bytes / total * 100) : null,
      bytes:p.downloaded_bytes || 0, totalBytes:total || null, speed:p.speed || null, eta:p.eta ?? null};
  } catch { return null; }
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:2000});
    child.kill('SIGKILL');
  }
  else { try { process.kill(-child.pid,'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

export function run(binary, args, {signal, timeout=120000, maxOutput=8*1024*1024, onLine=()=>{},tool='process',stage='unknown',version=null,onDiagnostic=entry=>console.error(JSON.stringify(entry))}={}) {
  return new Promise((resolve,reject) => {
    if (signal?.aborted) return reject(Error('Trabajo cancelado.'));
    const child = spawn(binary,args,{windowsHide:true,detached:process.platform !== 'win32',stdio:['ignore','pipe','pipe']});
    let output='', pending='', failure, stderr='',limited=false;
    const stop = message => { failure ||= Object.assign(Error(message),{internal:!signal?.aborted}); killTree(child); };
    const abort = () => stop('Trabajo cancelado.');
    signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(()=>stop('Se agotó el tiempo de procesamiento.'),timeout);
    child.stdout.on('data', chunk => {
      output += chunk.toString(); pending += chunk.toString();
      if (Buffer.byteLength(output) > maxOutput) { stop('La herramienta excedió el límite de salida.'); output=''; pending=''; return; }
      const lines = pending.split(/\r?\n/); pending=lines.pop(); lines.forEach(onLine);
    });
    child.stderr.on('data',d => {
      stderr=(stderr+d.toString()).slice(-4000);
      if(!limited&&!failure&&tool==='yt-dlp'&&/\bHTTP(?:\s+Error|\/[\d.]+)?[: ]+429\b/i.test(stderr)){limited=true;killTree(child);}
    });
    child.on('error',e => { failure=e; });
    child.on('close',code => {
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
      if(limited&&!failure&&!signal?.aborted){const error=toolFailure(stderr,{tool,stage,version,exitCode:code});error.diagnostic.stoppedEarly=true;try{onDiagnostic(error.diagnostic);}catch{}return reject(error);}
      if (failure) {
        if(!signal?.aborted){
          const safe=toolFailure('',{tool,stage,version,exitCode:code});
          safe.diagnostic.code=failure.code?'TOOL_START_FAILURE':/tiempo/.test(failure.message)?'TOOL_TIMEOUT':'TOOL_OUTPUT_LIMIT';
          safe.message=failure.code?'No se pudo iniciar la herramienta multimedia en el servidor.':failure.message;
          safe.internal=true;try{onDiagnostic(safe.diagnostic);}catch{}return reject(safe);
        }
        return reject(failure);
      }
      if (code !== 0) {const error=toolFailure(stderr,{tool,stage,version,exitCode:code});try{onDiagnostic(error.diagnostic);}catch{}return reject(error);}
      if(pending)onLine(pending); resolve(output);
    });
  });
}

export function createEngine({ytDlp=process.env.YTDLP_BIN||'yt-dlp', ffmpeg=process.env.FFMPEG_BIN||'ffmpeg', maxDuration=1800, maxBytes=512*1024*1024, timeout=600000,inspectTimeout=45000, execute=run}={}) {
  let probes;
  const probe=()=>probes||=(function(){
    const y=spawnSync(ytDlp,['--version'],{timeout:10000,windowsHide:true,encoding:'utf8',maxBuffer:65536});
    const f=spawnSync(ffmpeg,['-version'],{timeout:10000,windowsHide:true,encoding:'utf8',maxBuffer:65536});
    return {ytDlp:y.status===0,ffmpeg:f.status===0,versions:{ytDlp:y.stdout?.match(/^([\w.+-]{1,60})/)?.[1]||null,ffmpeg:f.stdout?.match(/^ffmpeg version ([\w.+-]{1,60})/)?.[1]||null,node:process.version}};
  })();
  const common = ['--ignore-config','--no-plugin-dirs','--no-cache-dir','--js-runtimes',`node:${process.execPath}`,
    '--no-playlist','--ffmpeg-location',ffmpeg];
  return {
    health() {const tools=probe();return {ytDlp:tools.ytDlp,ffmpeg:tools.ffmpeg};},
    versions(){return {...probe().versions};},
    async inspect(url, signal) {
      const raw=await execute(ytDlp,[...common,'--socket-timeout','10','--retries','0','--fragment-retries','0','--extractor-retries','0','--sleep-requests','1','--skip-download','--dump-single-json','--',url],{signal,timeout:inspectTimeout,tool:'yt-dlp',stage:'inspect',version:probes?.versions.ytDlp||null});
      let info;try{info=JSON.parse(raw);}catch{throw Object.assign(Error('El analizador devolvió una respuesta no válida.'),{internal:true});}
      return preview(info,maxDuration);
    },
    async process(job, dir, onProgress, signal) {
      const source=path.join(dir,'source.%(ext)s');
      const selection=job.format==='mp4' ? `bv[height=${job.quality}]+ba/b[height=${job.quality}]` : 'ba/b';
      // Disk limit includes fragments and converted output, not only the reported remote filesize.
      const controller=new AbortController();
      const abort=()=>controller.abort(); signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)controller.abort();
      let diskError=false, checking=false;
      const monitor=setInterval(async()=>{
        if(checking)return; checking=true;
        try { const sizes=await Promise.all((await readdir(dir)).map(async n=>(await stat(path.join(dir,n))).size));
          if(sizes.reduce((a,b)=>a+b,0)>maxBytes){diskError=true;controller.abort();}
        } catch {} finally {checking=false;}
      },1000);
      try {
        onProgress({phase:'preparing',percent:null});
        await execute(ytDlp,[...common,'--socket-timeout','20','--retries','1','--fragment-retries','1','--newline','--progress','--progress-delta','1','--progress-template','download:vydo:%(progress)j',
          '--max-filesize',String(maxBytes),'--match-filter',`!is_live & duration <= ${maxDuration}`,
          '-f',selection,'--merge-output-format','mkv','-o',source,'--',job.url],
          {signal:controller.signal,timeout,tool:'yt-dlp',stage:'download',version:probes?.versions.ytDlp||null,onLine:line=>{const p=downloadProgress(line);if(p)onProgress(p);}});
        const files=(await readdir(dir)).filter(n=>/^source\.(mp4|mkv|webm|m4a|mp3|ogg|opus|flv|wav)$/.test(n));
        if(files.length!==1)throw Error('No se generó un archivo de origen válido.');
        const output=path.join(dir,`vydo.${job.format}`);
        const codecs={mp3:['-vn','-c:a','libmp3lame','-q:a','0'],wav:['-vn','-c:a','pcm_s16le'],
          m4a:['-vn','-c:a','aac','-b:a','192k'],flac:['-vn','-c:a','flac'],
          mp4:['-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart']};
        onProgress({phase:'converting',percent:null});
        try { await execute(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-i',path.join(dir,files[0]),
          ...codecs[job.format],'-t',String(maxDuration),'-progress','pipe:1','-nostats',output],
          {signal:controller.signal,timeout,tool:'ffmpeg',stage:'convert',version:probes?.versions.ffmpeg||null,onLine:line=>{
            if(line.startsWith('out_time_us=')){const time=Number(line.slice(12))/1000000;
              onProgress({phase:'converting',percent:Number.isFinite(time)?Math.min(100,100*time/job.duration):null});}
          }}); } catch(e) { if(!signal?.aborted)e.internal=true;throw e; }
        if((await stat(output)).size<=0)throw Object.assign(Error('El archivo está vacío.'),{internal:true});
        const sizes=await Promise.all((await readdir(dir)).map(async n=>(await stat(path.join(dir,n))).size));
        if(sizes.reduce((a,b)=>a+b,0)>maxBytes)throw Object.assign(Error('El trabajo superó el espacio permitido.'),{internal:true});
        return output;
      } catch(e) { if(diskError)throw Object.assign(Error('El trabajo superó el espacio permitido.'),{internal:true}); throw e; }
      finally {clearInterval(monitor);signal?.removeEventListener('abort',abort);}
    }
  };
}
