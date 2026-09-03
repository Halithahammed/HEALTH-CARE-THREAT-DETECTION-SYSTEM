(() => {
  const token = sessionStorage.getItem('htd_token');
  let user = {};
  try { user = JSON.parse(sessionStorage.getItem('htd_user') || '{}'); } catch (_) {}
  if (!token || !user?.id) return;

  const timeline = [];
  const rrEvents = [];
  const startedAt = Date.now();
  let rrStop = null;
  let captureInFlight = null;

  const safeText = v => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  const selector = el => {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts=[]; let n=el;
    for(let i=0;n && n!==document.body && i<4;i++,n=n.parentElement){
      let p=n.tagName.toLowerCase();
      if(n.classList?.length) p+='.'+[...n.classList].slice(0,2).map(CSS.escape).join('.');
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const add = e => {
    timeline.push({ time: Date.now(), ...e });
    if (timeline.length > 2500) timeline.splice(0, timeline.length - 2500);
  };

  add({ type:'page', label:document.title, path:location.pathname });
  document.addEventListener('click', e => {
    const t=e.target.closest('button,a,tr,input,label,[role="button"]') || e.target;
    add({type:'click',x:e.clientX,y:e.clientY,selector:selector(t),label:safeText(t.textContent || t.getAttribute?.('aria-label'))});
  }, true);
  document.addEventListener('mousemove', e => {
    const now=Date.now();
    if(now-(window.__wecareLastMove||0)<80) return;
    window.__wecareLastMove=now;
    const t=document.elementFromPoint(e.clientX,e.clientY)||e.target;
    add({type:'pointer',x:e.clientX,y:e.clientY,cursor:getComputedStyle(t).cursor==='pointer'?'pointer':'default'});
  }, {capture:true,passive:true});
  document.addEventListener('change', e => {
    if(e.target.matches('input[type=password],input[type=hidden]')) return;
    add({type:'change',selector:selector(e.target),label:e.target.name||e.target.id||e.target.tagName});
  }, true);
  let st;
  addEventListener('scroll',()=>{clearTimeout(st);st=setTimeout(()=>add({type:'scroll',x:scrollX,y:scrollY,label:'Page scroll'}),120)},{passive:true});

  function startRrweb(){
    try{
      if(!window.rrweb?.record) return false;
      rrStop = window.rrweb.record({
        emit(event){ rrEvents.push(event); },
        maskAllInputs:true,
        blockClass:'evidence-block',
        ignoreClass:'evidence-ignore',
        checkoutEveryNms:30000
      });
      return true;
    }catch(e){ console.warn('rrweb recorder unavailable:',e); return false; }
  }
  startRrweb();

  async function captureScreenshot(){
    if(typeof window.html2canvas!=='function') throw new Error('Screenshot library did not load. Check internet/CDN access.');
    const target=document.documentElement;
    const canvas=await window.html2canvas(target,{
      backgroundColor:'#ffffff',
      scale:Math.min(2,window.devicePixelRatio||1.5),
      useCORS:true,
      allowTaint:false,
      logging:false,
      imageTimeout:7000,
      removeContainer:true,
      x:window.scrollX,
      y:window.scrollY,
      width:window.innerWidth,
      height:window.innerHeight,
      windowWidth:document.documentElement.clientWidth,
      windowHeight:document.documentElement.clientHeight,
      ignoreElements:el=>el.hasAttribute?.('data-evidence-ignore') || el.classList?.contains('evidence-ignore')
    });
    const data=canvas.toDataURL('image/png',1);
    if(!data || data.length<5000) throw new Error('Screenshot capture returned an empty image.');
    return data;
  }

  function snapshotHtml(){
    const clone=document.documentElement.cloneNode(true);
    clone.querySelectorAll('script,input[type=password],input[type=hidden],.evidence-ignore,[data-evidence-ignore]').forEach(el=>el.remove());
    clone.querySelectorAll('input,textarea').forEach(el=>{el.setAttribute('value','[masked]'); if(el.tagName==='TEXTAREA') el.textContent='[masked]';});
    const head=clone.querySelector('head');
    if(head){ const base=document.createElement('base');base.href=location.origin+'/';head.prepend(base); }
    return '<!doctype html>'+clone.outerHTML;
  }

  async function sendEvidence(incident){
    add({type:'security',label:incident.actionLabel||incident.actionType||'High risk event'});
    // Allow rrweb to receive the final DOM/action mutations before copying the buffer.
    await new Promise(r=>setTimeout(r,180));
    const screenshot=await captureScreenshot();
    const replay=rrEvents.slice();
    if(replay.length<2) throw new Error('Session recording is empty.');
    const payload={
      incident:{...incident,riskLevel:incident.riskLevel||incident.risk||'Critical',timestamp:incident.timestamp||new Date().toISOString()},
      screenshot,
      replay,
      timeline:timeline.slice(),
      pageSnapshot:snapshotHtml()
    };
    const res=await fetch('/api/evidence/capture',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(d.message||`Evidence upload failed (${res.status})`);
    if(!d.hasScreenshot || !d.hasReplay || d.evidenceStatus!=='Complete') throw new Error('Evidence storage verification failed.');
    return d;
  }

  window.WECareCaptureEvidence = incident => {
    if(captureInFlight) return captureInFlight;
    captureInFlight=sendEvidence(incident).finally(()=>{captureInFlight=null});
    return captureInFlight;
  };
  window.WECareEvidenceRecorderStatus=()=>({rrweb:!!rrStop,events:rrEvents.length,timeline:timeline.length,startedAt});
})();
