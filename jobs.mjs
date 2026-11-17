import {mkdtemp, rm, readdir, stat, utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {token,downloadFilename} from './lib.mjs';

export class Jobs {
  constructor(engine,{concurrency=1,maxQueue=3,ttl=1200000,maxJobs=32,onFinish=async()=>{}}={}) {
    Object.assign(this,{engine,concurrency,maxQueue,ttl,maxJobs,onFinish});
    this.items=new Map();this.queue=[];this.running=new Set();this.closed=false;
  }
  async init() { this.root=await mkdtemp(path.join(os.tmpdir(),'vydo-')); return this; }
  get(id,owner) {const j=this.items.get(id);return j?.owner===owner?j:null;}
  view(j) {return {id:j.id,status:j.status,format:j.format,quality:j.quality,progress:j.progress,error:j.error,
    filename:j.filename,createdAt:j.createdAt,transferCount:j.transferCount||0,downloadedAt:j.downloadedAt||null,expiresAt:j.finishedAt?j.finishedAt+this.ttl:null};}
  create(input,owner) {
    if(this.closed || this.items.size>=this.maxJobs || (this.running.size>=this.concurrency && this.queue.length>=this.maxQueue))
      throw Object.assign(Error('Capacidad completa. Espera antes de volver a intentarlo.'),{status:429});
    const j={...input,id:input.id||token(),owner,status:'queued',createdAt:Date.now(),progress:{phase:'queued',percent:null},controller:new AbortController()};
    this.items.set(j.id,j);this.queue.push(j);this.drain();return j;
  }
  drain() {
    while(!this.closed && this.running.size<this.concurrency && this.queue.length){
      const j=this.queue.shift();const task=this.process(j);this.running.add(task);
      task.finally(()=>{this.running.delete(task);this.drain();});
    }
  }
  async process(j) {
    j.status='processing';
    try {
      j.dir=await mkdtemp(path.join(this.root,'job-'));
      j.file=await this.engine.process(j,j.dir,p=>{j.progress=p;},j.controller.signal);
      if(j.controller.signal.aborted)throw Error('Trabajo cancelado.');
      for(const name of await readdir(j.dir))if(path.join(j.dir,name)!==j.file)await rm(path.join(j.dir,name),{force:true});
      j.filename=downloadFilename(j.title,j.format);
      await this.onFinish(j,'done',false);j.status='done';j.progress={phase:'done',percent:100};
    } catch(e) {j.error=e.message;
      if(j.dir)await rm(j.dir,{recursive:true,force:true}).catch(()=>{});
      const internal=Boolean(j.internalFailure||e.internal||e.code);
      const status=j.controller.signal.aborted&&!internal?'cancelled':'error';
      try{await this.onFinish(j,status,internal);}catch{j.error='No se pudo actualizar el estado. El cupo se recuperará automáticamente.';}
      j.status=status;
    } finally {j.finishedAt=Date.now();}
  }
  async cancel(j) {
    if(j.status==='queued') {this.queue=this.queue.filter(x=>x!==j);await this.onFinish(j,j.internalFailure?'error':'cancelled',Boolean(j.internalFailure));j.status=j.internalFailure?'error':'cancelled';j.finishedAt=Date.now();}
    if(j.status==='processing')j.controller.abort();
  }
  async cleanup(now=Date.now()) {
    await utimes(this.root,new Date(),new Date());
    for(const [id,j] of this.items)if(j.finishedAt && now-j.finishedAt>=this.ttl && !j.readers){
      if(j.dir)await rm(j.dir,{recursive:true,force:true});this.items.delete(id);
    }
  }
  async close() {
    this.closed=true;for(const j of this.items.values()){j.internalFailure=true;await this.cancel(j);}
    await Promise.allSettled([...this.running]);await rm(this.root,{recursive:true,force:true});
  }
}

export async function cleanStaleRoots(age=24*3600000) {
  for(const name of await readdir(os.tmpdir()))if(/^vydo-[a-zA-Z0-9]+$/.test(name)){
    const dir=path.join(os.tmpdir(),name);
    try {if(Date.now()-(await stat(dir)).mtimeMs>age)await rm(dir,{recursive:true,force:true});}catch{}
  }
}
