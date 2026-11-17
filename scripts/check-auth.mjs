// Read-only readiness check. Does not create users, send email or print credentials.
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','PUBLIC_ORIGIN'];
const missing=required.filter(name=>!process.env[name]);
const report={missing,publicSignupRequested:process.env.AUTH_PUBLIC_SIGNUP_ENABLED==='true',
  accountDeletionConfigured:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  metadataStore:process.env.DATABASE_URL?'PostgreSQL':'persistent SQLite'};
if(!missing.length){
  try{
    const response=await fetch(new URL('/auth/v1/settings',process.env.SUPABASE_URL),{
      headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();
    const settings=await response.json();
    Object.assign(report,{reachable:true,email:Boolean(settings.external?.email),
      emailVerificationRequired:settings.mailer_autoconfirm===false,
      publicSignupEnabled:report.publicSignupRequested&&!settings.disable_signup&&Boolean(settings.external?.email),
      googleEnabled:process.env.GOOGLE_AUTH_ENABLED==='true'&&Boolean(settings.external?.google)});
  }catch{report.reachable=false;process.exitCode=1;}
}else process.exitCode=1;
console.log(JSON.stringify(report,null,2));
