(() => {
  const token=sessionStorage.getItem('htd_token');
  const auth={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const toast=document.getElementById('toast');
  const say=m=>{toast.textContent=m;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2600)};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const doctors = (()=>{try{return doctorSeed||[]}catch(_){return []}})();

  const page=document.getElementById('page-communication');
  if(page) page.innerHTML=`
    <div class="intro-row"><div><h2>Secure Communication Center</h2><p>Send security notices and hospital messages. Suspected insiders cannot approve or clear their own incidents.</p></div><button class="button" id="refreshComms">Refresh</button></div>
    <div class="dashboard-grid"><article class="panel"><h3>Send message to doctor</h3><div class="settings-form">
      <div class="field"><label>Doctor ID</label><input id="commDoctorId" value="DOC001" placeholder="DOC001"></div>
      <div class="field"><label>Category</label><select id="commCategory"><option>Security Notice</option><option>Account Restriction</option><option>Hospital Announcement</option><option>Investigation Update</option><option>Maintenance</option></select></div>
      <div class="field"><label>Priority</label><select id="commPriority"><option>Normal</option><option>High</option><option>Critical</option></select></div>
      <div class="field"><label>Subject</label><input id="commSubject" value="Security notice from WeCare Administration"></div>
      <div class="field full"><label>Message</label><textarea id="commBody" rows="5">Please review this administrative security notice. Critical insider-threat incidents remain under administrator control and cannot be self-approved.</textarea></div>
      <button class="button" id="sendDoctorMessage">Send live popup</button>
    </div></article><article class="panel"><h3>Communication policy</h3><div class="notice"><strong>No mobile approval:</strong> all mobile verification controls have been removed.</div><p>Doctors can receive notices, acknowledge messages, and submit support requests. They cannot approve high-risk activity, remove restrictions, restore sessions, or close incidents.</p><dl class="detail-list"><div><dt>Low-risk notice</dt><dd>Doctor may acknowledge</dd></div><div><dt>High/Critical incident</dt><dd>Admin-only decision</dd></div><div><dt>Insider containment</dt><dd>Immediate termination and evidence preservation</dd></div></dl></article></div>
    <article class="panel"><div class="panel-heading"><div><h3>Message history</h3><p>Read status and audit-linked communications.</p></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>From</th><th>To</th><th>Category</th><th>Subject</th><th>Priority</th><th>Status</th></tr></thead><tbody id="commRows"></tbody></table></div></article>`;

  async function loadMessages(){
    const r=await fetch('/api/communication/messages',{headers:auth}); const d=await r.json();
    const rows=document.getElementById('commRows'); if(!rows)return;
    rows.innerHTML=(d.messages||[]).map(m=>`<tr><td>${esc(new Date(m.created_at+'Z').toLocaleString())}</td><td>${esc(m.sender_name)}</td><td>${esc(m.recipient_doctor_id||m.recipient_role||'Admin')}</td><td>${esc(m.category)}</td><td>${esc(m.subject)}</td><td><span class="badge ${String(m.priority).toLowerCase()}">${esc(m.priority)}</span></td><td>${esc(m.status)}</td></tr>`).join('')||'<tr><td colspan="7">No messages yet.</td></tr>';
  }
  async function send(){
    const payload={recipientDoctorId:document.getElementById('commDoctorId').value.trim(),recipientRole:'doctor',category:document.getElementById('commCategory').value,priority:document.getElementById('commPriority').value,subject:document.getElementById('commSubject').value.trim(),body:document.getElementById('commBody').value.trim()};
    const r=await fetch('/api/communication/messages',{method:'POST',headers:auth,body:JSON.stringify(payload)}); const d=await r.json();
    if(!r.ok)return say(d.message||'Message failed'); say('Live doctor popup sent and audit logged.'); loadMessages();
  }
  document.getElementById('sendDoctorMessage')?.addEventListener('click',send);
  document.getElementById('refreshComms')?.addEventListener('click',loadMessages);
  document.querySelector('[data-page="communication"]')?.addEventListener('click',loadMessages);

  // Replace old mobile/self-approval verification page with admin-only investigation controls.
  const verification=document.getElementById('page-verification');
  if(verification) verification.innerHTML=`<div class="intro-row"><div><h2>Administrator Investigation Queue</h2><p>High-risk and critical users cannot verify themselves. Only authorized administrators may restore access.</p></div></div><div class="notice"><strong>Containment policy:</strong> Critical bulk export, cross-department harvesting, or highly anomalous access immediately blocks the operation, terminates the session, restricts the account, and creates a report.</div><article class="panel"><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Trigger</th><th>Risk</th><th>Containment</th><th>Decision owner</th></tr></thead><tbody><tr><td>Dr. Sanjay Kumar</td><td>Export All + cross-department access</td><td><span class="badge critical">Critical</span></td><td>Export blocked; session terminated</td><td>Security Administrator</td></tr><tr><td>Dr. Meena Ravi</td><td>Unusual record volume</td><td><span class="badge high">High</span></td><td>Sensitive access restricted</td><td>Security Administrator</td></tr></tbody></table></div></article>`;

  // Add real backend audit/incidents to existing audit page when selected.
  async function buildLiveAudit(){
    const el=document.getElementById('page-audit'); if(!el)return;
    const [a,i,r]=await Promise.all([fetch('/api/admin/activities',{headers:auth}).then(x=>x.json()),fetch('/api/admin/incidents',{headers:auth}).then(x=>x.json()),fetch('/api/admin/investigation-reports',{headers:auth}).then(x=>x.json())]);
    el.innerHTML=`<div class="intro-row"><div><h2>Working Audit Logs</h2><p>Backend-recorded evidence across communication, exports, authentication, and containment.</p></div><button class="button" id="auditRefresh">Refresh</button></div><div class="metric-grid four"><article class="metric-card"><div class="metric-label">Audit events</div><div class="metric-value">${(a.activities||[]).length}</div></article><article class="metric-card"><div class="metric-label">Incidents</div><div class="metric-value">${(i.incidents||[]).length}</div></article><article class="metric-card"><div class="metric-label">Reports</div><div class="metric-value">${(r.reports||[]).length}</div></article><article class="metric-card"><div class="metric-label">Mobile approvals</div><div class="metric-value">0</div></article></div><article class="panel"><div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Module</th><th>Action</th><th>Target</th><th>Risk</th><th>Reason</th></tr></thead><tbody>${(a.activities||[]).map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.full_name||x.username)}</td><td>${esc(x.resource_type)}</td><td>${esc(x.action_type)}</td><td>${esc(x.resource_id)}</td><td>${esc(x.risk_level)}</td><td>${esc(x.reason)}</td></tr>`).join('')||'<tr><td colspan="7">No backend audit events yet.</td></tr>'}</tbody></table></div></article><article class="panel"><h3>Investigation reports</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>Doctor</th><th>Title</th><th>Classification</th><th>Risk</th><th>Created</th></tr></thead><tbody>${(r.reports||[]).map(x=>`<tr><td>RPT-${x.id}</td><td>${esc(x.full_name||x.doctor_id)}</td><td>${esc(x.title)}</td><td>${esc(x.classification)}</td><td>${esc(x.risk_score)}</td><td>${esc(x.created_at)}</td></tr>`).join('')||'<tr><td colspan="6">Reports are generated automatically after critical containment.</td></tr>'}</tbody></table></div></article>`;
    document.getElementById('auditRefresh')?.addEventListener('click',buildLiveAudit);
  }
  document.querySelector('[data-page="audit"]')?.addEventListener('click',()=>setTimeout(buildLiveAudit,30));

  try { const socket=io(); socket.on('communication:new-message',loadMessages); socket.on('security:insider-contained',e=>say(`CRITICAL: ${e.doctor} contained. Incident #${e.incidentId}`)); } catch(_){}
  loadMessages().catch(()=>{});
})();
