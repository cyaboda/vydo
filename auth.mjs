import {createClient} from '@supabase/supabase-js';
import {randomBytes} from 'node:crypto';
import {cookie,setCookie,digest,seal,unseal} from './security.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});

export function createAuth({store,key,secure=false,origin,url=process.env.SUPABASE_URL,publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY,
  serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY,google=process.env.GOOGLE_AUTH_ENABLED==='true'}={}) {
  const enabled=Boolean(url&&publishableKey);
  if(enabled){const u=new URL(url);if(u.protocol!=='https:'&&u.hostname!=='127.0.0.1'&&u.hostname!=='localhost')throw Error('Supabase requiere HTTPS.');if(!origin)throw Error('Configura PUBLIC_ORIGIN para Supabase Auth.');}
  const publicConfig={enabled,google:enabled&&google,canDelete:enabled&&Boolean(serviceKey)};
  async function context(req,res,{create=false}={}){
    let sid=cookie(req,'vydo_account');if(!/^[a-f0-9]{48}$/.test(sid))sid='';
    const row=sid?await store.session(digest(key,sid)):null;
    let state={storage:{},recent:0},userId=null;
    if(row){try{state=unseal(key,row.payload);userId=row.user_id;}catch{await store.removeSession(digest(key,sid));setCookie(res,'vydo_account','',{secure,maxAge:0});if(!create)return null;sid=randomBytes(24).toString('hex');}}
    if(!row&&!create)return null;
    if(!sid||!row)sid=randomBytes(24).toString('hex');
    let revision=row?Number(row.version):-1,tail=Promise.resolve();
    const save=()=>{
      const sessionId=digest(key,sid),payload=seal(key,state),owner=userId,expires=Date.now()+(owner?30*86400000:1800000);
      tail=tail.then(async()=>{revision=await store.saveSession(sessionId,payload,owner,expires,revision);});return tail;
    };
    const client=createClient(url,publishableKey,{global:{fetch:(resource,options)=>fetch(resource,{...options,signal:AbortSignal.timeout(10000)})},auth:{flowType:'pkce',autoRefreshToken:false,persistSession:true,detectSessionInUrl:false,
      storage:{getItem:async name=>state.storage[name]??null,setItem:async(name,value)=>{state.storage[name]=value;await save();},removeItem:async name=>{delete state.storage[name];await save();}}}});
    return {client,state,get userId(){return userId;},async identify(id){if(userId!==id){userId=id;await save();}},
      async rotate(){const previous=sid;sid=randomBytes(24).toString('hex');revision=-1;await save();await store.removeSession(digest(key,previous));setCookie(res,'vydo_account',sid,{secure});},
      async clear(){await store.removeSession(digest(key,sid));setCookie(res,'vydo_account','',{secure,maxAge:0});},
      async persist(){await save();setCookie(res,'vydo_account',sid,{secure});}};
  }
  function requireEnabled(){if(!enabled)throw fail('Las cuentas aún no están configuradas. Puedes descargar sin registrarte.',503);}
  async function verified(ctx){const {data,error}=await ctx.client.auth.getUser();
    if(error){if(error.status>=500||!error.status)throw fail('El servicio de cuentas no está disponible. Inténtalo más tarde.',503);return null;}
    const user=data.user;
    if(!user?.id||!user.email_confirmed_at||user.is_anonymous)return null;
    await ctx.identify(user.id);return {id:user.id,email:user.email};
  }
  return {config:publicConfig,
    async resolve(req,res){if(!enabled)return null;const ctx=await context(req,res);if(!ctx)return null;const user=await verified(ctx);if(!user){await ctx.clear();return null;}return {...user,recent:ctx.state.recent||0,ctx};},
    async action(action,req,res,data={}){
      requireEnabled();const ctx=await context(req,res,{create:true});
      if(action==='login'){
        const {error}=await ctx.client.auth.signInWithPassword({email:data.email,password:data.password});
        if(error)throw fail('Correo o contraseña incorrectos, o correo sin verificar.',401);
        const user=await verified(ctx);if(!user){await ctx.clear();throw fail('Verifica tu correo antes de iniciar sesión.',401);}
        ctx.state.recent=Date.now();await ctx.rotate();return {ok:true};
      }
      if(action==='signup'){
        const {error}=await ctx.client.auth.signUp({email:data.email,password:data.password,options:{emailRedirectTo:origin+'/auth/callback'}});
        if(error&&error.status>=500)throw fail('El servicio de registro no está disponible.',503);
        await ctx.persist();return {message:'Si el correo es válido, recibirás un enlace para verificar tu cuenta.'};
      }
      if(action==='recover'){
        await ctx.client.auth.resetPasswordForEmail(data.email,{redirectTo:origin+'/auth/callback?flow=recovery'});
        await ctx.persist();return {message:'Si existe una cuenta con ese correo, recibirás un enlace de recuperación.'};
      }
      if(action==='google'){
        if(!google)throw fail('Google aún no está configurado.',503);
        const {data:result,error}=await ctx.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:origin+'/auth/callback',skipBrowserRedirect:true}});
        if(error||!result.url||new URL(result.url).origin!==new URL(url).origin)throw fail('No se pudo iniciar el acceso con Google.',503);
        await ctx.persist();return {url:result.url};
      }
      throw fail('Acción no disponible.',404);
    },
    async callback(req,res,code,recovery=false,flowId){requireEnabled();const ctx=await context(req,res);if(!ctx)throw fail('El enlace debe abrirse en el mismo navegador donde lo solicitaste.');
      const {error}=await ctx.client.auth.exchangeCodeForSession(code,flowId?{flowId}:undefined);if(error)throw fail('El enlace caducó o no es válido. Solicita otro.');
      if(!await verified(ctx))throw fail('No se pudo verificar el correo.');ctx.state.recent=Date.now();await ctx.rotate();return recovery?'/?account=recovery':'/';
    },
    async logout(user,req,res){
      if(!enabled)return {ok:true};
      const ctx=user?.ctx||await context(req,res);
      if(ctx){try{await ctx.client.auth.signOut({scope:'local'});}finally{await ctx.clear();}}
      return {ok:true};
    },
    async changePassword(user,password){if(!user||Date.now()-user.recent>600000)throw fail('Inicia sesión de nuevo antes de cambiar tu contraseña.',401);
      const {error}=await user.ctx.client.auth.updateUser({password});if(error)throw fail('No se pudo actualizar la contraseña.');return {ok:true};
    },
    async deleteAccount(user){if(!serviceKey)throw fail('La eliminación de cuentas aún no está configurada.',503);
      if(!user||Date.now()-user.recent>600000)throw fail('Inicia sesión de nuevo antes de eliminar tu cuenta.',401);
      const admin=createClient(url,serviceKey,{global:{fetch:(resource,options)=>fetch(resource,{...options,signal:AbortSignal.timeout(10000)})},auth:{persistSession:false,autoRefreshToken:false}});
      const {data}=await user.ctx.client.auth.getSession();
      if(data.session?.access_token){const {error}=await admin.auth.admin.signOut(data.session.access_token,'global');if(error)throw fail('No se pudieron cerrar las sesiones.',503);}
      await store.eraseUser(user.id);
      const {error}=await admin.auth.admin.deleteUser(user.id);if(error)throw fail('No se pudo eliminar la cuenta. Inténtalo de nuevo.',503);
      await user.ctx.clear();return {ok:true};
    }
  };
}
