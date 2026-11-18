const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function createTurnstile({siteKey=process.env.TURNSTILE_SITE_KEY,secretKey=process.env.TURNSTILE_SECRET_KEY,origin,request=fetch}={}){
 let hostname='';try{hostname=new URL(origin).hostname;}catch{}
 const production=hostname&&!['localhost','127.0.0.1'].includes(hostname);
 const dummy=key=>/^[123]x0{10,}/.test(key||'');
 const enabled=Boolean(hostname&&siteKey&&secretKey&&(!production||(!dummy(siteKey)&&!dummy(secretKey))));
 return {config:{enabled,siteKey:enabled?siteKey:null},async verify(token){
  if(!enabled)throw fail('La verificación antispam del registro aún no está configurada. Puedes descargar sin registrarte.',503);
  if(typeof token!=='string'||!token||token.length>2048)throw fail('Completa la verificación de seguridad antes de crear tu cuenta.');
  let result;
  try{const response=await request('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:secretKey,response:token}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error();result=await response.json();
  }catch{throw fail('No se pudo comprobar la verificación de seguridad. Inténtalo de nuevo.',503);}
  if(!result||typeof result!=='object')throw fail('La verificación de seguridad no está disponible temporalmente.',503);
  if(result.success!==true){
   if(result['error-codes']?.includes('timeout-or-duplicate'))throw fail('La verificación caducó o ya se utilizó. Complétala de nuevo.');
   if(result['error-codes']?.some(c=>['missing-input-secret','invalid-input-secret','internal-error'].includes(c)))throw fail('La verificación de seguridad no está disponible temporalmente.',503);
   throw fail('La verificación de seguridad no es válida. Complétala de nuevo.');
  }
  if(result.hostname!==hostname||result.action!=='signup')throw fail('La verificación no corresponde a este registro.');
 }};
}
