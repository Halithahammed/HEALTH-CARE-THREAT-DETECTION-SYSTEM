(()=>{
  const token = sessionStorage.getItem('htd_token');
  const headers = {'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = t => t ? new Date(/Z$|[+-]\d\d:\d\d$/.test(t) ? t : t.replace(' ','T')+'Z').toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}) : '--';
  const page = document.getElementById('page-soc');
  const nav = document.querySelector('[data-page="soc"]');

  async function api(url,opt={}){
    const r = await fetch(url,{...opt,headers:{...headers,...(opt.headers||{})}});
    const d = await r.json();
    if(!r.ok) throw Error(d.message||'Request failed');
    return d;
  }

  function riskText(r){
    const level = String(r||'Low').toLowerCase();
    return `<span class="soc-risk-wrap"><i class="soc-risk-dot ${esc(level)}" aria-hidden="true"></i><span class="soc-risk-text">${esc(r||'Low')}</span></span>`;
  }

  function renderTimeline(items){
    return (items||[]).map(x => `<div class="soc-event"><div><strong>${esc(x.action_type)}</strong><span>${esc(x.full_name||x.username||x.doctor_id||'System')}</span><small>${esc(x.reason||x.resource_type||'Security event')} · ${fmt(x.created_at)}</small></div>${riskText(x.risk_level)}</div>`).join('') || '<p>No security events yet.</p>';
  }

  function scatterPoints(predictions){
    return (predictions||[]).map((p,i)=>{
      let f={};
      try { f = JSON.parse(p.feature_vector||'{}') || {}; } catch(_e) { f={}; }
      const activity = Math.max(0, Number(f.records_viewed||0) + Number(f.downloads||0));
      const risk = Math.max(0, Math.min(100, Math.round(Number(p.anomaly_score||0)*100)));
      return {
        x:activity,
        y:risk,
        label:p.doctor_id || `Session ${i+1}`,
        riskLevel:p.risk_level || 'Low',
        prediction:p.prediction || '',
        time:p.created_at || ''
      };
    }).filter(p=>Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  function drawBehaviorScatter(predictions){
    const canvas = document.getElementById('behaviorScatter');
    if(!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(520, rect.width || 720);
    const h = 300;
    canvas.width = Math.round(w*dpr);
    canvas.height = Math.round(h*dpr);
    canvas.style.height = h+'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const pts = scatterPoints(predictions);
    const pad = {l:52,r:24,t:22,b:46};
    const cw = w-pad.l-pad.r;
    const ch = h-pad.t-pad.b;
    const maxX = Math.max(100,...pts.map(p=>p.x))*1.08;

    ctx.font='12px Inter';
    ctx.fillStyle='#667085';
    ctx.strokeStyle='#e5e7eb';
    ctx.lineWidth=1;
    for(let i=0;i<=5;i++){
      const y=pad.t+ch*i/5;
      ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
      ctx.fillText(String(100-i*20),10,y+4);
    }
    for(let i=0;i<=5;i++){
      const x=pad.l+cw*i/5;
      ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,h-pad.b);ctx.stroke();
      ctx.fillText(String(Math.round(maxX*i/5)),x-10,h-20);
    }

    ctx.fillStyle='#344054';
    ctx.fillText('Risk score',8,14);
    ctx.textAlign='center';
    ctx.fillText('Activity volume (records viewed + downloads)',pad.l+cw/2,h-3);
    ctx.textAlign='left';

    const colors={Low:'#22c55e',Medium:'#eab308',High:'#f97316',Critical:'#dc2626'};
    pts.forEach(p=>{
      const x=pad.l+(p.x/maxX)*cw;
      const y=pad.t+(1-p.y/100)*ch;
      ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);
      ctx.fillStyle=colors[p.riskLevel]||'#2457d6';ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
      p._px=x;p._py=y;
    });
    canvas._scatterPoints=pts;
  }

  function attachScatterTooltip(){
    const canvas=document.getElementById('behaviorScatter');
    const tip=document.getElementById('scatterTooltip');
    if(!canvas||!tip)return;
    canvas.onmousemove=e=>{
      const r=canvas.getBoundingClientRect();
      const mx=e.clientX-r.left, my=e.clientY-r.top;
      let hit=null, best=14;
      for(const p of (canvas._scatterPoints||[])){
        const d=Math.hypot(mx-p._px,my-p._py);
        if(d<best){best=d;hit=p;}
      }
      if(!hit){tip.hidden=true;return;}
      tip.hidden=false;
      tip.style.left=Math.max(6,Math.min(r.width-220,mx+12))+'px';
      tip.style.top=Math.max(6,my-60)+'px';
      tip.innerHTML=`<strong>${esc(hit.label)}</strong><span>Activity: ${hit.x}</span><span>Risk: ${hit.y}</span><span>${esc(hit.riskLevel)} · ${esc(hit.prediction)}</span>`;
    };
    canvas.onmouseleave=()=>{tip.hidden=true;};
  }

  async function load(){
    page.innerHTML='<div class="empty-module"><h2>Loading Security Center…</h2></div>';
    try{
      const [summary,preds] = await Promise.all([api('/api/ml/soc-summary'),api('/api/ml/predictions')]);
      const s=summary.summary||{};
      const predictionRows=(preds.predictions||[]).slice(0,12).map(x=>{
        let reasons=x.reasons;
        try { reasons=JSON.parse(x.reasons).join('; '); } catch(_e) {}
        return `<tr><td>${fmt(x.created_at)}</td><td>${esc(x.doctor_id)}</td><td>${Number(x.anomaly_score||0).toFixed(3)}</td><td>${esc(x.confidence)}%</td><td>${riskText(x.risk_level)}</td><td>${esc(x.prediction)}</td><td>${esc(reasons)}</td></tr>`;
      }).join('') || '<tr><td colspan="7">No AI predictions available.</td></tr>';

      page.innerHTML=`<div class="intro-row soc-actions-only"><div></div><div class="actions"><button class="button secondary" id="refreshSoc">Refresh</button></div></div>
        <article class="panel"><div class="panel-heading"><div><h3>Live threat timeline</h3></div></div><div class="soc-feed">${renderTimeline(s.events)}</div></article>
        <article class="panel"><div class="panel-heading"><div><h3>Behavior risk distribution</h3></div></div><div class="scatter-wrap"><canvas id="behaviorScatter" height="300" aria-label="Behavior risk distribution scatter plot"></canvas><div id="scatterTooltip" class="scatter-tooltip" hidden></div></div></article>
        <article class="panel"><div class="panel-heading"><div><h3>Recent AI predictions</h3></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Doctor</th><th>Anomaly score</th><th>Confidence</th><th>Risk</th><th>Prediction</th><th>Reasons</th></tr></thead><tbody>${predictionRows}</tbody></table></div></article>`;
      document.getElementById('refreshSoc')?.addEventListener('click',load);
      requestAnimationFrame(()=>{drawBehaviorScatter(preds.predictions||[]);attachScatterTooltip();});
    }catch(e){
      page.innerHTML=`<div class="empty-module"><h2>Unable to load Security Center</h2><p>${esc(e.message)}</p><button class="button" id="retrySoc">Retry</button></div>`;
      document.getElementById('retrySoc')?.addEventListener('click',load);
    }
  }

  nav?.addEventListener('click',()=>setTimeout(load,30));
  try{
    const socket=io();
    socket.on('ml:prediction',()=>nav?.classList.add('has-alert'));
    socket.on('security:insider-contained',()=>{nav?.classList.add('has-alert');if(page.classList.contains('active'))load();});
  }catch(_e){}
})();
