const $ = id => document.getElementById(id);
const state = {
  preview: null, url: null, job: sessionStorage.getItem('vydo_job'),
  timer: null, busy: false, audio: 'mp3', preferredQuality: null, accountId: null
};
const audioFormats = ['mp3', 'm4a', 'wav', 'flac'];
const selectedMode = () => document.querySelector('[name="mode"]:checked').value;
const selectedFormat = () => selectedMode() === 'mp4' ? 'mp4' : state.audio;

async function api(path, method = 'GET', data) {
  const response = await fetch(path, {
    method, headers: data ? {'Content-Type': 'application/json'} : {},
    body: data ? JSON.stringify(data) : undefined
  });
  const value = await response.json();
  if (value.quota) window.vydoAccount.setQuota(value.quota);
  if (!response.ok) { if(response.status===429)window.vydoAccount.refresh().catch(()=>{});throw Error(value.error || `Error ${response.status}`); }
  return value;
}
function error(message) { $('alert').textContent = message; $('alert').hidden = false; }
function busy(value) {
  state.busy = value;
  for (const id of ['analyze', 'start', 'url', 'paste', 'options', 'mode-options', 'preferred-audio', 'main-audio']) $(id).disabled = value;
}
function invalidate() {
  state.preview = null;
  $('preview').hidden = true;
  $('finished').hidden = true;
  $('permission').checked = false;
}
function updateMode() {
  const video = selectedMode() === 'mp4';
  $('audio-label').textContent = 'Audio';
  $('main-audio-row').hidden = video;
  $('main-audio').value = state.audio;
  $('quality-row').hidden = !video;
  $('quality').disabled = !video;
  $('audio-options').hidden = video;
  $('audio-format').value = state.audio;
  $('preferred-audio').value = state.audio;
  $('start-label').textContent = `Descargar ${selectedFormat().toUpperCase()}`;
}
function setAudio(value) {
  if (!audioFormats.includes(value)) return;
  state.audio = value;
  updateMode();
}
$('mode-options').addEventListener('change', updateMode);
$('audio-format').addEventListener('change', e => setAudio(e.target.value));
$('preferred-audio').addEventListener('change', e => setAudio(e.target.value));
$('main-audio').addEventListener('change', e => setAudio(e.target.value));
$('url').addEventListener('input', invalidate);
$('paste').addEventListener('click', async () => {
  try { $('url').value = await navigator.clipboard.readText(); invalidate(); }
  catch { $('url').focus(); error('Pega el enlace con Ctrl+V o con la opción Pegar de tu dispositivo.'); }
});
$('settings-button').addEventListener('click', () => $('settings').showModal());
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => $(button.dataset.close).close());
}
$('analyze-form').addEventListener('submit', e => {
  e.preventDefault();
  if (state.busy) return;
  if (state.job) { poll(); return; }
  if (!$('permission').checked) { $('consent-dialog').showModal(); return; }
  if (state.preview) startJob(); else analyze();
});
$('consent-form').addEventListener('submit', e => {
  e.preventDefault(); $('consent-dialog').close(); analyze();
});
async function analyze() {
  if (state.busy) return;
  $('alert').hidden = true; $('finished').hidden = true; $('preview').hidden = true;
  $('analyze-label').textContent = 'Analizando…'; busy(true);
  let startAudio = false;
  try {
    state.url = $('url').value.trim();
    const {preview} = await api('/api/preview', 'POST', {url: state.url, authorized: $('permission').checked});
    state.preview = preview;
    if (!preview.formats.includes(selectedFormat())) throw Error('El formato seleccionado no está disponible para este video.');
    $('title').textContent = preview.title;
    $('duration').textContent = `${Math.floor(preview.duration / 60)}:${String(Math.floor(preview.duration % 60)).padStart(2, '0')}`;
    $('thumbnail').hidden = !preview.thumbnail;
    if (preview.thumbnail) $('thumbnail').src = preview.thumbnail;
    $('thumbnail').onerror = () => { $('thumbnail').hidden = true; };
    $('quality').replaceChildren(...preview.qualities.map(q => {
      const option = document.createElement('option'); option.value = q; option.textContent = `${q}p`; return option;
    }));
    if (preview.qualities.includes(state.preferredQuality)) $('quality').value=state.preferredQuality;
    for (const select of [$('audio-format'), $('preferred-audio'), $('main-audio')]) {
      for (const option of select.options) option.disabled = !preview.formats.includes(option.value);
    }
    updateMode();
    $('preview').hidden = false;
    startAudio = selectedMode() === 'audio';
    if (!startAudio) $('quality').focus();
  } catch (err) { state.preview = null; error(err.message); }
  finally { busy(false); $('analyze-label').textContent = 'Descargar'; }
  if (startAudio) startJob();
}
$('download-form').addEventListener('submit', e => { e.preventDefault(); startJob(); });
async function startJob() {
  if (state.busy || !state.preview) return;
  if (!$('permission').checked) { $('consent-dialog').showModal(); return; }
  $('alert').hidden = true; $('finished').hidden = true; busy(true);
  try {
    const {job} = await api('/api/jobs', 'POST', {
      url: state.url, previewId: state.preview.id, authorized: true,
      format: selectedFormat(), quality: $('quality').value || '720'
    });
    state.job = job.id; sessionStorage.setItem('vydo_job', job.id);
    $('preview').hidden = true; poll();
  } catch (err) { busy(false); error(err.message); }
}
function finish() {
  busy(false); state.job = null; sessionStorage.removeItem('vydo_job');
  $('cancel').hidden = true; $('retry').hidden = true; $('analyze-label').textContent = 'Descargar';
}
async function poll() {
  clearTimeout(state.timer);
  if (!state.job) return;
  busy(true); $('progress-panel').hidden = false; $('cancel').hidden = false; $('retry').hidden = true;
  try {
    const {job} = await api(`/api/jobs/${state.job}`);
    const progress = job.progress;
    const labels = {queued: 'En cola', preparing: 'Preparando el video', downloading: 'Descargando', converting: 'Convirtiendo', done: 'Archivo preparado'};
    $('phase').textContent = labels[progress.phase] || 'Procesando';
    $('percent').textContent = progress.percent == null ? '' : `${Math.floor(progress.percent)}%`;
    if (progress.percent == null) $('progress').removeAttribute('value'); else $('progress').value = progress.percent;
    $('detail').textContent = progress.phase === 'downloading'
      ? `${((progress.bytes || 0) / 1048576).toFixed(1)} MB${progress.speed ? ` · ${(progress.speed / 1048576).toFixed(1)} MB/s` : ''}${progress.eta != null ? ` · ${Math.ceil(progress.eta)} s restantes` : ''}. El progreso corresponde a la pista actual.`
      : progress.phase === 'converting' ? 'Progreso de conversión medido por FFmpeg.'
      : progress.phase === 'queued' ? 'Tu archivo se preparará cuando haya capacidad disponible.' : '';
    if (job.status === 'done') {
      $('download').href = `/api/jobs/${job.id}/download`; $('download').download = job.filename;
      $('expiry').textContent = `Disponible hasta las ${new Date(job.expiresAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}.`;
      $('finished').hidden = false; $('progress-panel').hidden = true; finish(); return;
    }
    if (['error', 'cancelled'].includes(job.status)) {
      finish(); $('progress-panel').hidden = true; throw Error(job.error || 'Trabajo cancelado.');
    }
    state.timer = setTimeout(poll, 1000);
  } catch (err) {
    if (state.job && /inexistente|caducado/i.test(err.message)) finish();
    error(err.message); busy(false); $('cancel').hidden = true;
    $('retry').hidden = !state.job;
    if (state.job) $('analyze-label').textContent = 'Reanudar';
  }
}
$('cancel').addEventListener('click', async () => {
  $('cancel').disabled = true;
  try { await api(`/api/jobs/${state.job}`, 'DELETE'); }
  catch (err) { error(err.message); }
  finally { $('cancel').disabled = false; }
});
$('retry').addEventListener('click', poll);
updateMode();
window.addEventListener('vydo-session',event=>{
  const value=event.detail;
  if(value.user&&value.profile&&!state.busy){
    if(state.accountId!==value.user.id||!state.job){
      state.preferredQuality=value.profile.quality;
      if(value.profile.format==='mp4')document.querySelector('[name="mode"][value="mp4"]').checked=true;
      else {setAudio(value.profile.format);document.querySelector('[name="mode"][value="audio"]').checked=true;}
      updateMode();
    }
    state.accountId=value.user.id;
  }
});
window.vydoAccount.ready.then(()=>{if(state.job)poll();});
