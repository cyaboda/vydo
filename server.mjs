import http from 'node:http';
import fs from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseYoutubeUrl,validateRequest,secureEqual,token,FORMATS,QUALITIES,downloadDisposition} from './lib.mjs';
import {createEngine} from './engine.mjs';
import {Jobs,cleanStaleRoots} from './jobs.mjs';
import {createStore} from './store.mjs';
import {createAuth} from './auth.mjs';
import {appSecret,clientIP,networkIP,guest,digest} from './security.mjs';

const bad=(message,status=400)=>Object.assign(Error(message),{status});
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw bad('Se requiere JSON.');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>8192)throw bad('Solicitud demasiado grande.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw bad('JSON inválido.');}
}
function input(fn){try{return fn();}catch(e){e.status=400;throw e;}}
function advertising(config){
  if(!config?.provider||!config?.image||!config?.target)return null;
  const image=new URL(config.image),target=new URL(config.target);
  if(image.protocol!=='https:'||target.protocol!=='https:'||image.username||target.username||image.password||target.password)throw Error('Publicidad: utiliza URLs HTTPS públicas sin credenciales.');
  return {provider:String(config.provider).slice(0,80),image:image.href,target:target.href};
}
export async function createApp({engine=createEngine(),concurrency=1,maxQueue=3,ttl=1200000,origin=process.env.PUBLIC_ORIGIN,
  secureCookies=process.env.COOKIE_SECURE==='true'||origin?.startsWith('https:'),inspectLimit=1,store:providedStore,key:providedKey,
  auth:providedAuth,storeOptions={},secretOptions={},trustedProxies=(process.env.TRUSTED_PROXY_CIDRS||'').split(',').filter(Boolean),
  adminToken=process.env.VYDO_ADMIN_TOKEN,adConfig={provider:process.env.AD_PROVIDER,image:process.env.AD_IMAGE_URL,target:process.env.AD_TARGET_URL}}={}) {
  const store=providedStore||await createStore(storeOptions);
  const key=providedKey||await appSecret(secretOptions);
  const auth=providedAuth||createAuth({store,key,secure:secureCookies,origin});
  await auth.initialize?.();
  const ad=advertising(adConfig),worker=token();
  const jobs=await new Jobs(engine,{concurrency,maxQueue,ttl,onFinish:async(j,status,internal)=>store.finish(j.id,status,internal)}).init();
  const tools=engine.health(),previews=new Map(),inspectors=new Set();let inspecting=0;
  const security={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://i.ytimg.com https://i9.ytimg.com${ad?' '+new URL(ad.image).origin:''}; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`};
  if(secureCookies)security['Strict-Transport-Security']='max-age=31536000';
  const server=http.createServer(async(req,res)=>{
    for(const [name,value] of Object.entries(security))res.setHeader(name,value);
    try{
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      const authCallback=route==='/auth/callback'||(route==='/'&&url.searchParams.has('code'));
      if(req.method==='GET'&&!route.startsWith('/api/')&&!authCallback){
        const assets={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/account.js':'account.js','/ads.js':'ads.js','/ads/advertisement.js':'ads/advertisement.js','/favicon.svg':'favicon.svg','/favicon.ico':'favicon.ico',
          '/theme.js':'theme.js','/LOGO_BLACK.webp':'LOGO_BLACK.webp','/LOGO_WHITE.webp':'LOGO_WHITE.webp'};
        if(!assets[route])return json(res,404,{error:'No encontrado.'});
        const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',ico:'image/x-icon',webp:'image/webp'};
        res.setHeader('Content-Type',types[assets[route].split('.').pop()]);return res.end(await readFile(new URL(`./public/${assets[route]}`,import.meta.url)));
      }
      if(route==='/api/health'&&req.method==='GET'){
        try{await store.quota('health',false);}catch{return json(res,503,{ok:false});}
        return json(res,tools.ytDlp&&tools.ffmpeg?200:503,{ok:tools.ytDlp&&tools.ffmpeg,tools});
      }
      if(route==='/api/ad-check'&&req.method==='GET')return json(res,200,{marker:'vydo-ad-check',enabled:Boolean(ad)});
      if(route.startsWith('/api/admin/')){
        if(!adminToken)return json(res,404,{error:'No encontrado.'});
        if(adminToken.length<32||!secureEqual(req.headers.authorization,'Bearer '+adminToken))return json(res,401,{error:'Acceso administrativo denegado.'});
        if(route==='/api/admin/health'&&req.method==='GET')return json(res,200,{tools,active:jobs.running.size,queued:jobs.queue.length});
        return json(res,404,{error:'No encontrado.'});
      }
      if(['POST','PATCH','DELETE'].includes(req.method)){
        const expected=origin||`http://${req.headers.host}`;
        if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==expected))throw bad('Origen no autorizado.',403);
      }
      const ip=clientIP(req,trustedProxies),ipHash=digest(key,'network:'+networkIP(ip));
      const guestOwner=guest(req,res,key,secureCookies);
      if(authCallback&&req.method==='GET'){
        await store.rate('callback:'+ipHash,10);
        try{const redirect=await auth.callback(req,res,url.searchParams.get('code')||'',url.searchParams.get('flow')==='recovery',url.searchParams.get('sb_flow_id'));res.writeHead(303,{Location:redirect});res.end();}
        catch{res.writeHead(303,{Location:'/?account=error'});res.end();}return;
      }
      const authAction=route.match(/^\/api\/auth\/(login|signup|recover|google)$/);
      if(authAction&&req.method==='POST'){
        const action=authAction[1],window=action==='login'?300000:3600000;
        await store.rate('auth:'+action+':'+ipHash,action==='login'?10:5,window);
        const data=await body(req);
        if(action!=='google'){
          if(typeof data.email!=='string'||data.email.length>254||!/^\S+@\S+\.\S+$/.test(data.email))throw bad('Introduce un correo válido.');
          data.email=data.email.trim().toLowerCase();await store.rate('email:'+action+':'+digest(key,data.email),10,3600000);
          if(['login','signup'].includes(action)&&(typeof data.password!=='string'||data.password.length<8||data.password.length>128))throw bad('La contraseña debe tener entre 8 y 128 caracteres.');
        }
        return json(res,200,await auth.action(action,req,res,data));
      }
      const user=await auth.resolve(req,res),owner=user?'u:'+user.id:guestOwner;
      const owners=[owner,guestOwner],subject=user?owner:'ip:'+digest(key,'ip:'+ip);
      const quota=()=>store.quota(subject,Boolean(user));
      if(route==='/api/session'&&req.method==='GET')return json(res,200,{user:user?{id:user.id,email:user.email}:null,quota:await quota(),auth:auth.config,
        profile:user?await store.profile(user.id):null,ad});
      if(route==='/api/session'&&req.method==='DELETE')return json(res,200,await auth.logout(user,req,res));
      if(route==='/api/auth/password'&&req.method==='POST'){
        if(!user)throw bad('Inicia sesión para cambiar la contraseña.',401);await store.rate('password:'+owner,5,3600000);
        const data=await body(req);if(typeof data.password!=='string'||data.password.length<8||data.password.length>128)throw bad('Utiliza una contraseña de 8 a 128 caracteres.');
        return json(res,200,await auth.changePassword(user,data.password));
      }
      if(route==='/api/account'&&req.method==='DELETE'){
        if(!user)throw bad('Inicia sesión.',401);if((await body(req)).confirm!=='ELIMINAR')throw bad('Escribe ELIMINAR para confirmar.');
        for(const j of jobs.items.values())if(j.owner===owner)await jobs.cancel(j);
        return json(res,200,await auth.deleteAccount(user));
      }
      if(route==='/api/profile'){
        if(!user)throw bad('Inicia sesión para acceder a tu perfil.',401);
        if(req.method==='GET'){
          const history=await store.history(user.id);
          return json(res,200,{profile:await store.profile(user.id),quota:await quota(),history:history.map(h=>{
            const j=jobs.get(h.id,owner);return {...h,available:Boolean(j?.status==='done'&&j.finishedAt+ttl>Date.now())};
          })});
        }
        if(req.method==='PATCH'){
          const data=await body(req);
          if(typeof data.name!=='string'||data.name.length>80||!FORMATS.has(data.format)||!QUALITIES.has(data.quality))throw bad('Preferencias no válidas.');
          return json(res,200,{profile:await store.updateProfile(user.id,{name:data.name.trim(),format:data.format,quality:data.quality})});
        }
      }
      const historyMatch=route.match(/^\/api\/profile\/history\/([a-f0-9]{48})$/);
      if(historyMatch&&req.method==='DELETE'){
        if(!user)throw bad('Inicia sesión.',401);await store.deleteHistory(user.id,historyMatch[1]);return json(res,200,{ok:true});
      }
      if(route==='/api/preview'&&req.method==='POST'){
        if(!tools.ytDlp||!tools.ffmpeg)throw bad('Faltan yt-dlp o FFmpeg en el servidor.',503);
        await store.rate('preview:'+owner,12);await store.rate('preview-ip:'+ipHash,30);
        if(inspecting>=inspectLimit)throw bad('El analizador está ocupado.',429);
        const data=await body(req);if(data.authorized!==true)throw bad('Confirma tu autorización.');
        const normalized=input(()=>parseYoutubeUrl(data.url));inspecting++;
        const controller=new AbortController();inspectors.add(controller);const disconnect=()=>controller.abort();res.once('close',disconnect);
        try{
          const p=await engine.inspect(normalized,controller.signal);const id=token();
          if(previews.size>=128)previews.delete(previews.keys().next().value);
          previews.set(id,{...p,url:normalized,owner,until:Date.now()+600000});return json(res,200,{preview:{...p,id}});
        }catch(e){throw bad(e.code==='ENOENT'?'No se pudo iniciar la herramienta de descarga.':e.message,422);}
        finally{inspecting--;inspectors.delete(controller);res.removeListener('close',disconnect);}
      }
      if(route==='/api/jobs'&&req.method==='POST'){
        const data=await body(req),validated=input(()=>validateRequest(data)),p=previews.get(data.previewId);
        if(!p||!owners.includes(p.owner)||p.until<Date.now()||p.url!==validated.url)throw bad('Analiza el enlace nuevamente antes de descargar.');
        if(!p.formats.includes(validated.format)||(validated.format==='mp4'&&!p.qualities.includes(validated.quality)))throw bad('El formato o resolución no está disponible.');
        const id=token();
        const reserved=await store.reserve({id,subject,ip:ipHash,registered:Boolean(user),worker,userId:user?.id,title:p.title,
          videoId:new URL(p.url).searchParams.get('v'),format:validated.format,quality:validated.quality});
        try{const job=jobs.create({id,...validated,title:p.title,duration:p.duration},owner);return json(res,202,{job:jobs.view(job),quota:reserved});}
        catch(e){await store.release(id);throw e;}
      }
      const match=route.match(/^\/api\/jobs\/([a-f0-9]{48})(\/download)?$/);
      if(match){
        const j=owners.map(o=>jobs.get(match[1],o)).find(Boolean);if(!j)throw bad('Trabajo inexistente o caducado.',404);
        if(req.method==='DELETE'&&!match[2]){await jobs.cancel(j);return json(res,200,{job:jobs.view(j),quota:await quota()});}
        if(req.method==='GET'&&!match[2])return json(res,200,{job:jobs.view(j),quota:await quota()});
        if(req.method==='GET'&&match[2]){
          if(j.status!=='done')throw bad('El archivo aún no está listo.',409);
          j.readers=(j.readers||0)+1;res.once('close',()=>{j.readers--;});
          const file=await stat(j.file);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':file.size,'Content-Disposition':downloadDisposition(j.filename)});
          res.once('finish',()=>{j.transferCount=(j.transferCount||0)+1;j.downloadedAt=Date.now();});
          const stream=fs.createReadStream(j.file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
        }
      }
      throw bad('Ruta inexistente.',404);
    }catch(e){
      if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));
      if(!res.headersSent)json(res,e.status||503,{error:e.status?e.message:'El servidor no está disponible temporalmente. Inténtalo más tarde.',retryAfter:e.retryAfter||null});else res.destroy();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  let maintaining=false;
  const heartbeat=setInterval(async()=>{
    const active=[...jobs.items.values()].filter(j=>['queued','processing'].includes(j.status));
    if(!active.length)return;
    try{const alive=await store.heartbeat(worker,active.map(j=>j.id));for(const j of active)if(!alive.includes(j.id)&&['queued','processing'].includes(j.status)){j.internalFailure=true;await jobs.cancel(j);}}
    catch{for(const j of active){j.internalFailure=true;await jobs.cancel(j).catch(()=>{});}}
  },5000);heartbeat.unref();
  const timer=setInterval(async()=>{
    if(maintaining)return;maintaining=true;
    try{await jobs.cleanup();await store.maintenance();for(const [id,p]of previews)if(p.until<Date.now())previews.delete(id);}catch{console.error('No se pudo completar la limpieza periódica.');}finally{maintaining=false;}
  },30000);timer.unref();
  return {server,jobs,store,auth,async close(){clearInterval(timer);clearInterval(heartbeat);for(const c of inspectors)c.abort();server.closeAllConnections();await new Promise(r=>server.close(r));await jobs.close();if(!providedStore)await store.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.env.HOST==='0.0.0.0'&&!process.env.PUBLIC_ORIGIN)throw Error('Configura PUBLIC_ORIGIN para publicar el servidor.');
  await cleanStaleRoots();const app=await createApp();
  app.server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('vydo escuchando en el puerto',app.server.address().port));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
