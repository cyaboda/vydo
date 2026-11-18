const cancelled=()=>Object.assign(Error('Análisis cancelado.'),{name:'AbortError'});
function paused(seconds,code='YOUTUBE_COOLDOWN'){
 const wait=seconds>=60?`${Math.ceil(seconds/60)} min`:`${seconds} s`;
 return Object.assign(Error(`YouTube limita las solicitudes. Prueba de nuevo en ${wait}.`),{status:503,retryAfter:seconds,diagnostic:{code,upstreamStatus:429}});
}
export function createAnalysis({engine,store,cacheMs=60000,maxCache=128,clock=()=>store.clock(),report=entry=>console.info(JSON.stringify(entry))}){
 const cache=new Map(),active=new Map();let localPause=0,closed=false;
 async function noteLimit(error){
  localPause=clock()+Math.max(1,error.retryAfter??1800)*1000;
  let pause;try{pause=await store.pauseAnalyses(error.retryAfter);}catch{throw Object.assign(Error('No se pudo guardar la pausa de YouTube. Inténtalo más tarde.'),{status:503});}
  localPause=pause.until;
  try{report({event:'youtube_analysis_paused',retryAfter:pause.retryAfter,source:pause.source});}catch{}
  return pause;
 }
 async function perform(url,entry){
  let lease;
  try{
   if(localPause>clock())throw paused(Math.ceil((localPause-clock())/1000));
   try{lease=await store.claimAnalysis();}catch{throw Object.assign(Error('El analizador no está disponible temporalmente.'),{status:503});}
   if(lease.paused)throw paused(lease.retryAfter);
   if(lease.busy)throw Object.assign(Error('El analizador está ocupado. Inténtalo en un momento.'),{status:503,retryAfter:lease.retryAfter});
   if(entry.controller.signal.aborted)throw cancelled();
   let value;
   try{value=await engine.inspect(url,entry.controller.signal);}catch(error){
    if(error.diagnostic?.upstreamStatus===429){
     const pause=await noteLimit(error);
     throw paused(pause.retryAfter,'YOUTUBE_RATE_LIMIT');
    }
    throw error;
   }
   if(entry.controller.signal.aborted)throw cancelled();
   await store.resetAnalysisBackoff();
   if(cache.size>=maxCache)cache.delete(cache.keys().next().value);
   cache.set(url,{value:structuredClone(value),until:clock()+cacheMs});return value;
  }finally{if(lease?.token)await store.releaseAnalysis(lease.token).catch(()=>{});}
 }
 function subscribe(entry,signal){return new Promise((resolve,reject)=>{
  const waiter={};entry.waiters.add(waiter);let done=false;
  const finish=(fn,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.waiters.delete(waiter);fn(value);};
  const abort=()=>{finish(reject,cancelled());if(!entry.waiters.size)entry.controller.abort();};
  entry.promise.then(value=>finish(resolve,structuredClone(value)),error=>finish(reject,error));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });}
 return {inspect(url,signal){
  if(closed||signal?.aborted)return Promise.reject(cancelled());
  const cached=cache.get(url);if(cached?.until>clock())return Promise.resolve(structuredClone(cached.value));cache.delete(url);
  let entry=active.get(url);
  if(!entry){entry={controller:new AbortController(),waiters:new Set()};active.set(url,entry);
   entry.promise=perform(url,entry).finally(()=>{if(active.get(url)===entry)active.delete(url);});entry.promise.catch(()=>{});
  }
  return subscribe(entry,signal);
 },async process(...args){
  try{return await engine.process(...args);}catch(error){
   if(error.diagnostic?.upstreamStatus===429)await noteLimit(error).catch(()=>{});
   throw error;
  }
 },async close(){closed=true;const entries=[...active.values()];for(const entry of entries)entry.controller.abort();await Promise.allSettled(entries.map(entry=>entry.promise));cache.clear();}};
}
