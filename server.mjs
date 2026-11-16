import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateRequest,secureEqual,token} from './lib.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PUBLIC=path.join(ROOT,'public');
const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||3000);
const PASSWORD=process.env.MEDIA_STUDIO_TOKEN||'';
const YTDLP=process.env.YTDLP_BIN||'yt-dlp';
const FFMPEG=process.env.FFMPEG_BIN||'ffmpeg';
const TTL_MS=20*60*1000;
const MAX_BODY=8192;
const jobs=new Map();
let active=false;
const queue=[];
const available=(binary)=>{try{return spawnSync(binary,['--version'],{timeout:5000,stdio:'ignore'}).status===0;}catch{return false;}};
const ready={ytDlp:available(YTDLP),ffmpeg:available(FFMPEG)};
if(!PASSWORD){console.error('ERROR: Debes configurar MEDIA_STUDIO_TOKEN. Consulta README.md');process.exit(1);}
if(HOST==='0.0.0.0' && PASSWORD.length<16){console.error('ERROR: Para publicar, utiliza MEDIA_STUDIO_TOKEN de al menos 16 caracteres.');process.exit(1);}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
function auth(req){const key=req.headers.authorization?.replace(/^Bearer\s+/i,'')||'';return secureEqual(key,PASSWORD);}
function safeJob(job){return {id:job.id,status:job.status,createdAt:job.createdAt,format:job.format,quality:job.quality,error:job.error||null,filename:job.filename||null};}
async function readJson(req){let chunks=[],length=0;for await(const chunk of req){length+=chunk.length;if(length>MAX_BODY)throw new Error('Solicitud demasiado grande.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('JSON inválido.');}}
function outputName(file){return file.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120);}
function createArgs(job){
 const args=['--js-runtimes','node','--no-playlist','--no-progress','--no-warnings','--restrict-filenames','--max-filesize','500M','--socket-timeout','20','--retries','2','--fragment-retries','2','--ffmpeg-location',FFMPEG,'--paths',job.dir,'-o','media.%(ext)s'];
 if(job.format==='mp4'){
   if(job.quality==='best')args.push('-f','bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best','--merge-output-format','mp4','--remux-video','mp4');
   else args.push('-f',`bv*[height<=${job.quality}][ext=mp4]+ba[ext=m4a]/b[height<=${job.quality}][ext=mp4]/best[height<=${job.quality}]`,'--merge-output-format','mp4','--remux-video','mp4');
 }else args.push('-x','--audio-format',job.format,'--audio-quality','0');
 args.push('--',job.url);
 return args;
}
async function processJob(job){
 active=true;job.status='processing';
 try{
  job.dir=await fsp.mkdtemp(path.join(os.tmpdir(),'media-studio-'));
  const args=createArgs(job);
  await new Promise((resolve,reject)=>{
    const proc=spawn(YTDLP,args,{stdio:['ignore','ignore','pipe'],windowsHide:true});
    let stderr='';const timer=setTimeout(()=>{proc.kill('SIGKILL');reject(new Error('La descarga excedió el tiempo permitido (10 minutos).'));},10*60*1000);
    proc.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-3000);});
    proc.on('error',e=>{clearTimeout(timer);reject(e);});
    proc.on('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(/Sign in|bot|403|429/i.test(stderr)?'YouTube solicitó una verificación o bloqueó la descarga. Intenta otro video autorizado.':'No se pudo procesar este video. Comprueba que sea público y descargable.'));});
  });
  const names=await fsp.readdir(job.dir);
  const name=names.find(n=>n.toLowerCase().endsWith('.'+job.format));
  if(!name)throw new Error('La conversión terminó sin generar el formato solicitado.');
  job.file=path.join(job.dir,name);job.filename=outputName(`media-studio-${job.id.slice(0,8)}.${job.format}`);job.status='done';
 }catch(e){job.error=e.message||'No se pudo procesar el enlace.';job.status='error';}
 finally{active=false;drain();}
}
function drain(){if(active)return;const job=queue.shift();if(job)processJob(job);}
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function staticFile(req,res,url){let p=url.pathname==='/'?'/index.html':url.pathname;if(!['/index.html','/style.css','/app.js','/favicon.svg'].includes(p))return json(res,404,{error:'No encontrado.'});const file=path.join(PUBLIC,p);try{const data=await fsp.readFile(file);res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});res.end(data);}catch{json(res,404,{error:'No encontrado.'});}}
const server=http.createServer(async(req,res)=>{
 let url;try{url=new URL(req.url,'http://localhost');}catch{return json(res,400,{error:'URL inválida.'});}
 if(req.method==='GET'&&!url.pathname.startsWith('/api/'))return staticFile(req,res,url);
 if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,tools:ready,authRequired:true});
 if(!auth(req))return json(res,401,{error:'Clave incorrecta o ausente.'});
 if(url.pathname==='/api/jobs'&&req.method==='POST'){
  if(!ready.ytDlp||!ready.ffmpeg)return json(res,503,{error:'Instala yt-dlp y FFmpeg en el servidor para habilitar las descargas.'});
  if(queue.length>=3)return json(res,429,{error:'Hay demasiadas solicitudes. Espera a que termine una.'});
  try{const input=validateRequest(await readJson(req));const id=token();const job={id,...input,status:'queued',createdAt:Date.now()};jobs.set(id,job);queue.push(job);drain();return json(res,202,{job:safeJob(job)});}catch(e){return json(res,400,{error:e.message});}
 }
 const m=url.pathname.match(/^\/api\/jobs\/([a-f0-9]{48})(?:\/(download))?$/);
 if(m&&req.method==='GET'){
  const job=jobs.get(m[1]);if(!job)return json(res,404,{error:'Trabajo inexistente o caducado.'});
  if(!m[2])return json(res,200,{job:safeJob(job)});
  if(job.status!=='done'||!job.file)return json(res,409,{error:'El archivo todavía no está disponible.'});
  try{const stat=await fsp.stat(job.file);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Content-Disposition':`attachment; filename="${job.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});fs.createReadStream(job.file).pipe(res);return;}catch{return json(res,404,{error:'Archivo eliminado.'});}
 }
 return json(res,404,{error:'Ruta inexistente.'});
});
setInterval(async()=>{for(const [id,j] of jobs){if(Date.now()-j.createdAt>TTL_MS&&j.status!=='processing'&&j.status!=='queued'){jobs.delete(id);if(j.dir)await fsp.rm(j.dir,{recursive:true,force:true}).catch(()=>{});}}},60*1000).unref();
server.listen(PORT,HOST,()=>{console.log(`MEDIA STUDIO → http://${HOST}:${PORT}`);console.log('Dependencias:',ready);});
