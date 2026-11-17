const $=id=>document.getElementById(id);
const state={preview:null,url:null,job:sessionStorage.getItem('vydo_job'),timer:null,busy:false};
async function api(path,method='GET',data){
  const r=await fetch(path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const value=await r.json();
  if(r.status===401&&!path.endsWith('/session'))showGate();
  if(!r.ok)throw Error(value.error||`Error ${r.status}`);
  return value;
}
function error(message){$('alert').textContent=message;$('alert').hidden=false;}
function showGate(){if(!$('gate').open)$('gate').showModal();$('password').focus();}
$('gate').addEventListener('cancel',e=>e.preventDefault());
$('login').addEventListener('submit',async e=>{
  e.preventDefault();$('login-button').disabled=true;
  try{await api('/api/session','POST',{password:$('password').value});$('password').value='';$('gate').close();$('login-error').hidden=true;$('logout').hidden=false;if(state.job)poll();}
  catch(err){$('login-error').textContent=err.message;$('login-error').hidden=false;}
  finally{$('login-button').disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  try{await api('/api/session','DELETE');clearTimeout(state.timer);state.job=null;sessionStorage.removeItem('vydo_job');location.reload();}catch(e){error(e.message);}
});
$('paste').addEventListener('click',async()=>{try{$('url').value=await navigator.clipboard.readText();invalidate();}catch{$('url').focus();}});
function invalidate(){state.preview=null;$('preview').hidden=true;}
$('url').addEventListener('input',invalidate);
function busy(value){state.busy=value;$('start').disabled=value;$('analyze').disabled=value;$('url').disabled=value;$('paste').disabled=value;$('options').disabled=value;}
$('analyze-form').addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy)return;
  $('alert').hidden=true;invalidate();$('finished').hidden=true;$('analyze').textContent='Analizando…';busy(true);
  try{
    state.url=$('url').value.trim();const {preview:p}=await api('/api/preview','POST',{url:state.url,authorized:$('permission').checked});state.preview=p;
    $('title').textContent=p.title;$('duration').textContent=`${Math.floor(p.duration/60)}:${String(Math.floor(p.duration%60)).padStart(2,'0')} · formatos disponibles`;
    $('thumbnail').hidden=!p.thumbnail;if(p.thumbnail)$('thumbnail').src=p.thumbnail;
    $('thumbnail').onerror=()=>{$('thumbnail').hidden=true;};
    for(const input of document.querySelectorAll('[name=format]'))input.disabled=!p.formats.includes(input.value);
    const first=[...document.querySelectorAll('[name=format]')].find(input=>p.formats.includes(input.value));if(!first)throw Error('No se encontraron formatos descargables.');first.checked=true;
    $('quality').replaceChildren(...p.qualities.map(q=>{const o=document.createElement('option');o.value=q;o.textContent=q+'p';return o;}));
    updateFormat();$('preview').hidden=false;
  }catch(err){error(err.message);}finally{busy(false);$('analyze').innerHTML='Analizar enlace <span aria-hidden="true">→</span>';}
});
function updateFormat(){const format=document.querySelector('[name=format]:checked')?.value;$('quality').disabled=format!=='mp4';}
$('formats').addEventListener('change',updateFormat);
$('download-form').addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy||!state.preview)return;
  if(!$('permission').checked){error('Confirma tu autorización para descargar.');return;}
  $('alert').hidden=true;$('finished').hidden=true;busy(true);
  try{
    const {job}=await api('/api/jobs','POST',{url:state.url,previewId:state.preview.id,authorized:true,format:document.querySelector('[name=format]:checked').value,quality:$('quality').value||'720'});
    state.job=job.id;sessionStorage.setItem('vydo_job',job.id);poll();
  }catch(err){busy(false);error(err.message);}
});
function finish(){busy(false);state.job=null;sessionStorage.removeItem('vydo_job');$('cancel').hidden=true;}
async function poll(){
  if(!state.job)return;busy(true);$('progress-panel').hidden=false;$('cancel').hidden=false;
  try{
    const {job}=await api('/api/jobs/'+state.job);const p=job.progress;
    const labels={queued:'En cola',preparing:'Preparando el origen',downloading:'Descargando el origen',converting:'Convirtiendo tu archivo',done:'Archivo preparado'};
    $('phase').textContent=labels[p.phase]||'Procesando';$('percent').textContent=p.percent==null?'':`${Math.floor(p.percent)}%`;
    if(p.percent==null)$('progress').removeAttribute('value');else $('progress').value=p.percent;
    $('detail').textContent=p.phase==='downloading'?`${((p.bytes||0)/1048576).toFixed(1)} MB recibidos${p.speed?' · '+(p.speed/1048576).toFixed(1)+' MB/s':''}${p.eta!=null?' · '+Math.ceil(p.eta)+' s restantes':''}. El progreso puede reiniciarse entre las pistas de video y audio.`:p.phase==='converting'?'Progreso de conversión medido por FFmpeg.':p.phase==='queued'?'Tu trabajo comenzará cuando haya capacidad disponible.':'';
    if(job.status==='done'){
      $('download').href=`/api/jobs/${job.id}/download`;$('download').download=job.filename;
      $('expiry').textContent=`Disponible hasta las ${new Date(job.expiresAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}.`;
      $('finished').hidden=false;$('progress-panel').hidden=true;finish();return;
    }
    if(['error','cancelled'].includes(job.status)){finish();$('progress-panel').hidden=true;throw Error(job.error||'Trabajo cancelado.');}
    state.timer=setTimeout(poll,1000);
  }catch(err){error(err.message);busy(false);$('cancel').hidden=true;/* Keep the ID so reload can recover a running job after a network failure. */}
}
$('cancel').addEventListener('click',async()=>{try{await api('/api/jobs/'+state.job,'DELETE');}catch(e){error(e.message);}});
(async()=>{try{await api('/api/session');$('logout').hidden=false;if(state.job)poll();}catch{showGate();}})();
