const $=id=>document.getElementById(id);
const state={format:'mp4',id:null,timer:null,secret:sessionStorage.getItem('media_studio_key')||''};
function headers(json=false){return {'Authorization':`Bearer ${state.secret}`,...(json?{'Content-Type':'application/json'}:{})};}
function error(message){$('alert').textContent=message;$('alert').hidden=false;}
function clear(){ $('alert').hidden=true;$('progress').hidden=true;$('finished').hidden=true;}
function loginGate(open){$('gate').hidden=!open;}
loginGate(!state.secret);
$('login').addEventListener('submit',async e=>{
 e.preventDefault();const candidate=$('secret').value.trim();if(!candidate)return;
 // Health is public; the authenticated status is checked using a non-mutating job lookup.
 try{const r=await fetch('/api/jobs/'+('0'.repeat(48)),{headers:{Authorization:`Bearer ${candidate}`}});if(r.status===401)throw Error();state.secret=candidate;sessionStorage.setItem('media_studio_key',candidate);$('gate-error').hidden=true;loginGate(false);}catch{$('gate-error').hidden=false;}
});
$('formats').addEventListener('click',e=>{const b=e.target.closest('button[data-format]');if(!b)return;state.format=b.dataset.format;document.querySelectorAll('[data-format]').forEach(x=>x.classList.toggle('selected',x===b));$('quality').disabled=state.format!=='mp4';$('quality-hint').textContent=state.format==='mp4'?'La resolución disponible depende del video.':'La mejor calidad de audio disponible será convertida.';});
$('paste-btn').addEventListener('click',async()=>{try{$('video-url').value=await navigator.clipboard.readText();$('video-url').focus();}catch{error('Tu navegador no permitió pegar automáticamente. Usa Ctrl+V o Cmd+V.');}});
function processing(value){$('submit').disabled=value;$('submit-label').textContent=value?'PROCESANDO...':'PREPARAR DESCARGA';}
async function check(id){
 try{const r=await fetch('/api/jobs/'+id,{headers:headers()});if(r.status===401){loginGate(true);throw Error('Tu sesión caducó. Ingresa nuevamente.');}const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo consultar el estado.');const job=data.job;
 if(job.status==='queued'||job.status==='processing'){$('progress-text').textContent=job.status==='queued'?'En cola...':'Descargando y convirtiendo...';state.timer=setTimeout(()=>check(id),1800);return;}
 processing(false);$('progress').hidden=true;
 if(job.status==='done'){$('finished-name').textContent=job.filename;$('finished').hidden=false;}else error(job.error||'La descarga no pudo completarse.');
 }catch(e){processing(false);$('progress').hidden=true;error(e.message);}
}
$('submit').addEventListener('click',async()=>{
 clear();if(state.timer)clearTimeout(state.timer);
 const url=$('video-url').value.trim();if(!url){error('Pega un enlace de YouTube.');return;}
 processing(true);
 try{
 const r=await fetch('/api/jobs',{method:'POST',headers:headers(true),body:JSON.stringify({url,format:state.format,quality:$('quality').value})});const data=await r.json();if(r.status===401){sessionStorage.removeItem('media_studio_key');loginGate(true);throw Error('La sesión no es válida.');}if(!r.ok)throw Error(data.error||'No se pudo iniciar la descarga.');
 state.id=data.job.id;$('progress').hidden=false;check(state.id);
 }catch(e){processing(false);error(e.message);}
});
$('download').addEventListener('click',async()=>{
 if(!state.id)return;
 const btn=$('download');btn.disabled=true;btn.textContent='PREPARANDO...';
 try{const r=await fetch(`/api/jobs/${state.id}/download`,{headers:headers()});if(!r.ok){const x=await r.json();throw Error(x.error||'No se pudo descargar.');}const blob=await r.blob();const objectUrl=URL.createObjectURL(blob);const a=document.createElement('a');a.href=objectUrl;a.download=$('finished-name').textContent||`media-studio.${state.format}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);}catch(e){error(e.message);}finally{btn.disabled=false;btn.textContent='DESCARGAR ↓';}
});
