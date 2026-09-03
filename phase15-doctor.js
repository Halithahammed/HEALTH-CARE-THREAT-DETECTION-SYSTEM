
(function(){
 const user=JSON.parse(sessionStorage.getItem('htd_user')||'{}');
 const username=(user.username||'doctor').toLowerCase();
 const name=(user.fullName||user.full_name||'Dr. Arjun Kumar').replace(/^Dr\.\s*/i,'');
 const profile={
  doctor:{name:'Arjun Kumar',security:'Protected',note:'Known device · Hospital network'},
  doctor123:{name:'Arjun Kumar',security:'Protected',note:'Known device · Hospital network'},
  doctor456:{name:'Priya Sharma',security:'Under Review',note:'Failed-password and abnormal session activity'},
  doctor789:{name:'Rahul Nair',security:'High Risk',note:'Unknown IP · unusual-time record access'},
  doctor000:{name:'Meera Joseph',security:'Protected',note:'Normal behavior · trusted workstation'}
 }[username]||{name,security:'Protected',note:'Known device · Hospital network'};

 function apply(){
   const greeting=document.getElementById('doctorGreeting'); if(greeting) greeting.textContent='Hello, Dr. '+profile.name;
   const cards=document.querySelectorAll('.summary-card');
   if(cards[0]) cards[0].innerHTML="<span>Appointments</span><strong>10</strong><small>Today's clinical schedule</small>";
   if(cards[1]) cards[1].innerHTML="<span>Clinical Tasks</span><strong>2</strong><small>Pending follow-ups</small>";
   const security=[...cards].find(c=>/account security/i.test(c.textContent));
   if(security) security.innerHTML=`<span>Account security</span><strong>${profile.security}</strong><small>${profile.note}</small>`;
   document.querySelectorAll('.page-heading .eyebrow').forEach(x=>x.remove());
   const sub=document.getElementById('pageSubtitle'); if(sub) sub.textContent='';

   const panel=document.querySelector('#sectionHost .panel'); if(!panel)return;
   const title=panel.querySelector('h3')?.textContent||'';
   panel.querySelectorAll('.panel-heading p,.eyebrow').forEach(x=>x.remove());
   const actionBox=panel.querySelector('.heading-actions');
   if(actionBox && /Patient Reports|Scan Reports|Medical Records/i.test(title)){
      actionBox.innerHTML=`<button class="secondary-action" data-export-current>Export</button><button class="primary-action" data-export-all>Export All</button>`;
   }
   const table=panel.querySelector('table');
   if(table && /Patient Reports|Scan Reports/i.test(title) && !table.dataset.phase15){
     table.dataset.phase15='1';
     const th=table.querySelector('thead tr');
     if(th) th.insertAdjacentHTML('beforeend','<th class="phase15-check-col">Select</th>');
     table.querySelectorAll('tbody tr').forEach((tr,i)=>tr.insertAdjacentHTML('beforeend',`<td class="phase15-check-col"><input type="checkbox" aria-label="Select row ${i+1}"></td>`));
   }
 }
 const observer=new MutationObserver(()=>setTimeout(apply,0)); observer.observe(document.body,{subtree:true,childList:true}); setTimeout(apply,100);

 document.addEventListener('click',e=>{
   const b=e.target.closest('[data-export-all],[data-export-current]');
   if(!b)return;
   e.preventDefault(); e.stopImmediatePropagation();
   const all=b.hasAttribute('data-export-all');
   const doctor=username==='doctor'||username==='doctor123'?'Arjun Kumar':profile.name;
   const suspicious=(username==='doctor'||username==='doctor123')&&all;
   const event={doctor,action:all?'EXPORT_ALL':'EXPORT_SELECTED',time:new Date().toISOString(),risk:suspicious?'Critical':'Low'};
   localStorage.setItem('phase15-latest-event',JSON.stringify(event));
   window.dispatchEvent(new StorageEvent('storage',{key:'phase15-latest-event',newValue:JSON.stringify(event)}));
   const toast=document.getElementById('toast');
   if(suspicious){
     if(toast){toast.textContent='Export All blocked. Administrator alerted.';toast.classList.add('show');}
     alert('Security Alert: Export All was blocked and sent to the administrator.');
   } else {
     if(toast){toast.textContent=all?'Export All prepared.':'Export prepared.';toast.classList.add('show');}
   }
 },true);
})();
