// Read-only deployment check: never migrates, clears data or prints connection strings.
import {postgresAdapter} from '../store.mjs';
import {createEngine} from '../engine.mjs';
const required=['DATABASE_URL','APP_SECRET','PUBLIC_ORIGIN'];
const report={node:process.version,tools:createEngine().health(),missing:required.filter(k=>!process.env[k]),postgres:false};
let db;
try{
  if(!report.missing.length){
    db=await postgresAdapter(process.env.DATABASE_URL);
    await db.tx(async q=>{
      for(const table of ['private.vydo_usage','private.vydo_sessions','private.vydo_rates','public.vydo_profiles','public.vydo_history'])await q('SELECT 1 FROM '+table+' LIMIT 0');
    });
    report.postgres=true;
  }
}catch{report.error='Revisa conexión PostgreSQL, TLS, credenciales, migraciones y permisos de service_role.';}
finally{await db?.close();}
report.secureCookies=process.env.COOKIE_SECURE==='true';
report.secretValid=/^[a-f0-9]{64}$/i.test(process.env.APP_SECRET||'');
report.ok=report.postgres&&report.secretValid&&report.secureCookies&&report.tools.ytDlp&&report.tools.ffmpeg;
console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
