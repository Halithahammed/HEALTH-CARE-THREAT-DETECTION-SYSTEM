(()=>{
  function cleanDoctorList(){
    const page=document.getElementById('page-doctors'); if(!page)return;
    const table=page.querySelector('#doctorListView table');
    if(table){
      const head=table.querySelector('thead tr');
      if(head && head.children.length>=8){ head.children[5]?.remove(); }
      table.querySelectorAll('tbody tr').forEach(tr=>{ if(tr.children.length>=8) tr.children[5]?.remove(); });
    }
    page.querySelectorAll('.profile-risk').forEach(x=>x.remove());
    page.querySelectorAll('[data-profile-tab="overview"],[data-profile-tab="security"]').forEach(x=>x.remove());
    page.querySelectorAll('#doctor-tab-overview,#doctor-tab-security').forEach(x=>x.remove());
    const activityBtn=page.querySelector('[data-profile-tab="activity"]');
    const activityPanel=page.querySelector('#doctor-tab-activity');
    if(activityBtn && activityPanel){
      activityBtn.classList.add('active'); activityPanel.classList.add('active');
      const tabs=page.querySelector('.profile-tabs'); if(tabs) tabs.style.justifyContent='flex-start';
      // trigger existing handler once if available so the activity table populates
      if(!activityBtn.dataset.autoOpened){activityBtn.dataset.autoOpened='1'; setTimeout(()=>activityBtn.click(),0)}
    }
    page.querySelectorAll('.rare-blood').forEach(x=>x.classList.remove('rare-blood'));
  }
  const observer=new MutationObserver(cleanDoctorList); observer.observe(document.body,{subtree:true,childList:true});
  document.addEventListener('click',e=>{if(e.target.closest('[data-page="doctors"],.doctor-name-link'))setTimeout(cleanDoctorList,30)});
  setTimeout(cleanDoctorList,300);
})();
