import {createHmac, randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {isIP, BlockList} from 'node:net';
import path from 'node:path';
import {secureEqual} from './lib.mjs';

export async function appSecret({value=process.env.APP_SECRET,dir=process.env.DATA_DIR||'data',remote=Boolean(process.env.DATABASE_URL)}={}) {
  if(value){if(!/^[a-f0-9]{64}$/i.test(value))throw Error('APP_SECRET debe contener 64 caracteres hexadecimales.');return Buffer.from(value,'hex');}
  if(remote)throw Error('Configura APP_SECRET persistente para PostgreSQL.');
  await mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,'secret.key');
  try {await writeFile(file,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  return Buffer.from((await readFile(file,'utf8')).trim(),'hex');
}
export const digest=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
export function seal(key,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
export function unseal(key,value){const data=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString());}
export function cookie(req,name){return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
export function setCookie(res,name,value,{secure=false,maxAge=2592000}={}) {
  const current=res.getHeader('Set-Cookie')||[];
  res.setHeader('Set-Cookie',[...(Array.isArray(current)?current:[current]),`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`]);
}
export function guest(req,res,key,secure){let raw=cookie(req,'vydo_guest');const [id,signature]=raw.split('.');
  if(!/^[a-f0-9]{48}$/.test(id||'')||!secureEqual(signature,digest(key,'guest:'+id))){raw=randomBytes(24).toString('hex');raw+='.'+digest(key,'guest:'+raw);setCookie(res,'vydo_guest',raw,{secure});}
  return 'g:'+digest(key,raw);
}
export function clientIP(req,trustedCidrs=[]) {
  const normalize=ip=>ip?.startsWith('::ffff:')&&isIP(ip.slice(7))===4?ip.slice(7):ip?.toLowerCase();
  const blocks=new BlockList();
  for(const cidr of trustedCidrs){const [ip,bits]=cidr.split('/');const family=isIP(ip);if(!family)throw Error('TRUSTED_PROXY_CIDRS inválido.');blocks.addSubnet(ip,Number(bits??(family===4?32:128)),family===4?'ipv4':'ipv6');}
  const trusted=ip=>isIP(ip)&&blocks.check(ip,isIP(ip)===4?'ipv4':'ipv6');
  let ip=normalize(req.socket.remoteAddress);
  if(!isIP(ip))throw Error('No se pudo identificar la dirección de red.');
  if(trusted(ip)&&req.headers['x-forwarded-for']){
    const hops=String(req.headers['x-forwarded-for']).split(',').map(x=>normalize(x.trim()));
    if(hops.length>10||hops.some(x=>!isIP(x)))throw Error('Cadena de proxy inválida.');
    for(let i=hops.length-1;i>=0&&trusted(ip);i--)ip=hops[i];
  }
  return ip;
}
// Group IPv6 addresses by /64 for the additional shared-network abuse guard.
export function networkIP(ip){if(isIP(ip)===4)return ip;const url=new URL(`http://[${ip}]/`);let parts=url.hostname.slice(1,-1).split('::');
  const left=parts[0]?parts[0].split(':'):[],right=parts[1]?parts[1].split(':'):[];
  const all=parts.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  return all.slice(0,4).map(s=>s.padStart(4,'0')).join(':')+'::/64';
}
