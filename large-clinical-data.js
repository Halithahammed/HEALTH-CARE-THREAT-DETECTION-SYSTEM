(()=>{
  const host=document.getElementById('sectionHost');
  const token=sessionStorage.getItem('htd_token');
  if(!host||!token)return;
  const patientNames=['Aarav Kumar','Ananya Devi','Arjun Rao','Diya Sharma','Ishaan Patel','Kavya Nair','Meera Singh','Rohan Das','Sanjay Iyer','Zoya Khan'];
  const scans=['MRI Brain','CT Abdomen','Chest X-Ray','Ultrasound','CT Angiography','MRI Spine'];
  const statuses=['Final','Reviewed','Pending'];
  const patient=(i)=>({id:`PT-${String(100000+i).padStart(6,'0')}`,name:patientNames[i%patientNames.length],age:18+(i%73),sex:i%2?'Female':'Male',department:['Medicine','Cardiology','Radiology','Neurology'][i%4],scan:scans[i%scans.length],scanId:`SC-${String(500000+i).padStart(6,'0')}`,date:new Date(Date.now()-(i%365)*86400000).toISOString().slice(0,10),status:statuses[i%3]});
  const TOTAL=6000;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function data(){return Array.from({length:TOTAL},(_,i)=>patient(i+1))}
  async function protectedExport(count){
    const r=await fetch('/api/communication/export-all',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({requestedCount:count})});
    const d=await r.json();
    if(d.terminated){alert(`CRITICAL SECURITY ALERT\n\n${d.message}\nIncident: INC-${String(d.incidentId).padStart(5,'0')}`);sessionStorage.clear();location.href='/doctor-login.html';return}
    if(!r.ok)throw Error(d.message||'Export blocked');
  }
  function renderLarge(kind){
    const rows=data(); const title=kind==='patients'?'Patient Directory':'Scan Report Archive';
    document.getElementById('pageTitle').textContent=title;
    document.getElementById('pageSubtitle').textContent=`${TOTAL.toLocaleString('en-IN')} demonstration records with monitored bulk export.`;
    host.innerHTML=`<article class="panel"><div class="panel-heading"><div><p class="eyebrow">Large clinical dataset</p><h3>${title}</h3><p>Showing the first 100 of ${TOTAL.toLocaleString('en-IN')} sample records. Search and selection operate across the demo dataset.</p></div><div class="heading-actions"><button class="secondary-action" id="exportSelected">Export Selected</button><button class="primary-action" id="exportAllLarge">Export All (${TOTAL.toLocaleString('en-IN')})</button></div></div><div class="notice"><strong>Security monitoring:</strong> selecting every record and exporting is classified as a bulk data-exfiltration attempt. The export is blocked, the administrator is alerted, and the doctor session is terminated immediately.</div><div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="selectAllLarge" aria-label="Select all records"></th>${kind==='patients'?'<th>Patient ID</th><th>Name</th><th>Age</th><th>Sex</th><th>Department</th><th>Status</th>':'<th>Scan ID</th><th>Patient</th><th>Scan Type</th><th>Date</th><th>Department</th><th>Status</th>'}</tr></thead><tbody>${rows.slice(0,100).map((r,i)=>`<tr><td><input class="large-row" type="checkbox" data-index="${i}"></td>${kind==='patients'?`<td>${r.id}</td><td>${esc(r.name)}</td><td>${r.age}</td><td>${r.sex}</td><td>${r.department}</td><td>${r.status}</td>`:`<td>${r.scanId}</td><td>${esc(r.name)} · ${r.id}</td><td>${r.scan}</td><td>${r.date}</td><td>${r.department}</td><td>${r.status}</td>`}</tr>`).join('')}</tbody></table></div></article>`;
    let all=false;
    document.getElementById('selectAllLarge').onchange=e=>{all=e.target.checked;document.querySelectorAll('.large-row').forEach(x=>x.checked=all)};
    document.getElementById('exportAllLarge').onclick=()=>protectedExport(TOTAL).catch(e=>alert(e.message));
    document.getElementById('exportSelected').onclick=()=>{const visible=[...document.querySelectorAll('.large-row:checked')].length;if(all||visible===100){protectedExport(TOTAL).catch(e=>alert(e.message));return}if(!visible){alert('Select at least one record.');return}const selected=rows.slice(0,100).filter((_,i)=>document.querySelector(`.large-row[data-index="${i}"]`)?.checked);const csv=['Patient ID,Name,Scan ID,Scan Type,Date',...selected.map(r=>`${r.id},"${r.name}",${r.scanId},"${r.scan}",${r.date}`)].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`wecare-${kind}-selected.csv`;a.click();URL.revokeObjectURL(a.href)};
  }
  const sidebar=document.querySelector('.sidebar');
  const scansBtn=sidebar?.querySelector('[data-view="scans"]');
  if(scansBtn){scansBtn.dataset.large='scans';scansBtn.removeAttribute('data-view')}
  const patientsBtn=document.createElement('button');patientsBtn.className='nav-link';patientsBtn.textContent='Patients (6,000)';patientsBtn.dataset.large='patients';sidebar?.insertBefore(patientsBtn,sidebar.children[3]||null);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-large]');if(b){document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderLarge(b.dataset.large)}});
})();
