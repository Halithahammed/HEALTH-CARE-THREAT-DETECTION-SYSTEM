(()=>{
  const token=sessionStorage.getItem('htd_token')||sessionStorage.getItem('doctorToken');
  const user=JSON.parse(sessionStorage.getItem('htd_user')||sessionStorage.getItem('doctorUser')||'{}');
  if(!token)return;
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
  const toast=document.getElementById('toast');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const say=m=>{toast.textContent=m;toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>toast.classList.remove('show'),2600)};

  const notice=document.getElementById('securityNoticeModal');
  const noticeCard=notice?.querySelector('.security-notice-card');
  const noticeTitle=document.getElementById('securityNoticeTitle');
  const noticeKicker=document.getElementById('securityNoticeKicker');
  const noticeMessage=document.getElementById('securityNoticeMessage');
  const noticeMeta=document.getElementById('securityNoticeMeta');
  const noticeIcon=document.getElementById('securityNoticeIcon');
  const noticePrimary=document.getElementById('securityNoticePrimary');
  const noticeActions=document.getElementById('securityNoticeActions');
  const closeNotice=()=>{notice?.classList.remove('open');notice?.setAttribute('aria-hidden','true')};
  document.getElementById('securityNoticeClose')?.addEventListener('click',closeNotice);
  notice?.addEventListener('click',e=>{if(e.target===notice)closeNotice()});

  function showNotice({title='Hospital Notification',kicker='WeCare',message='',level='normal',icon='i',meta=[],primaryText='Acknowledge',onPrimary=null,secondaryText='',onSecondary=null,lock=false}){
    if(!notice)return;
    noticeCard.classList.remove('warning','critical');
    if(level==='warning'||level==='critical')noticeCard.classList.add(level);
    noticeTitle.textContent=title;noticeKicker.textContent=kicker;noticeMessage.textContent=message;noticeIcon.textContent=icon;
    noticeMeta.innerHTML=meta.map(x=>`<div><strong>${esc(x.label)}</strong><span>${esc(x.value)}</span></div>`).join('');
    noticeActions.innerHTML='';
    if(secondaryText){const b=document.createElement('button');b.className='secondary-action';b.textContent=secondaryText;b.onclick=()=>{closeNotice();onSecondary?.()};noticeActions.appendChild(b)}
    const p=document.createElement('button');p.className=level==='critical'?'danger-action':'primary-action';p.textContent=primaryText;p.onclick=()=>{if(!lock)closeNotice();onPrimary?.()};noticeActions.appendChild(p);
    document.getElementById('securityNoticeClose').style.display=lock?'none':'';
    notice.classList.add('open');notice.setAttribute('aria-hidden','false');
  }

  const fmt=t=>{if(!t)return '--';const raw=/Z$|[+-]\d\d:\d\d$/.test(t)?t:t.replace(' ','T')+'Z';return new Date(raw).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})};
  async function messages(){const r=await fetch('/api/communication/messages',{headers});const d=await r.json();if(r.status===401||r.status===423){sessionStorage.clear();location.href='/doctor-login.html';throw Error(d.message||'Session ended')}if(!r.ok)throw Error(d.message||'Unable to load messages');return d.messages||[]}
  function updateBadge(list){const b=document.getElementById('securityMessageBadge');if(b)b.textContent=list.filter(x=>x.status==='Unread').length}
  async function renderSecurity(){
    const pageTitle=document.getElementById('pageTitle');
    const pageSubtitle=document.getElementById('pageSubtitle');
    if(pageTitle)pageTitle.textContent='Security Inbox';
    if(pageSubtitle)pageSubtitle.textContent='View messages addressed to you and contact hospital administration. You cannot self-approve security incidents.';
    const host=document.getElementById('sectionHost');
    const list=await messages();updateBadge(list);
    host.innerHTML=`<article class="panel"><div class="panel-heading"><div><p class="eyebrow">Personal security center</p><h3>Administrator messages</h3><p>Critical security decisions remain administrator-controlled.</p></div><button class="primary-action" id="doctorSupport">Contact Admin</button></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Category</th><th>Subject</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead><tbody>${list.map(m=>`<tr><td>${esc(fmt(m.created_at))}</td><td>${esc(m.category)}</td><td>${esc(m.subject)}</td><td>${esc(m.priority)}</td><td>${esc(m.status)}</td><td><button class="row-action" data-msg="${m.id}">Open</button></td></tr>`).join('')||'<tr><td colspan="6">No administrator messages.</td></tr>'}</tbody></table></div></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Protected action</p><h3>Bulk patient data export</h3><p>Export All is monitored as a high-impact action. A critical anomalous attempt is blocked before any file is produced.</p></div><button class="primary-action" id="exportAllRecords">Export All Patient Records</button></div><div class="notice"><strong>Insider-threat control:</strong> you cannot approve your own suspicious export, restore a restricted account, or delete the evidence.</div></article>`;
    document.getElementById('doctorSupport').onclick=sendSupport;
    document.getElementById('exportAllRecords').onclick=exportAll;
    host.querySelectorAll('[data-msg]').forEach(b=>b.onclick=async()=>{const m=list.find(x=>String(x.id)===String(b.dataset.msg));if(!m)return;await fetch('/api/communication/messages/'+m.id+'/read',{method:'POST',headers});showNotice({title:m.subject,kicker:`${m.priority} · ${m.category}`,message:m.body,level:String(m.priority).toLowerCase()==='critical'?'critical':String(m.priority).toLowerCase()==='high'?'warning':'normal',icon:String(m.priority).toLowerCase()==='critical'?'!':'i',meta:[{label:'From',value:'Hospital Administrator'},{label:'Status',value:'Read'}]});renderSecurity()});
  }
  async function sendSupport(){
    showNotice({title:'Contact Hospital Administration',kicker:'Secure support request',message:'Open the Security Inbox form to submit a support request. This action is fully audit logged.',icon:'?',primaryText:'Open Request Form',onPrimary:()=>{
      const subject=window.prompt('Support request subject','Security or access support request');if(!subject)return;
      const body=window.prompt('Describe the request','Please review my account activity.');if(!body)return;
      fetch('/api/communication/messages',{method:'POST',headers,body:JSON.stringify({recipientRole:'admin',subject,body,category:'Doctor Support Request',priority:'Normal'})}).then(async r=>{const d=await r.json();say(r.ok?'Request sent to administrator and audit logged.':d.message)});
    }});
  }
  async function exportAll(){
    showNotice({title:'Confirm Bulk Export Request',kicker:'Protected patient-data action',message:'You are requesting an export of all patient records. This action is continuously monitored and may trigger automatic containment when behavior is anomalous.',level:'warning',icon:'!',meta:[{label:'Requested records',value:'60,000'},{label:'Security control',value:'ML risk evaluation'}],primaryText:'Continue Export Request',secondaryText:'Cancel',onPrimary:async()=>{
      const r=await fetch('/api/communication/export-all',{method:'POST',headers,body:JSON.stringify({requestedCount:60000})});const d=await r.json();
      if(d.terminated){showNotice({title:'Account Restricted',kicker:'Critical insider-threat containment',message:d.message,level:'critical',icon:'×',meta:[{label:'Incident',value:`INC-${String(d.incidentId).padStart(4,'0')}`},{label:'Export result',value:'Blocked before file creation'}],primaryText:'Return to Login',lock:true,onPrimary:()=>{sessionStorage.clear();location.href='/doctor-login.html'}});return}
      say(d.message||'Export request processed');
    }});
  }
  async function popupLatest(){try{const list=await messages();updateBadge(list);const m=list.find(x=>x.status==='Unread');if(m&&!sessionStorage.getItem('shown_msg_'+m.id)){sessionStorage.setItem('shown_msg_'+m.id,'1');showNotice({title:m.subject,kicker:`${m.priority} · ${m.category}`,message:m.body,level:String(m.priority).toLowerCase()==='critical'?'critical':String(m.priority).toLowerCase()==='high'?'warning':'normal',icon:String(m.priority).toLowerCase()==='critical'?'!':'i',meta:[{label:'From',value:'Hospital Administrator'},{label:'Security policy',value:'No self-approval'}]})}}catch(_){} }
  const securityCenterButton=document.getElementById('securityCenterButton');
  const notificationButton=document.getElementById('notificationButton');
  if(securityCenterButton)securityCenterButton.onclick=()=>renderSecurity().catch(e=>say(e.message||'Unable to open Security Inbox'));
  if(notificationButton)notificationButton.onclick=()=>renderSecurity().catch(e=>say(e.message||'Unable to open Security Inbox'));
  try{const socket=io({auth:{userId:user.id}});socket.on('communication:new-message',m=>{if(m.recipient_doctor_id===user.doctorId||['doctor','all'].includes(m.recipient_role)){showNotice({title:m.subject,kicker:`${m.priority} · Hospital Administrator`,message:m.body,level:String(m.priority).toLowerCase()==='critical'?'critical':String(m.priority).toLowerCase()==='high'?'warning':'normal',icon:String(m.priority).toLowerCase()==='critical'?'!':'i'});popupLatest()}});socket.on('security:insider-contained',e=>{if(e.doctorId===user.doctorId){showNotice({title:'Account Restricted',kicker:'Critical insider-threat containment',message:e.response,level:'critical',icon:'×',meta:[{label:'Incident',value:`#${e.incidentId}`},{label:'Session',value:'Terminated'}],primaryText:'Return to Login',lock:true,onPrimary:()=>{sessionStorage.clear();location.href='/doctor-login.html'}})}})}catch(_){}
  popupLatest();
  setInterval(popupLatest,10000);
})();
