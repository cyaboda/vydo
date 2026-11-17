/* Optional advertising and a conservative, dismissible support message. No tracking or extension fingerprinting. */
(() => {
  const $ = id => document.getElementById(id);
  const storageKey='vydo_ad_notice_v1',period=30*86400000;
  let config=null,signature='',watching=false;
  function record(){
    try{const value=localStorage.getItem(storageKey);if(!value)return {eligible:true};
      const data=JSON.parse(value),at=Math.max(Number(data.shownAt)||0,Number(data.dismissedAt)||0);
      if(!Number.isFinite(at)||!at)return {eligible:false};
      return {...data,eligible:Date.now()-at>=period};
    }catch{return {eligible:false};}
  }
  function save(choice){
    try{const data=record();localStorage.setItem(storageKey,JSON.stringify({shownAt:data.shownAt||Date.now(),dismissedAt:choice==='shown'?data.dismissedAt||null:Date.now(),choice}));return true;}catch{return false;}
  }
  function close(choice='continue'){save(choice);$('support-message').hidden=true;}
  function configure(ad){
    const next=JSON.stringify(ad||null);if(next===signature)return;signature=next;config=ad;
    document.body.classList.toggle('with-ad',Boolean(ad));
    const container=$('advertisement');container.hidden=!ad;
    if(!ad){$('ad-image').removeAttribute('src');$('ad-link').removeAttribute('href');return;}
    $('ad-link').href=ad.target;$('ad-image').alt=`Publicidad de ${ad.provider}`;
    $('ad-image').onerror=()=>{container.hidden=true;};
    $('ad-image').src=ad.image;
  }
  async function sample(){
    if(!config||!navigator.onLine||document.visibilityState==='hidden')return 'uncertain';
    const bait=document.createElement('div');bait.className='adblock-probe adsbox ad-banner ad-unit';bait.setAttribute('aria-hidden','true');document.body.append(bait);
    try{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const style=getComputedStyle(bait),box=bait.getBoundingClientRect();
      const hidden=style.display==='none'||style.visibility==='hidden'||box.width===0||box.height===0;
      let blocked=false;
      try{const response=await fetch('/ads/advertisement.js',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(!response.ok)return 'uncertain';}
      catch(error){if(error.name!=='TypeError')return 'uncertain';blocked=true;}
      const control=await fetch('/api/ad-check',{cache:'no-store',signal:AbortSignal.timeout(3000)});
      if(!control.ok)return 'uncertain';const value=await control.json();
      if(value.marker!=='vydo-ad-check'||!value.enabled||!navigator.onLine)return 'uncertain';
      return hidden&&blocked?'likely-blocked':(!hidden&&!blocked?'clear':'uncertain');
    }catch{return 'uncertain';}finally{bait.remove();}
  }
  async function consider(){
    if(!config||!record().eligible||!$('support-message').hidden)return;
    if(document.querySelector('dialog[open]'))return;
    if(await sample()!=='likely-blocked')return;
    // Two matching independent signals, twice, plus a working same-origin control.
    if(await sample()!=='likely-blocked'||!record().eligible)return;
    if(!save('shown'))return;
    $('support-help').hidden=true;$('support-message').hidden=false;
  }
  async function watch(id,baseline,link){
    if(watching||!config||!record().eligible)return;watching=true;
    try{
      for(let attempt=0;attempt<60;attempt++){
        await new Promise(resolve=>setTimeout(resolve,1000));
        if(!config||!record().eligible)return;
        const response=await fetch(`/api/jobs/${id}`,{cache:'no-store'});if(!response.ok)return;
        const {job}=await response.json();
        if(job.status!=='done')return;
        if(job.transferCount>baseline){link.dataset.transferCount=String(job.transferCount);await consider();return;}
      }
    }catch{/* Optional message failure never changes or retries a download. */}
    finally{watching=false;}
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest('a#download');if(!link||event.defaultPrevented)return;
    const match=new URL(link.href,location.href).pathname.match(/^\/api\/jobs\/([a-f0-9]{48})\/download$/);
    if(match)watch(match[1],Number(link.dataset.transferCount)||0,link);
  });
  $('support-close').addEventListener('click',()=>close('close'));
  $('support-continue').addEventListener('click',()=>close('continue'));
  $('support-allow').addEventListener('click',()=>{save('help');$('support-help').hidden=false;$('support-help').focus();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!$('support-message').hidden&&!document.querySelector('dialog[open]')){close('escape');}
  });
  window.vydoAds={configure};
})();
