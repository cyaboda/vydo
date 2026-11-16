import { randomBytes, timingSafeEqual } from 'node:crypto';

export const FORMATS = new Set(['mp4','mp3','wav','flac','m4a']);
export const QUALITIES = new Set(['best','1080','720','480','360']);
export function parseYoutubeUrl(raw) {
  if(typeof raw !== 'string' || raw.length > 2048) throw new Error('Enlace no válido.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('Ingresa un enlace completo de YouTube.'); }
  if(url.protocol !== 'https:') throw new Error('El enlace debe comenzar con https://');
  if(url.username || url.password || url.port) throw new Error('Enlace no permitido.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['shorts','live','embed'].includes(parts[0])) id = parts[1];
  }
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error('Solo admitimos enlaces a videos individuales de YouTube.');
  return `https://www.youtube.com/watch?v=${id}`;
}
export function validateRequest(data) {
  if (!data || typeof data !== 'object') throw new Error('Solicitud inválida.');
  const url = parseYoutubeUrl(data.url);
  if (!FORMATS.has(data.format)) throw new Error('Formato no compatible.');
  if (!QUALITIES.has(data.quality)) throw new Error('Calidad no compatible.');
  return {url,format:data.format,quality:data.quality};
}
export function secureEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const aa=Buffer.from(a); const bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
export function token(){return randomBytes(24).toString('hex');}
