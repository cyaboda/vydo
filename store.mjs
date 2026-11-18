import {DatabaseSync} from 'node:sqlite';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HOUR = 3600000, LEASE = 90000;
export class LimitError extends Error {
  constructor(message, retryAfter=60) { super(message); this.status=429; this.retryAfter=retryAfter; }
}
export async function sqliteAdapter(filename) {
  if (filename !== ':memory:') await mkdir(path.dirname(path.resolve(filename)), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(await readFile(new URL('./migrations/sqlite.sql',import.meta.url),'utf8'));
  if(!db.prepare('PRAGMA table_info(vydo_sessions)').all().some(column=>column.name==='version'))db.exec('ALTER TABLE vydo_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
  let tail=Promise.resolve();
  return {kind:'sqlite', async tx(fn) {
    const previous=tail; let release; tail=new Promise(r=>{release=r;}); await previous;
    try { db.exec('BEGIN IMMEDIATE');
      const q=async(sql,params=[])=>db.prepare(sql).all(...params);
      try {const result=await fn(q);db.exec('COMMIT');return result;}
      catch(e){db.exec('ROLLBACK');throw e;}
    } finally {release();}
  }, close(){db.close();}};
}
export function postgresConfig(connectionString) {
  const connection=new URL(connectionString);
  const local=['localhost','127.0.0.1','[::1]'].includes(connection.hostname);
  const mode=connection.searchParams.get('sslmode');
  if(!local&&mode!=='verify-full')throw Error('PostgreSQL remoto requiere sslmode=verify-full.');
  if(mode==='verify-full'){
    // Keep verify-full in the URL: pg's URL parser replaces a separate ssl object.
    // Collapse duplicate modes so a later URL option cannot downgrade verification.
    connection.searchParams.set('sslmode','verify-full');
    if(connection.hostname.endsWith('.pooler.supabase.com')&&!connection.searchParams.has('sslrootcert')){
      connection.searchParams.set('sslrootcert',fileURLToPath(new URL('./certs/supabase-prod-ca-2021.crt',import.meta.url)));
    }
  }
  return {connectionString:connection.href,max:5,connectionTimeoutMillis:5000,statement_timeout:10000};
}
export async function postgresAdapter(connectionString) {
  const config=postgresConfig(connectionString);
  const {Pool}=await import('pg');
  const pool=new Pool(config);
  const tables={vydo_usage:'private.vydo_usage',vydo_sessions:'private.vydo_sessions',vydo_rates:'private.vydo_rates',vydo_profiles:'public.vydo_profiles',vydo_history:'public.vydo_history'};
  function translate(sql){let n=0;return sql.replace(/\bvydo_(usage|sessions|rates|profiles|history)\b/g,t=>tables[t]).replace(/\?/g,()=>'$'+(++n));}
  return {kind:'postgres', async tx(fn, lock=false) {
    const client=await pool.connect();
    try {await client.query('BEGIN');await client.query('SET LOCAL ROLE service_role');
      if(lock)await client.query('SELECT pg_advisory_xact_lock(86734232)');
      const result=await fn(async(sql,params=[]) => (await client.query(translate(sql),params)).rows);
      await client.query('COMMIT');return result;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }, close(){return pool.end();}};
}

export class Store {
  constructor(adapter,{clock=()=>Date.now()}={}) {this.db=adapter;this.clock=clock;}
  async sweep(q,now) {
    const stale=await q("SELECT id FROM vydo_usage WHERE state='active' AND lease_ms<=?",[now]);
    for(const {id} of stale){await q("UPDATE vydo_usage SET state='error',refunded=1 WHERE id=?",[id]);await q("UPDATE vydo_history SET status='error' WHERE id=?",[id]);}
  }
  async quota(subject,registered) {
    return this.db.tx(async q=>{const now=this.clock();await this.sweep(q,now);return this.quotaIn(q,subject,registered,now);},true);
  }
  async quotaIn(q,subject,registered,now) {
    const rows=await q('SELECT created_ms FROM vydo_usage WHERE subject=? AND refunded=0 AND created_ms>? ORDER BY created_ms',[subject,now-HOUR]);
    const limit=registered?15:5;
    return {limit,used:rows.length,remaining:Math.max(0,limit-rows.length),resetAt:rows.length?Number(rows[0].created_ms)+HOUR:null,
      retryAfter:rows.length>=limit?Math.max(1,Math.ceil((Number(rows[0].created_ms)+HOUR-now)/1000)):0};
  }
  async reserve({id,subject,ip,registered,worker,userId,title,videoId,format,quality}) {
    return this.db.tx(async q=>{
      const now=this.clock();await this.sweep(q,now);
      const quota=await this.quotaIn(q,subject,registered,now);
      if(!quota.remaining)throw new LimitError('Has utilizado tu cupo. Espera a que se libere una descarga.',quota.retryAfter);
      if((await q("SELECT id FROM vydo_usage WHERE subject=? AND state='active'",[subject])).length)throw new LimitError('Ya tienes una descarga en curso.',2);
      const ipRows=await q('SELECT state FROM vydo_usage WHERE ip=? AND created_ms>? AND refunded=0',[ip,now-HOUR]);
      if(ipRows.length>=60||ipRows.filter(r=>r.state==='active').length>=3)throw new LimitError('Esta red está ocupada. Espera antes de volver a intentarlo.');
      if((await q("SELECT id FROM vydo_usage WHERE state='active'")).length>=4)throw new LimitError('El servidor está ocupado. Inténtalo en un momento.',5);
      await q("INSERT INTO vydo_usage(id,subject,ip,created_ms,state,refunded,lease_ms,worker) VALUES(?,?,?,?,'active',0,?,?)",[id,subject,ip,now,now+LEASE,worker]);
      if(userId)await q("INSERT INTO vydo_history(id,user_id,title,video_id,format,quality,status,created_ms) VALUES(?,?,?,?,?,?,'processing',?)",[id,userId,title,videoId,format,quality,now]);
      return {...quota,used:quota.used+1,remaining:quota.remaining-1,resetAt:quota.resetAt||now+HOUR};
    },true);
  }
  async release(id) {await this.db.tx(async q=>{await q('DELETE FROM vydo_usage WHERE id=?',[id]);await q('DELETE FROM vydo_history WHERE id=?',[id]);},true);}
  async finish(id,status,internal=false) {await this.db.tx(async q=>{
    const now=this.clock();await this.sweep(q,now);
    const rows=await q('UPDATE vydo_usage SET state=?,refunded=? WHERE id=? AND state=\'active\' RETURNING id',[status,internal?1:0,id]);
    if(status==='done'&&!rows.length)throw Object.assign(Error('La concesión del trabajo caducó. El archivo no se publicará.'),{internal:true});
    await q('UPDATE vydo_history SET status=? WHERE id=?',[status,id]);
  },true);}
  async heartbeat(worker,ids) {return this.db.tx(async q=>{
    const now=this.clock(),alive=[];
    for(const id of ids){const rows=await q("UPDATE vydo_usage SET lease_ms=? WHERE id=? AND worker=? AND state='active' AND lease_ms>? RETURNING id",[now+LEASE,id,worker,now]);if(rows.length)alive.push(id);}
    return alive;
  },true);}
  async rate(key,limit,window=60000) {return this.db.tx(async q=>{
    const now=this.clock();const rows=await q('SELECT id FROM vydo_rates WHERE rate_key=? AND created_ms>?',[key,now-window]);
    if(rows.length>=limit)throw new LimitError('Demasiadas solicitudes. Espera antes de volver a intentarlo.',Math.ceil(window/1000));
    await q('INSERT INTO vydo_rates(id,rate_key,created_ms) VALUES(?,?,?)',[randomBytes(12).toString('hex'),key,now]);
  },true);}
  async session(id) {return this.db.tx(async q=>(await q('SELECT * FROM vydo_sessions WHERE id=? AND expires_ms>?',[id,this.clock()]))[0]||null);}
  async saveSession(id,payload,userId,expires,expectedVersion) {return this.db.tx(async q=>{
    const rows=await q('INSERT INTO vydo_sessions AS current_session(id,payload,user_id,expires_ms,version) VALUES(?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,user_id=excluded.user_id,expires_ms=excluded.expires_ms,version=current_session.version+1 WHERE ?=1 OR current_session.version=? RETURNING version',[id,payload,userId||null,expires,expectedVersion===undefined?1:0,expectedVersion??0]);
    if(!rows.length)throw Object.assign(Error('La sesión se actualizó en otra solicitud. Inténtalo de nuevo.'),{status:503});
    return Number(rows[0].version);
  });}
  async removeSession(id) {await this.db.tx(q=>q('DELETE FROM vydo_sessions WHERE id=?',[id]));}
  async profile(userId,name='') {return this.db.tx(async q=>{
    await q("INSERT INTO vydo_profiles(user_id,name,format,quality) VALUES(?,?,'mp3','720') ON CONFLICT(user_id) DO NOTHING",[userId,name]);
    return (await q('SELECT name,format,quality FROM vydo_profiles WHERE user_id=?',[userId]))[0];
  });}
  async updateProfile(userId,{name,format,quality}) {
    await this.profile(userId);
    await this.db.tx(q=>q('UPDATE vydo_profiles SET name=?,format=?,quality=? WHERE user_id=?',[name,format,quality,userId]));
    return this.profile(userId);
  }
  async history(userId) {return this.db.tx(q=>q('SELECT id,title,video_id,format,quality,status,created_ms FROM vydo_history WHERE user_id=? ORDER BY created_ms DESC LIMIT 50',[userId]));}
  async deleteHistory(userId,id) {await this.db.tx(q=>q('DELETE FROM vydo_history WHERE user_id=? AND id=?',[userId,id]));}
  async eraseUser(userId) {await this.db.tx(async q=>{
    await q('DELETE FROM vydo_sessions WHERE user_id=?',[userId]);await q('DELETE FROM vydo_history WHERE user_id=?',[userId]);await q('DELETE FROM vydo_profiles WHERE user_id=?',[userId]);
  });}
  async maintenance() {await this.db.tx(async q=>{const now=this.clock();await this.sweep(q,now);
    await q('DELETE FROM vydo_rates WHERE created_ms<=?',[now-24*HOUR]);
    await q("DELETE FROM vydo_usage WHERE created_ms<=? AND state<>'active'",[now-HOUR]);
    await q('DELETE FROM vydo_sessions WHERE expires_ms<=?',[now]);
    await q('DELETE FROM vydo_history WHERE created_ms<=?',[now-30*24*HOUR]);
  },true);}
  async close(){await this.db.close();}
}
export async function createStore({filename=process.env.DATA_DIR?path.join(process.env.DATA_DIR,'vydo.sqlite'):'data/vydo.sqlite',databaseUrl=process.env.DATABASE_URL}={}) {
  const adapter=databaseUrl?await postgresAdapter(databaseUrl):await sqliteAdapter(filename);
  const store=new Store(adapter);await store.maintenance();return store;
}
