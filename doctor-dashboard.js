(function(){
  const token=sessionStorage.getItem('htd_token');
  if(!token){location.href='/doctor-login.html';return;}
  const TOTAL=6000, PAGE=50;
  const host=document.getElementById('sectionHost');
  const selected={schedule:new Set(),reports:new Set(),labs:new Set(),scans:new Set(),records:new Set()};
  const selectionMode={schedule:false,reports:false,labs:false,scans:false,records:false};
  let active='schedule', page=0, menuIndex=null;
  const names=['Aarav Kumar','Ananya Nair','Arjun Rao','Diya Sharma','Ishaan Patel','Kavya Iyer','Meera Singh','Rohan Das','Sanjay Menon','Zoya Khan','Vikram Reddy','Priya Verma','Rahul Nair','Neha Gupta','Karthik Rao'];
  const diagnoses=['Hypertension','Coronary Artery Disease','Stable Angina','Atrial Fibrillation','Dyslipidemia','Post-MI Follow-up'];
  const labs=['Troponin I','Lipid Profile','HbA1c','NT-proBNP','Electrolytes','Renal Function'];
  const scans=['CT Abdomen','CT Brain','CT Chest','CT KUB','CT KUB','USG Abdomen & Pelvis'];
  const scanReportImages=[
    '/assets/scan-reports/ct-abdomen.png',
    '/assets/scan-reports/ct-brain.png',
    '/assets/scan-reports/ct-chest.png',
    '/assets/scan-reports/ct-kub.png',
    '/assets/scan-reports/ct-kub-text.png',
    '/assets/scan-reports/usg-abdomen-pelvis.png'
  ];
  const fivePageScanReport={
    scan:'Cardiac Report',
    patient:'Abby Normal',
    age:58,
    blood:'—',
    date:'2022-08-29',
    finding:'Complete five-page cardiac imaging report',
    reportImages:['/assets/scan-reports/cardiac-five-page-report-1.png', '/assets/scan-reports/cardiac-five-page-report-2.png', '/assets/scan-reports/cardiac-five-page-report-3.png', '/assets/scan-reports/cardiac-five-page-report-4.png', '/assets/scan-reports/cardiac-five-page-report-5.png']
  };
  const totalFor=section=>section==='scans'?TOTAL+1:TOTAL;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function showCriticalRestrictionModal({title,message,incidentId}){
    return new Promise(resolve=>{
      document.getElementById('wecareCriticalRestriction')?.remove();
      const overlay=document.createElement('div');
      overlay.id='wecareCriticalRestriction';
      overlay.className='critical-restriction-overlay';
      const code=incidentId?`INC-${String(incidentId).padStart(5,'0')}`:'';
      overlay.innerHTML=`<div class="critical-restriction-card" role="dialog" aria-modal="true"><h2>${esc(title||'Security review required')}</h2><p>${esc(message||'Your session has been restricted.')}</p>${code?`<div class="critical-restriction-code">Incident: <strong>${esc(code)}</strong></div>`:''}<button type="button" id="criticalRestrictionContinue">Return to Login</button></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#criticalRestrictionContinue').addEventListener('click',()=>{overlay.remove();resolve();},{once:true});
    });
  }

  window.showDoctorExportComplete=function(auth){
    document.getElementById('doctorExportComplete')?.remove();
    const box=document.createElement('div');box.id='doctorExportComplete';box.className='doctor-export-complete';
    const count=Number(auth?.records||1);box.innerHTML=`<div class="doctor-export-complete-card"><strong>Export completed</strong><p>${count} selected record${count===1?' was':'s were'} exported after authorization. The reason was logged.</p><button type="button">OK</button></div>`;
    document.body.appendChild(box);box.querySelector('button').onclick=()=>box.remove();
  };
  const dt=i=>new Date(Date.now()-(i%180)*86400000).toISOString().slice(0,10);
  function row(section,i){
    const name=names[i%names.length], age=24+(i%61), blood=['A+','B+','O+','AB+','A-','B-','O-'][i%7];
    if(section==='schedule')return {date:dt(i),time:`${String(8+(i%9)).padStart(2,'0')}:${i%2?'30':'00'} ${8+(i%9)<12?'AM':'PM'}`,patient:name,age,blood,status:['Scheduled','Checked In','Completed'][i%3],notes:['Cardiology review','Medication review','Follow-up'][i%3]};
    if(section==='reports')return {report:`Cardiology Report ${i+1}`,patient:name,age,blood,type:['Consultation','Follow-up','Discharge Summary'][i%3],date:dt(i),result:['Reviewed','Final'][i%2]};
    if(section==='labs')return {test:labs[i%labs.length],patient:name,age,blood,result:['Within range','Review advised','Stable'][i%3],date:dt(i)};
    if(section==='scans'){
      if(i===0)return {...fivePageScanReport};
      const scanIndex=i-1,scanName=names[scanIndex%names.length],scanAge=24+(scanIndex%61),scanBlood=['A+','B+','O+','AB+','A-','B-','O-'][scanIndex%7];
      return {scan:scans[scanIndex%scans.length],patient:(scanIndex===1?'Yasiv M. Patel':scanName),age:scanAge,blood:scanBlood,date:dt(scanIndex),finding:['No acute abnormality','Stable findings','Follow-up advised'][scanIndex%3],reportImage:scanReportImages[scanIndex%scanReportImages.length]};
    }
    return {patient:name,age,blood,diagnosis:diagnoses[i%diagnoses.length],medication:['Atorvastatin 20 mg','Amlodipine 5 mg','Metoprolol 25 mg'][i%3],updated:dt(i)};
  }
  const cfg={
    schedule:{cols:['Date','Time','Patient','Age','Blood Group','Status','Notes'],keys:['date','time','patient','age','blood','status','notes']},
    reports:{cols:['Report','Patient','Age','Blood Group','Type','Date','Result'],keys:['report','patient','age','blood','type','date','result']},
    labs:{cols:['Test','Patient','Age','Blood Group','Result','Date'],keys:['test','patient','age','blood','result','date']},
    scans:{cols:['Scan Type','Patient','Age','Blood Group','Date','Finding'],keys:['scan','patient','age','blood','date','finding']},
    records:{cols:['Patient','Age','Blood Group','Diagnosis','Medication','Last Updated'],keys:['patient','age','blood','diagnosis','medication','updated']}
  };
  function render(section=active){
    active=section; menuIndex=null;
    document.querySelectorAll('.nav-link[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===section));
    const sectionTotal=totalFor(section);
    const start=page*PAGE, rows=Array.from({length:Math.min(PAGE,sectionTotal-start)},(_,j)=>({idx:start+j,data:row(section,start+j)}));
    const c=cfg[section];
    const allSelected=selected[section].size===sectionTotal;
    const selecting=selectionMode[section];
    host.innerHTML=`<article class="panel clean-clinical">${selecting?`<div class="selection-mode-tab" role="toolbar" aria-label="Record selection"><label class="selection-master"><input id="masterSelect" class="plain-check" type="checkbox" ${allSelected?'checked':''}><span>Select all</span></label><span class="selection-count">${selected[section].size.toLocaleString('en-IN')} selected</span><span class="selection-flex"></span><button class="primary-action selection-export" id="exportRows" type="button">Export</button><button type="button" class="selection-done" id="exitSelection">Done</button></div>`:`<div class="table-controls"><button class="primary-action export-only" id="exportRows" type="button">Export</button></div>`}<div class="table-wrap"><table><thead><tr>${selecting?'<th class="selection-space"><span class="selection-head-label">Select</span></th>':''}${c.cols.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(({idx,data})=>`<tr data-row="${idx}" class="${selected[section].has(idx)?'row-selected':''}">${selecting?`<td class="selection-space"><input class="row-select-check plain-check" type="checkbox" data-select-row="${idx}" ${selected[section].has(idx)?'checked':''} aria-label="Select this record"></td>`:''}${c.keys.map(k=>`<td>${esc(data[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="pager"><button class="secondary-action" id="prevPage" ${page===0?'disabled':''}>Previous</button><button class="secondary-action" id="nextPage" ${start+PAGE>=sectionTotal?'disabled':''}>Next</button></div><div id="rowMenu" class="row-menu" hidden><button data-menu="add">Add</button><button data-menu="view">View</button><button data-menu="select">Select</button><button data-menu="delete">Delete</button></div></article>`;
  }
  function openDetails(idx){
    const r=row(active,idx);
    if(active==='scans' && (r.reportImage||r.reportImages)){
      const viewer=document.getElementById('reportViewer');
      const title=document.getElementById('reportViewerTitle');
      const meta=document.getElementById('reportMeta');
      const stage=viewer?.querySelector('.report-stage');
      if(title) title.textContent=r.scan+' — '+r.patient;
      if(meta) meta.innerHTML=`<strong>${esc(r.patient)}</strong><span>${esc(r.scan)}</span><span>${esc(r.date)}</span><span>${esc(r.finding)}</span>`;

      if(stage){
        if(Array.isArray(r.reportImages)){
          stage.style.display='grid';
          stage.style.gap='18px';
          stage.style.maxHeight='72vh';
          stage.style.overflowY='auto';
          stage.style.alignItems='start';
          stage.innerHTML=r.reportImages.map((src,i)=>`<img src="${esc(src)}" alt="${esc(r.scan)} page ${i+1}" style="display:block;width:min(100%,980px);height:auto;max-height:none;margin:0 auto;background:#fff">`).join('');
        }else{
          stage.style.display='';
          stage.style.gap='';
          stage.style.maxHeight='';
          stage.style.overflowY='';
          stage.style.alignItems='';
          stage.innerHTML=`<img id="reportImage" src="${esc(r.reportImage)}" alt="${esc(r.scan+' report for '+r.patient)}">`;
        }
      }

      if(viewer){viewer.classList.add('open');viewer.setAttribute('aria-hidden','false');}
      return;
    }
    alert(Object.entries(r).filter(([k])=>!['reportImage','reportImages'].includes(k)).map(([k,v])=>`${k.replace(/([A-Z])/g,' $1')}: ${v}`).join('\n'));
  }
  function addRecord(){alert('Add record form can be connected to the existing backend in the next enhancement.');}
  function showBatchExportStatus(title,message,request,approved=false){
    document.getElementById('doctorBatchExportStatus')?.remove();
    const box=document.createElement('div');box.id='doctorBatchExportStatus';box.className='doctor-export-complete';
    const requestId=request?.requestId||request?.request_id||'';
    const recordCount=Number(request?.records||request?.record_count||0);
    const decidedBy=request?.decidedBy||request?.decided_by||'';
    const decisionTime=request?.time||request?.decided_at||'';
    const status=request?.status||(approved?'Approved':'');
    const rejectionReason=request?.rejectionReason||request?.rejection_reason||'';
    const formattedTime=decisionTime?new Date(String(decisionTime).includes('T')?decisionTime:String(decisionTime).replace(' ','T')+'Z').toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';

    box.innerHTML=`<div class="doctor-export-complete-card doctor-export-decision-card ${approved?'approved':'rejected'}">
      <div class="doctor-export-decision-heading">
        <strong>${esc(title)}</strong>
        ${status?`<span class="doctor-export-decision-status">${esc(status)}</span>`:''}
      </div>
      <p>${esc(message)}</p>
      <div class="doctor-export-decision-grid">
        ${requestId?`<div><span>Request ID</span><b>${esc(requestId)}</b></div>`:''}
        ${recordCount?`<div><span>Records</span><b>${recordCount}</b></div>`:''}
        ${decidedBy?`<div><span>Decision by</span><b>${esc(decidedBy)}</b></div>`:''}
        ${formattedTime?`<div><span>Decision time</span><b>${esc(formattedTime)}</b></div>`:''}
      </div>
      ${!approved&&rejectionReason?`<div class="doctor-export-rejection"><span>Rejection reason</span><p>${esc(rejectionReason)}</p></div>`:''}
      <div class="doctor-export-decision-actions">
        ${approved?`<button type="button" class="doctor-approved-download" data-batch-download="${Number(request.id||request.rowId||0)}">Download Approved Export</button>`:''}
        <button type="button" class="doctor-decision-close" data-batch-close>OK</button>
      </div>
    </div>`;

    document.body.appendChild(box);
    box.querySelector('[data-batch-close]').onclick=()=>box.remove();

    const download=box.querySelector('[data-batch-download]');
    if(download)download.onclick=async()=>{
      const id=Number(download.dataset.batchDownload);
      download.disabled=true;
      try{
        const res=await fetch(`/api/communication/batch-export-requests/${id}/download`,{headers:{Authorization:'Bearer '+token}});
        if(!res.ok){
          const x=await res.json().catch(()=>({}));
          throw new Error(x.message||'Unable to download approved export');
        }
        const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;
        a.download=(res.headers.get('Content-Disposition')||'').match(/filename=\?"?([^";]+)/i)?.[1]||`wecare-approved-export-${id}.csv`;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        box.remove();
      }catch(err){
        alert(err.message);
        download.disabled=false;
      }
    };
  }

  function requestMediumBatchApproval(ids,c,data,policy={}){
    const reasons=['Diagnosis / Treatment','Continuity of Patient Care','Patient Handover / Department Transfer','Specialist / Referral','Clinical Audit','Approved Medical Research','Regulatory / Legal Requirement','Patient Request','Other'];
    const repeated=policy.trigger==='repeated_small_exports';
    const cumulative=policy.trigger==='cumulative_records';
    const title=(repeated||cumulative)?'Additional Export Approval Required':'Medium-Risk Export Approval';
    const risk=policy.risk||'Medium';
    const help=(repeated||cumulative)
      ?`${policy.message||'Recent export activity requires Administrator approval.'} Select a reason and explain why additional records are required.`
      :'This export requires Administrator approval before any file is generated. Select a reason and explain why these records are required.';
    const overlay=document.createElement('div');overlay.className='export-auth-overlay';
    overlay.innerHTML=`<div class="export-auth-modal" role="dialog" aria-modal="true" aria-labelledby="batchExportAuthTitle"><div class="export-auth-header"><h3 id="batchExportAuthTitle">${esc(title)}</h3></div><div class="export-auth-meta"><div><span class="export-meta-label">Selected records</span><strong>${ids.length}</strong></div><div><span class="export-meta-label">Risk</span><strong>${esc(risk)}</strong></div></div>${(repeated||cumulative)?`<div style="margin:0 0 14px;padding:11px 12px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;color:#92400e;font-size:13px;line-height:1.5"><strong>Recent activity:</strong> ${Number(policy.recentTransactionCount||0)} transaction(s), ${Number(policy.recentRecordCount||0)} record(s) exported in the last 7 days.</div>`:''}<p class="export-auth-help">${esc(help)}</p><div class="export-reasons">${reasons.map(x=>`<label class="export-reason-row"><input type="checkbox" name="batchExportReason" value="${esc(x)}"><span>${esc(x)}</span></label>`).join('')}</div><textarea id="batchOtherReason" placeholder="Explain the Other reason" hidden></textarea><textarea id="batchExportPurpose" placeholder="Purpose / explanation for exporting ${ids.length} record${ids.length===1?'':'s'}" maxlength="600"></textarea><div class="export-auth-actions"><button type="button" id="cancelBatchExport" class="export-cancel">Cancel</button><button type="button" id="requestBatchApproval" class="export-confirm" disabled>Request Approval</button></div></div>`;
    document.body.appendChild(overlay);
    const submit=overlay.querySelector('#requestBatchApproval'),other=overlay.querySelector('#batchOtherReason'),purpose=overlay.querySelector('#batchExportPurpose');
    const update=()=>{const checked=[...overlay.querySelectorAll('input[name=batchExportReason]:checked')],hasOther=checked.some(x=>x.value==='Other');other.hidden=!hasOther;submit.disabled=!checked.length||(hasOther&&!other.value.trim())||purpose.value.trim().length<10;};
    overlay.querySelectorAll('input[name=batchExportReason]').forEach(x=>x.onchange=update);other.oninput=update;purpose.oninput=update;
    overlay.querySelector('#cancelBatchExport').onclick=()=>overlay.remove();
    submit.onclick=async()=>{
      const choices=[...overlay.querySelectorAll('input[name=batchExportReason]:checked')];
      submit.disabled=true;
      try{
        const res=await fetch('/api/communication/batch-export-request',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({section:active,recordIndices:ids,records:data,columns:c.cols,keys:c.keys,reasons:choices.map(x=>x.value),otherReason:other.value.trim(),purpose:purpose.value.trim()})});
        const result=await res.json();if(!res.ok)throw new Error(result.message||'Unable to submit export request');
        overlay.remove();
        showBatchExportStatus('Export Request Submitted',`Your request to export ${ids.length} record${ids.length===1?'':'s'} has been sent to the Administrator. No file will be generated until it is approved.`,result.request,false);
      }catch(err){alert(err.message);submit.disabled=false;}
    };
  }

  function requestSmallExportAuthorization(ids,c,data){
    const reasons=['Diagnosis / Treatment','Continuity of Patient Care','Patient Handover / Department Transfer','Specialist / Referral','Clinical Audit','Approved Medical Research','Regulatory / Legal Requirement','Patient Request','Other'];
    const first=data[0]||{};
    const overlay=document.createElement('div');overlay.className='export-auth-overlay';
    overlay.innerHTML=`<div class="export-auth-modal" role="dialog" aria-modal="true" aria-labelledby="exportAuthTitle"><div class="export-auth-header"><h3 id="exportAuthTitle">Export Authorization</h3></div><div class="export-auth-meta"><div><span class="export-meta-label">Selected records</span><strong>${ids.length}</strong></div><div><span class="export-meta-label">Data</span><strong>${esc(ids.length===1?(first.scan||first.report||first.test||first.diagnosis||active):active)}</strong></div></div><p class="export-auth-help">A reason is required for every 1–10 record export. Select at least one reason before exporting.</p><div class="export-reasons">${reasons.map(x=>`<label class="export-reason-row"><input type="checkbox" name="exportReason" value="${esc(x)}"><span>${esc(x)}</span></label>`).join('')}</div><textarea id="otherExportReason" placeholder="Explain the Other reason" hidden></textarea><div class="export-auth-actions"><button type="button" id="cancelSingleExport" class="export-cancel">Cancel</button><button type="button" id="confirmSingleExport" class="export-confirm" disabled>Confirm Export</button></div></div>`;
    document.body.appendChild(overlay);
    const confirm=overlay.querySelector('#confirmSingleExport'),other=overlay.querySelector('#otherExportReason');
    const update=()=>{const checked=[...overlay.querySelectorAll('input[name=exportReason]:checked')],hasOther=checked.some(v=>v.value==='Other');other.hidden=!hasOther;confirm.disabled=!checked.length||(hasOther&&!other.value.trim());};
    overlay.querySelectorAll('input[name=exportReason]').forEach(x=>x.onchange=update);other.oninput=update;
    overlay.querySelector('#cancelSingleExport').onclick=()=>overlay.remove();

    confirm.onclick=async()=>{
      const choices=[...overlay.querySelectorAll('input[name=exportReason]:checked')];if(!choices.length)return;
      confirm.disabled=true;
      try{
        const item=first.scan||first.report||first.test||first.diagnosis||active;
        const res=await fetch('/api/communication/single-export',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({section:active,recordIndex:ids[0],recordIndices:ids,records:data,patient:first.patient||'',item,reasons:choices.map(x=>x.value),otherReason:other.value.trim()})});
        const result=await res.json();

        if(res.status===409 && result.requiresApproval){
          overlay.remove();
          requestMediumBatchApproval(ids,c,data,result.policy||{});
          return;
        }
        if(!res.ok)throw new Error(result.message||'Export authorization failed');

        const csv=[c.cols.join(','),...data.map(r=>c.keys.map(k=>'"'+String(r[k]??'').replace(/"/g,'""')+'"').join(','))].join('\n');
        const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`wecare-${active}-${ids.length}-records.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
        overlay.remove();
        if(typeof window.showDoctorExportComplete==='function')window.showDoctorExportComplete(result.authorization||{records:ids.length});
      }catch(err){alert(err.message);confirm.disabled=false;}
    };
  }

  async function exportSelected(){
    const ids=[...selected[active]];
    if(!ids.length){alert('Select at least one record.');return;}
    if(ids.length>=totalFor(active)){
      try{
        const res=await fetch('/api/communication/export-all',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({requestedCount:ids.length})});
        const d=await res.json();
        if(!res.ok && d.requiresEvidence){
          let evidenceSaved=false;
          try{
            if(typeof window.WECareCaptureEvidence!=='function') throw new Error('Evidence capture module is not loaded');
            const incident=d.incident||{incidentId:d.incidentId,userId:JSON.parse(sessionStorage.getItem('htd_user')||'{}').id,actionType:'BULK_EXPORT_ATTEMPT',actionLabel:'Bulk patient data export',requestedCount:ids.length,risk:'Critical',riskLevel:'Critical',result:'Blocked',time:new Date().toISOString(),timestamp:new Date().toISOString()};
            await window.WECareCaptureEvidence(incident);
            evidenceSaved=true;
          }catch(captureError){
            console.error('Critical evidence capture failed:',captureError);
            alert('Export blocked. Evidence capture failed, so the session will remain open for review.\n\n'+captureError.message);
            return;
          }
          if(evidenceSaved){
            const finalRes=await fetch('/api/communication/finalize-critical',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({incidentId:d.incidentId,requestedCount:ids.length})});
            const finalData=await finalRes.json();
            if(!finalRes.ok) throw new Error(finalData.message||'Unable to terminate the restricted session');
            await showCriticalRestrictionModal({
              title:'Critical security event',
              message:'You attempted to export all patient records. This bulk export was blocked. Security evidence has been preserved, administration has been notified, and your session has been terminated pending security review.',
              incidentId:d.incidentId
            });
            sessionStorage.clear();
            location.replace('/doctor-login.html?restricted=1');
            return;
          }
        }
        if(!res.ok){alert(d.message||'Export blocked');return;}
      }catch(e){alert(e.message);return;}
    }
    const c=cfg[active], data=ids.map(i=>row(active,i));

    // Phase 2 policy applies to every manually selected 1-50 record export.
    if(ids.length<=50){
      try{
        const policyRes=await fetch(`/api/communication/export-policy?count=${ids.length}`,{headers:{Authorization:'Bearer '+token}});
        const policyData=await policyRes.json();
        if(!policyRes.ok)throw new Error(policyData.message||'Unable to evaluate export policy');
        const policy=policyData.policy||{};

        if(policy.requiresApproval){
          requestMediumBatchApproval(ids,c,data,policy);
          return;
        }

        if(ids.length<=10){
          requestSmallExportAuthorization(ids,c,data);
          return;
        }
      }catch(err){alert(err.message);return;}
    }

    // Existing behavior outside the requested Phase 2 1-50 policy range is unchanged.
    const csv=[c.cols.join(','),...data.map(r=>c.keys.map(k=>'"'+String(r[k]??'').replace(/"/g,'""')+'"').join(','))].join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`wecare-${active}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);

  }
  document.addEventListener('click',e=>{
    const nav=e.target.closest('.nav-link[data-view]'); if(nav){page=0;render(nav.dataset.view);return;}
    if(e.target.id==='prevPage'){page=Math.max(0,page-1);render();return;} if(e.target.id==='nextPage'){page++;render();return;}
    if(e.target.id==='exportRows'){exportSelected();return;}
    if(e.target.id==='exitSelection'){selectionMode[active]=false;selected[active].clear();render();return;}
    if(e.target.id==='masterSelect'){
      if(e.target.checked){selected[active]=new Set(Array.from({length:totalFor(active)},(_,i)=>i));}
      else{selected[active].clear();}
      render();return;
    }
    const rowCheck=e.target.closest('.row-select-check');
    if(rowCheck){
      const idx=Number(rowCheck.dataset.selectRow);
      if(rowCheck.checked)selected[active].add(idx);else selected[active].delete(idx);
      render();return;
    }
    const tr=e.target.closest('tbody tr[data-row]'); if(tr){menuIndex=Number(tr.dataset.row);const menu=document.getElementById('rowMenu');const r=tr.getBoundingClientRect();menu.style.left=Math.min(r.left+20,innerWidth-180)+'px';menu.style.top=Math.min(r.bottom+scrollY,innerHeight+scrollY-180)+'px';menu.hidden=false;return;}
    const m=e.target.closest('[data-menu]'); if(m && menuIndex!==null){const act=m.dataset.menu;if(act==='view')openDetails(menuIndex);if(act==='add')addRecord();if(act==='select'){selectionMode[active]=true;selected[active].has(menuIndex)?selected[active].delete(menuIndex):selected[active].add(menuIndex);render();}if(act==='delete'&&confirm('Delete this record?')){selected[active].delete(menuIndex);alert('Record deleted for this demo view.');render();}return;}
    const menu=document.getElementById('rowMenu'); if(menu)menu.hidden=true;
  });
  const closeReportViewer=()=>{const viewer=document.getElementById('reportViewer');if(viewer){viewer.classList.remove('open');viewer.setAttribute('aria-hidden','true');}};
  document.getElementById('closeReportViewer')?.addEventListener('click',closeReportViewer);
  document.getElementById('printReport')?.addEventListener('click',()=>window.print());
  document.getElementById('reportUpload')?.closest('.upload-button')?.remove();
  document.getElementById('logoutButton').onclick=()=>{sessionStorage.clear();location.href='/doctor-login.html'};
  document.getElementById('notificationButton').onclick=()=>document.getElementById('securityNoticeModal')?.classList.add('open');
  function clock(){const d=new Date();document.getElementById('currentDate').textContent=d.toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});document.getElementById('currentTime').textContent=d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});}clock();setInterval(clock,30000);
  fetch('/api/auth/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json()).then(d=>{if(d?.user){document.getElementById('doctorGreeting').textContent='Hello, Dr. '+String(d.user.fullName||'Arjuna').replace(/^Dr\.\s*/i,'');document.getElementById('doctorPosition').textContent=d.user.position||'Consultant Cardiologist';document.getElementById('doctorDepartment').textContent=d.user.department||'Cardiology';}}).catch(()=>{});
  try{
    if(typeof io==='function'){
      const currentUser=JSON.parse(sessionStorage.getItem('htd_user')||'{}');
      const exportSocket=io({auth:{userId:currentUser.id,role:currentUser.role}});
      exportSocket.on('communication:batch-export-decision',event=>{
        if(event.status==='Approved'){
          showBatchExportStatus('Export Request Approved',`Your ${event.records}-record export request has been approved. The approved file is now available.`,event,true);
        }else if(event.status==='Rejected'){
          showBatchExportStatus('Export Request Rejected',`Your ${event.records}-record export request was rejected. No file has been made available.`,event,false);
        }
      });
    }
  }catch(_e){}

  render('schedule');
})();