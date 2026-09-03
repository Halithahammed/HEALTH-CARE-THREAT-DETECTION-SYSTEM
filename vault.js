let incidents=[];const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function displayUser(x){if(x.role==='admin')return 'Admin';if(x.role==='doctor')return x.full_name||'Doctor';if(x.role==='reception')return 'Reception Staff';if(x.role==='laboratory')return 'Laboratory Staff';return x.full_name||x.username||String(x.role||'Staff')}
function displayRole(r){return String(r||'Staff').replace(/^./,c=>c.toUpperCase())}
function evidenceDate(v){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number')return new Date(v);
  const raw=String(v).trim();
  // SQLite CURRENT_TIMESTAMP / datetime('now') values are UTC but do not
  // include a timezone suffix. Treat those naive database timestamps as UTC.
  const sqliteUtc=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw);
  const normalized=sqliteUtc?raw.replace(' ','T')+'Z':raw;
  const d=new Date(normalized);
  return Number.isNaN(d.getTime())?null:d;
}
function when(v){try{const d=evidenceDate(v);return d?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'medium'}).format(d):(v||'-')}catch(_){return v||'-'}}
async function load(){const d=await fetch('/api/incidents').then(r=>r.json());incidents=d.incidents||[];render();const code=new URLSearchParams(location.search).get('incident');if(code)openIncident(code)}
function render(){const q=$('search').value.toLowerCase(),risk=$('risk').value;const rows=incidents.filter(x=>(risk==='All risk'||x.risk_level===risk)&&[displayUser(x),x.role,x.action_type,x.risk_level,x.created_at].join(' ').toLowerCase().includes(q));$('rows').innerHTML=rows.map(x=>`<tr><td>${esc(displayUser(x))}</td><td>${esc(displayRole(x.role))}</td><td>${esc(x.action_type||'-')}</td><td>${esc(x.risk_level)}</td><td>${esc(when(x.created_at))}</td><td><button onclick="openIncident('${esc(x.incident_code)}')">View</button></td></tr>`).join('')||'<tr><td colspan="6">No High/Critical evidence stored.</td></tr>'}
async function openIncident(code){const d=await fetch('/api/incidents/'+encodeURIComponent(code)).then(r=>r.json()),x=d.incident;if(!x)return;const ds=d.dismissals||[];$('details').hidden=false;$('details').innerHTML=`<h2>Evidence</h2><div class="details-grid"><div><span>User</span><strong>${esc(displayUser(x))}</strong></div><div><span>Role</span><strong>${esc(displayRole(x.role))}</strong></div><div><span>Action</span><strong>${esc(x.action_type||'-')}</strong></div><div><span>Risk</span><strong>${esc(x.risk_level)}</strong></div><div><span>Date / Time</span><strong>${esc(when(x.created_at))}</strong></div><div><span>Evidence status</span><strong>${esc(x.evidence_status||'Stored')}</strong></div>${x.related_incident_code?`<div><span>Related incident</span><strong>${esc(x.related_incident_code)}</strong></div>`:''}${Number(x.dismissal_count||0)>0?`<div><span>Alert dismissals</span><strong>${esc(x.dismissal_count)}</strong></div><div><span>Admin acknowledgement</span><strong>${esc(x.acknowledgement_status||'Pending')}</strong></div><div><span>Escalation</span><strong>${esc(x.escalation_status||'None')}</strong></div>`:''}</div>${ds.length?`<div class="timeline"><h3>Admin dismissal history</h3>${ds.map((a,i)=>`<div><strong>Dismissal ${i+1}</strong><br><small>${esc(when(a.dismissed_at))}</small></div>`).join('')}</div>`:''}<div class="evidence-actions"><button onclick="showScreenshot('${code}')">View Screenshot</button><button onclick="playRecording('${code}')">Play Recording</button><button onclick="showTimeline('${code}')">Timeline</button></div><div id="viewer" class="viewer">Select evidence to view.</div>`;$('details').scrollIntoView({behavior:'smooth'})}
async function getFile(code,name,type='json'){const r=await fetch(`/api/incidents/${encodeURIComponent(code)}/file/${name}`);if(!r.ok)throw Error(`${name} unavailable`);if(type==='text')return r.text();if(type==='blob')return r.blob();return r.json()}
async function showScreenshot(code){const v=$('viewer');for(const n of ['screenshot.png','screenshot.jpg']){try{const b=await getFile(code,n,'blob');const url=URL.createObjectURL(b);v.innerHTML=`<div class="shot-shell"><img src="${url}" alt="Incident screenshot"></div><p>Exact application snapshot captured at the incident.</p>`;return}catch(_){}}v.textContent='Screenshot unavailable for this incident.'}
async function showTimeline(code){try{const a=await getFile(code,'timeline.json');$('viewer').innerHTML=`<div class="timeline">${a.map(e=>`<div><strong>${esc(e.label||e.type||'Event')}</strong><br><small>${esc(when(e.time||e.timestamp))}</small></div>`).join('')}</div>`}catch(e){$('viewer').textContent=e.message}}
async function playRecording(code){
  const v=$('viewer');v.innerHTML='<p>Loading recorded WeCare session…</p>';
  try{
    const events=await getFile(code,'replay.json');
    if(!Array.isArray(events)||events.length<2)throw Error('Session recording is empty');
    function resolvePlayerConstructor(){
      const roots=[window.rrwebPlayer,window.RRWebPlayer];
      for(const root of roots){
        if(typeof root==='function')return root;
        if(root&&typeof root==='object'){
          for(const key of ['default','Player','RRWebPlayer','rrwebPlayer']){
            if(typeof root[key]==='function')return root[key];
          }
        }
      }
      return null;
    }
    const Player=resolvePlayerConstructor();
    if(!Player){
      const a=window.rrwebPlayer&&typeof window.rrwebPlayer==='object'?Object.keys(window.rrwebPlayer).join(', '):typeof window.rrwebPlayer;
      const b=window.RRWebPlayer&&typeof window.RRWebPlayer==='object'?Object.keys(window.RRWebPlayer).join(', '):typeof window.RRWebPlayer;
      throw Error(`Session player library did not expose a usable constructor (rrwebPlayer: ${a||'missing'}; RRWebPlayer: ${b||'missing'}).`);
    }
    v.innerHTML='<div id="rrwebRecording" class="rrweb-recording"></div><p>Recorded WeCare application session. Mouse movement and clicks are reconstructed from recorded events.</p>';
    const target=document.getElementById('rrwebRecording');
    const width=Math.max(720,Math.min(1200,target.clientWidth||1000));
    new Player({target,props:{events,autoPlay:true,width,height:Math.round(width*0.62),showController:true,skipInactive:false,mouseTail:false}});
  }catch(e){v.textContent='Recording unavailable: '+e.message}
}
$('refresh').onclick=load;$('search').oninput=render;$('risk').onchange=render;load();
