/* Optional Supabase accounts use the same-origin backend. No Supabase keys or tokens are sent to this script. */
(() => {
  const $ = id => document.getElementById(id);
  let session=null, mode='login';
  let captchaToken='',captchaWidget=null,captchaLoading=null,captchaGeneration=0;
  function clearCaptcha(){
    captchaToken='';captchaGeneration++;
    if(captchaWidget!==null){try{window.turnstile?.remove(captchaWidget);}catch{}captchaWidget=null;}
    $('account-captcha').replaceChildren();
  }
  async function mountCaptcha(){
    clearCaptcha();if(mode!=='signup')return;
    const generation=captchaGeneration,config=session?.auth.turnstile;
    if(!config?.enabled){$('account-message').textContent='La verificación del registro aún no está configurada.';return;}
    try{
      if(!window.turnstile?.render){
        if(!captchaLoading)captchaLoading=new Promise((resolve,reject)=>{
          const script=document.createElement('script');let timer;
          const ready=()=>{clearTimeout(timer);resolve();};
          const failed=()=>{clearTimeout(timer);script.remove();reject(Error());};
          window.vydoTurnstileReady=ready;
          script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=vydoTurnstileReady&render=explicit';script.async=true;
          script.onload=()=>{if(window.turnstile?.render)ready();};
          script.onerror=failed;timer=setTimeout(failed,15000);document.head.append(script);
        }).catch(error=>{captchaLoading=null;throw error;});
        await captchaLoading;
      }
      if(generation!==captchaGeneration||mode!=='signup'||!$('account-dialog').open)return;
      const current=()=>generation===captchaGeneration&&mode==='signup';
      captchaWidget=window.turnstile.render($('account-captcha'),{sitekey:config.siteKey,action:'signup',size:'flexible',theme:document.documentElement.dataset.theme||'auto',
        callback:token=>{if(current())captchaToken=token;},'expired-callback':()=>{if(current())captchaToken='';},
        'error-callback':()=>{if(current()){captchaToken='';$('account-message').textContent='No se pudo completar la verificación de seguridad. Inténtalo de nuevo.';}},
        'timeout-callback':()=>{if(current())captchaToken='';}});
    }catch{if(generation===captchaGeneration)$('account-message').textContent='No se pudo cargar la verificación de seguridad. Revisa tu conexión e inténtalo de nuevo.';}
  }
  async function request(route,method='GET',data) {
    const response=await fetch(route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
    const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo completar la solicitud.');return result;
  }
  function quotaText(q) {
    if(!q)return '';
    const wait=q.resetAt?` · recuperas cupo en ${Math.max(1,Math.ceil((q.resetAt-Date.now())/60000))} min`:'';
    return `${q.remaining} de ${q.limit} descargas disponibles${wait}`;
  }
  function renderQuota(q) {if(session)session.quota=q;$('quota-info').textContent=quotaText(q);$('profile-quota').textContent=quotaText(q);}
  function apply(value) {
    session=value;renderQuota(value.quota);
    $('sign-in').parentElement.hidden=Boolean(value.user);$('profile-button').hidden=!value.user;
    for(const id of ['sign-in','sign-up']){const available=value.auth.enabled&&(id!=='sign-up'||value.auth.signup!==false||value.auth.google);$(id).disabled=!available;$(id).title=available?'':id==='sign-up'?'Registro público no disponible por ahora. Puedes descargar sin registrarte.':'Cuentas temporalmente no disponibles. Puedes descargar sin registrarte.';$(id).setAttribute('aria-label',available?$(id).textContent:$(id).textContent+': '+$(id).title);}
    const signupPending=value.auth.enabled&&value.auth.signup===false&&!value.auth.google;
    $('auth-status').hidden=Boolean(value.auth.enabled&&!signupPending);
    $('auth-status').textContent=signupPending?'Registro público pendiente':value.auth.enabled?'':'Cuentas no disponibles';
    if(value.user){$('profile-button').textContent=(value.profile?.name||value.user.email||'U').slice(0,1).toUpperCase();}
    $('delete-account').disabled=!value.auth.canDelete;
    $('delete-unavailable').hidden=Boolean(value.auth.canDelete);
    window.vydoAds.configure(value.ad);
    window.dispatchEvent(new CustomEvent('vydo-session',{detail:value}));return value;
  }
  async function refresh(){return apply(await request('/api/session'));}
  function openAccount(nextMode='login') {
    mode=nextMode;const enabled=session?.auth.enabled;
    const labels={login:'Iniciar sesión',signup:'Crear cuenta',recover:'Recuperar contraseña',password:'Nueva contraseña'};
    $('account-title').textContent=labels[mode];$('account-submit').textContent=labels[mode];
    $('auth-unavailable').hidden=Boolean(enabled);$('account-form').hidden=!enabled||session?.auth.email===false;
    $('account-message').textContent='';
    const email=mode!=='password',password=mode!=='recover';
    $('account-email').hidden=!email;$('email-label').hidden=!email;$('account-email').required=email;
    $('account-password').hidden=!password;$('account-password-label').hidden=!password;$('account-password').required=password;
    $('account-password').autocomplete=mode==='login'?'current-password':'new-password';$('account-password').value='';
    const signup=mode==='signup';
    for(const id of ['account-name','account-name-label','account-confirm-password','account-confirm-label','account-captcha'])$(id).hidden=!signup;
    $('account-name').required=signup;$('account-confirm-password').required=signup;$('account-confirm-password').value='';
    $('account-password').type='password';$('account-confirm-password').type='password';
    $('toggle-password').hidden=!password;$('toggle-password').textContent='Mostrar contraseña';$('toggle-password').setAttribute('aria-pressed','false');
    $('google-sign-in').hidden=!enabled||!session?.auth.google||!['login','signup'].includes(mode);
    $('recover-password').hidden=!enabled||mode!=='login';
    if(!$('account-dialog').open)$('account-dialog').showModal();
    mountCaptcha();
  }
  $('toggle-password').addEventListener('click',()=>{
    const visible=$('account-password').type==='password';
    $('account-password').type=visible?'text':'password';$('account-confirm-password').type=visible?'text':'password';
    $('toggle-password').textContent=visible?'Ocultar contraseña':'Mostrar contraseña';$('toggle-password').setAttribute('aria-pressed',String(visible));
  });
  $('account-dialog').addEventListener('close',()=>{clearCaptcha();$('account-password').value='';$('account-confirm-password').value='';});
  $('sign-in').addEventListener('click',()=>openAccount('login'));
  $('sign-up').addEventListener('click',()=>openAccount('signup'));
  $('recover-password').addEventListener('click',()=>openAccount('recover'));
  $('account-form').addEventListener('submit',async event=>{
    event.preventDefault();$('account-submit').disabled=true;$('account-message').textContent='';let requested=false;
    try{
      const data={email:$('account-email').value,password:$('account-password').value};
      if(mode==='signup'){
        data.name=$('account-name').value.trim();data.confirmPassword=$('account-confirm-password').value;data.captchaToken=captchaToken;
        if(!data.name)throw Error('Introduce tu nombre.');
        if(data.password!==data.confirmPassword)throw Error('Las contraseñas no coinciden.');
        if(!captchaToken)throw Error('Completa la verificación de seguridad antes de crear tu cuenta.');
      }
      requested=true;const result=await request('/api/auth/'+mode,'POST',data);
      $('account-password').value='';
      $('account-confirm-password').value='';
      if(['login','password'].includes(mode)){$('account-dialog').close();await refresh();}
      else $('account-message').textContent=result.message;
    }catch(error){$('account-message').textContent=error.message;}
    finally{$('account-submit').disabled=false;if(requested&&mode==='signup'&&$('account-dialog').open)mountCaptcha();}
  });
  $('google-sign-in').addEventListener('click',async()=>{
    try{const data=await request('/api/auth/google','POST',{});location.assign(data.url);}catch(error){$('account-message').textContent=error.message;}
  });
  async function profile() {
    try{
      const data=await request('/api/profile');
      $('profile-email').textContent=session.user.email;renderQuota(data.quota);
      $('profile-name').value=data.profile.name;$('profile-format').value=data.profile.format;$('profile-quality').value=data.profile.quality;
      const rows=data.history.map(item=>{
        const row=document.createElement('li'),title=document.createElement('strong'),meta=document.createElement('span');
        title.className='history-title';title.textContent=item.title;meta.className='history-meta';
        const labels={done:'Completada',processing:'En proceso',error:'Error',cancelled:'Cancelada'};
        meta.textContent=`${item.format.toUpperCase()}${item.format==='mp4'?' · '+item.quality+'p':''} · ${labels[item.status]||item.status} · ${new Date(Number(item.created_ms)).toLocaleDateString()}`;
        row.append(title,meta);
        if(item.available){const download=document.createElement('a');download.href=`/api/jobs/${item.id}/download`;download.className='text-button';download.textContent='Guardar archivo';download.download='';row.append(download);}
        const remove=document.createElement('button');remove.className='text-button';remove.textContent='Eliminar registro';remove.type='button';remove.addEventListener('click',async()=>{
          try{await request('/api/profile/history/'+item.id,'DELETE');await profile();}catch(error){$('profile-message').textContent=error.message;}
        });row.append(remove);return row;
      });
      if(!rows.length){const row=document.createElement('li');row.className='hint';row.textContent='Todavía no tienes descargas en el historial.';rows.push(row);}
      $('history-list').replaceChildren(...rows);
      if(!$('profile-dialog').open)$('profile-dialog').showModal();
    }catch(error){$('profile-message').textContent=error.message;}
  }
  $('profile-button').addEventListener('click',()=>{$('profile-message').textContent='';profile();});
  $('profile-form').addEventListener('submit',async event=>{
    event.preventDefault();$('save-profile').disabled=true;
    try{await request('/api/profile','PATCH',{name:$('profile-name').value,format:$('profile-format').value,quality:$('profile-quality').value});await refresh();$('profile-message').textContent='Preferencias guardadas.';}
    catch(error){$('profile-message').textContent=error.message;}finally{$('save-profile').disabled=false;}
  });
  $('logout').addEventListener('click',async()=>{
    try{await request('/api/session','DELETE');$('profile-dialog').close();await refresh();}
    catch(error){$('profile-message').textContent=error.message;}
  });
  $('change-password').addEventListener('click',()=>{$('profile-dialog').close();openAccount('password');});
  $('delete-account-form').addEventListener('submit',async event=>{
    event.preventDefault();$('delete-account').disabled=true;
    try{await request('/api/account','DELETE',{confirm:$('delete-confirm').value});$('profile-dialog').close();$('delete-confirm').value='';await refresh();}
    catch(error){$('profile-message').textContent=error.message;}finally{$('delete-account').disabled=!session?.auth.canDelete;}
  });
  const ready=refresh().then(value=>{
    const query=new URLSearchParams(location.search);
    if(query.get('account')==='recovery')openAccount('password');
    if(query.get('account')==='error'){openAccount('login');$('account-message').textContent='El enlace caducó o no pudo verificarse. Solicita uno nuevo.';}
    if(query.has('account'))history.replaceState(null,'',location.pathname);
    return value;
  }).catch(()=>{$('quota-info').textContent='No se pudo consultar el cupo. Intenta de nuevo en un momento.';return null;});
  window.vydoAccount={ready,refresh,setQuota:renderQuota,get session(){return session;}};
  setInterval(()=>{
    if(!session)return;
    if(session.quota.resetAt&&session.quota.resetAt<=Date.now())refresh().catch(()=>{});
    else renderQuota(session.quota);
  },30000);
})();
