import http from 'node:http';
import fs from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseYoutubeUrl,validateRequest,secureEqual,token} from './lib.mjs';
import {createEngine} from './engine.mjs';
import {Jobs,cleanStaleRoots} from './jobs.mjs';

const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://i.ytimg.com https://i9.ytimg.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw Error('Se requiere JSON.');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('Solicitud demasiado grande.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('JSON inválido.');}
}

export async function createApp({password=process.env.VYDO_TOKEN,engine=createEngine(),concurrency=1,maxQueue=3,ttl=1200000,
  secureCookies=process.env.COOKIE_SECURE==='true',origin=process.env.PUBLIC_ORIGIN,inspectLimit=1}={}) {
  if(typeof password!=='string'||password.length<24)throw Error('Configura VYDO_TOKEN con al menos 24 caracteres.');
  const jobs=await new Jobs(engine,{concurrency,maxQueue,ttl}).init();
  const tools=engine.health(),sessions=new Map(),rates=new Map(),previews=new Map(),inspectors=new Set();let inspecting=0;
  const sessionTTL=8*3600000;
  function limited(key,limit) {
    const now=Date.now();let entry=rates.get(key);
    if(!entry || entry.until<=now){if(rates.size>=2048)return true;entry={count:0,until:now+60000};rates.set(key,entry);}
    return ++entry.count>limit;
  }
  function owner(req) {
    const bearer=req.headers.authorization?.replace(/^Bearer\s+/i,'');
    if(bearer && secureEqual(bearer,password))return 'api';
    const sid=req.headers.cookie?.match(/(?:^|;\s*)vydo_session=([a-f0-9]{48})(?:;|$)/)?.[1];
    return sessions.get(sid)>Date.now()?sid:null;
  }
  function sameOrigin(req) {
    if(!req.headers.origin)return true;
    return req.headers.origin===(origin || `http://${req.headers.host}`);
  }
  const server=http.createServer(async(req,res)=>{
    for(const [k,v] of Object.entries(security))res.setHeader(k,v);
    try {
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      if(req.method==='GET'&&!route.startsWith('/api/')){
        const assets={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/favicon.svg':'favicon.svg',
          '/theme.js':'theme.js','/LOGO_BLACK.webp':'LOGO_BLACK.webp','/LOGO_WHITE.webp':'LOGO_WHITE.webp'};
        if(!assets[route])return json(res,404,{error:'No encontrado.'});
        const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',webp:'image/webp'};
        res.setHeader('Content-Type',types[assets[route].split('.').pop()]);
        return res.end(await readFile(new URL(`./public/${assets[route]}`,import.meta.url)));
      }
      if(route==='/api/health'&&req.method==='GET')return json(res,tools.ytDlp&&tools.ffmpeg?200:503,{tools});
      if(['POST','DELETE'].includes(req.method)&&!sameOrigin(req))return json(res,403,{error:'Origen no autorizado.'});
      if(route==='/api/session'&&req.method==='POST'){
        if(limited('login:'+req.socket.remoteAddress,10))return json(res,429,{error:'Demasiados intentos. Espera un minuto.'});
        const data=await body(req);
        if(!secureEqual(data.password,password))return json(res,401,{error:'Clave incorrecta.'});
        if(sessions.size>=128)return json(res,429,{error:'Demasiadas sesiones abiertas.'});
        const sid=token();sessions.set(sid,Date.now()+sessionTTL);
        res.setHeader('Set-Cookie',`vydo_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTTL/1000}${secureCookies?'; Secure':''}`);
        return json(res,200,{ok:true});
      }
      const user=owner(req);if(!user)return json(res,401,{error:'Accede con la clave de tu instancia.'});
      if(route==='/api/session'&&req.method==='GET')return json(res,200,{ok:true});
      if(route==='/api/session'&&req.method==='DELETE'){
        sessions.delete(user);res.setHeader('Set-Cookie','vydo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});
      }
      if(route==='/api/preview'&&req.method==='POST'){
        if(!tools.ytDlp||!tools.ffmpeg)return json(res,503,{error:'Faltan yt-dlp o FFmpeg en el servidor.'});
        if(limited('preview:'+user,12)||inspecting>=inspectLimit)return json(res,429,{error:'El analizador está ocupado. Espera un momento.'});
        const input=await body(req);if(input.authorized!==true)throw Error('Confirma tu autorización.');
        const normalized=parseYoutubeUrl(input.url);inspecting++;
        const controller=new AbortController();inspectors.add(controller);
        const disconnect=()=>controller.abort();res.once('close',disconnect);
        try {
          const p=await engine.inspect(normalized,controller.signal);
          const id=token();if(previews.size>=128)previews.delete(previews.keys().next().value);
          previews.set(id,{...p,url:normalized,owner:user,until:Date.now()+600000});
          return json(res,200,{preview:{...p,id}});
        } finally {inspecting--;inspectors.delete(controller);res.removeListener('close',disconnect);}
      }
      if(route==='/api/jobs'&&req.method==='POST'){
        if(limited('job:'+user,10))return json(res,429,{error:'Demasiadas solicitudes.'});
        const data=await body(req),input=validateRequest(data),p=previews.get(data.previewId);
        if(!p||p.owner!==user||p.until<Date.now()||p.url!==input.url)throw Error('Analiza el enlace nuevamente antes de descargar.');
        if(!p.formats.includes(input.format)||(input.format==='mp4'&&!p.qualities.includes(input.quality)))throw Error('El formato o resolución no está disponible.');
        return json(res,202,{job:jobs.view(jobs.create({...input,duration:p.duration},user))});
      }
      const match=route.match(/^\/api\/jobs\/([a-f0-9]{48})(\/download)?$/);
      if(match){
        const j=jobs.get(match[1],user);if(!j)return json(res,404,{error:'Trabajo inexistente o caducado.'});
        if(req.method==='DELETE'&&!match[2]){jobs.cancel(j);return json(res,200,{job:jobs.view(j)});}
        if(req.method==='GET'&&!match[2])return json(res,200,{job:jobs.view(j)});
        if(req.method==='GET'&&match[2]){
          if(j.status!=='done')return json(res,409,{error:'El archivo aún no está listo.'});
          const file=await stat(j.file);j.readers=(j.readers||0)+1;
          res.once('close',()=>{j.readers--;});
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':file.size,'Content-Disposition':`attachment; filename="${j.filename}"`});
          const stream=fs.createReadStream(j.file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
        }
      }
      return json(res,404,{error:'Ruta inexistente.'});
    } catch(e) {if(!res.headersSent)json(res,e.status||400,{error:e.message});else res.destroy();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  const timer=setInterval(()=>{
    jobs.cleanup().catch(console.error);
    for(const [id,until] of sessions)if(until<Date.now())sessions.delete(id);
    for(const [id,p] of previews)if(p.until<Date.now())previews.delete(id);
    for(const [id,r] of rates)if(r.until<Date.now())rates.delete(id);
  },30000);timer.unref();
  return {server,jobs,async close(){clearInterval(timer);for(const c of inspectors)c.abort();server.closeAllConnections();await new Promise(r=>server.close(r));await jobs.close();}};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  await cleanStaleRoots();
  const app=await createApp();
  app.server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('vydo escuchando en el puerto',app.server.address().port));
  for(const s of ['SIGINT','SIGTERM'])process.once(s,async()=>{await app.close();process.exit(0);});
}
