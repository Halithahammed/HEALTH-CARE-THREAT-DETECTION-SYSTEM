(function(){
  const scenarios=[
    {id:'arjun-export',doctor:'Dr. Arjun Kumar',risk:'Critical',summary:'Bulk export attempt blocked',response:'Export blocked; administrator alert opened',events:[
      ['09:58 AM','Login','Signed in from Cardiology workstation','Allowed'],
      ['10:11 AM','Patient reports','Opened a large set of patient reports','Observed'],
      ['10:26 AM','Selection','Selected records across reports and scans','High'],
      ['10:32 AM','Export','Bulk export requested','Blocked'],
      ['10:32 AM','Security','Critical incident created and evidence capture triggered','Critical']
    ]},
    {id:'rahul-access',doctor:'Dr. Rahul Nair',risk:'High',summary:'After-hours access from an unfamiliar device',response:'Session restricted; administrator review opened',events:[
      ['02:14 AM','Login','Unknown IP and unfamiliar device','High'],
      ['02:16 AM','Scan reports','Viewed unusually large scan-report set','High'],
      ['02:18 AM','Patient reports','Cross-department report access detected','High'],
      ['02:19 AM','Security','Session restricted for review','High']
    ]},
    {id:'priya-credential',doctor:'Dr. Priya Sharma',risk:'Critical',summary:'Credential anomaly and repeated failed authentication',response:'Login blocked; administrator review required',events:[
      ['01:41 AM','Authentication','Repeated failed password attempts','High'],
      ['01:46 AM','Login','Successful login from unfamiliar IP','Critical'],
      ['01:47 AM','Session','Rapid logout and re-login sequence','Critical'],
      ['01:48 AM','Security','Account access blocked for review','Critical']
    ]},
    {id:'meera-normal',doctor:'Dr. Meera Joseph',risk:'Low',summary:'Normal access pattern',response:'Allowed',events:[
      ['09:02 AM','Login','Trusted radiology workstation','Allowed'],
      ['09:18 AM','Scan reports','Reviewed assigned scan reports','Allowed'],
      ['12:25 PM','Patient reports','Viewed assigned patient reports','Allowed'],
      ['05:04 PM','Logout','Normal end-of-shift logout','Allowed']
    ]}
  ];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected=scenarios[0];

  function timeline(s){
    return `<div class="threat-time-template">${s.events.map((e,i)=>`<div class="threat-time-node"><div class="threat-time-label">${esc(e[0])}</div><div class="threat-time-dot"></div><div class="threat-time-line"></div><strong>${esc(e[1])}</strong><span>${esc(e[2])}</span><small>${esc(e[3])}</small></div>`).join('')}</div>`;
  }
  function card(s){
    return `<button type="button" class="threat-doctor-card ${selected.id===s.id?'active':''}" data-threat-doctor="${esc(s.id)}"><strong>${esc(s.doctor)}</strong><span>${esc(s.risk)}</span><small>${esc(s.summary)}</small></button>`;
  }
  function renderSelected(){
    const host=document.getElementById('selectedDoctorThreat'); if(!host)return;
    host.innerHTML=`<div class="selected-threat-head"><div><strong>${esc(selected.doctor)}</strong><span>${esc(selected.risk)} · ${esc(selected.summary)}</span></div><button type="button" class="button secondary" id="downloadThreatReport">Download</button></div>${timeline(selected)}`;
    document.getElementById('downloadThreatReport')?.addEventListener('click',downloadSelected);
    document.querySelectorAll('[data-threat-doctor]').forEach(b=>b.classList.toggle('active',b.dataset.threatDoctor===selected.id));
  }
  function downloadSelected(){
    const lines=[
      'WeCare - Threat Activity Report','',
      `Doctor: ${selected.doctor}`,
      `Risk: ${selected.risk}`,
      `Detected activity: ${selected.summary}`,
      `System response: ${selected.response}`,'','Timeline:'
    ];
    selected.events.forEach(e=>lines.push(`${e[0]} | ${e[1]} | ${e[2]} | ${e[3]}`));
    const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=selected.doctor.replace(/[^a-z0-9]+/gi,'_')+'_threat_report.txt'; a.click(); URL.revokeObjectURL(a.href);
  }
  function buildThreats(){
    const el=document.getElementById('page-threats'); if(!el)return;
    el.innerHTML=`<div class="intro-row"><div><h2>Threat Monitoring</h2></div></div>
      <article class="panel threat-profile-panel"><div class="panel-heading"><div><h3>Profile</h3></div></div>
        <div class="threat-doctor-grid">${scenarios.map(card).join('')}</div>
      </article>
      <article class="panel" id="selectedDoctorThreat"></article>`;
    el.querySelectorAll('[data-threat-doctor]').forEach(b=>b.addEventListener('click',()=>{selected=scenarios.find(s=>s.id===b.dataset.threatDoctor)||scenarios[0];renderSelected()}));
    renderSelected();
  }
  function normalizeBloodGroups(){document.querySelectorAll('.rare-blood').forEach(x=>x.classList.remove('rare-blood'))}
  function init(){buildThreats();normalizeBloodGroups()}
  setTimeout(init,220);
  const obs=new MutationObserver(()=>normalizeBloodGroups()); obs.observe(document.body,{subtree:true,childList:true});
})();
