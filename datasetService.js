const {qAll,qGet,qRun}=require('./mlService');
const first=['Aarav','Vivaan','Aditya','Arjun','Sai','Rohan','Rahul','Karthik','Sanjay','Vikram','Priya','Ananya','Meera','Kavya','Lakshmi','Divya','Nisha','Sneha','Pooja','Asha'];
const last=['Sharma','Kumar','Iyer','Nair','Reddy','Patel','Menon','Rao','Singh','Gupta','Krishnan','Pillai','Joshi','Verma','Bose'];
const depts=['Cardiology','Neurology','General Medicine','Pediatrics','Orthopedics','Oncology','Radiology','Nephrology','Emergency Medicine','Dermatology'];
const reportTypes=['Complete Blood Count','Liver Function Test','Kidney Function Test','HbA1c','Lipid Profile','Thyroid Function Test','ECG Report','MRI Brain','CT Scan','Chest X-Ray','Ultrasound Abdomen','Discharge Summary'];
const diagnoses=['Hypertension','Type 2 Diabetes','Migraine','Viral Fever','Asthma','Arthritis','Anemia','Gastritis','Pneumonia','Routine follow-up'];
const rnd=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const pick=a=>a[rnd(0,a.length-1)];

async function ensureDoctors(){
  const count=(await qGet(`SELECT COUNT(*) c FROM doctor_baselines`)).c;
  if(count>=50)return;
  for(let i=1;i<=50;i++){
    const id=`DOC${String(i).padStart(3,'0')}`; const name=`Dr. ${pick(first)} ${pick(last)}`; const dept=depts[(i-1)%depts.length];
    const login=7.5+Math.random()*3, records=rnd(12,45), downloads=rnd(1,5);
    await qRun(`INSERT OR IGNORE INTO doctor_baselines(doctor_id,doctor_name,department,normal_login_hour,normal_logout_hour,avg_session_minutes,avg_records,avg_downloads,known_devices,known_locations,baseline_score) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [id,name,dept,Number(login.toFixed(2)),Number((login+8).toFixed(2)),rnd(360,600),records,downloads,JSON.stringify(['Hospital Desktop','Managed Laptop']),JSON.stringify(['WeCare Hospital Network']),rnd(93,99)]);
  }
}

async function generateDataset({reports=1200,days=60}={}){
  await ensureDoctors();
  await qRun(`DELETE FROM behavior_samples`); await qRun(`DELETE FROM patient_reports`); await qRun(`DELETE FROM patients`);
  const doctors=await qAll(`SELECT * FROM doctor_baselines ORDER BY doctor_id`);
  const patientCount=Math.max(500,Math.min(2000,reports));
  for(let i=1;i<=patientCount;i++){
    const patientId=`PAT${String(i).padStart(5,'0')}`; const name=`${pick(first)} ${pick(last)}`; const gender=i%2?'Male':'Female'; const age=rnd(1,89); const dept=pick(depts); const doctor=pick(doctors);
    await qRun(`INSERT INTO patients(patient_id,full_name,age,gender,blood_group,department,primary_doctor_id,diagnosis,created_at) VALUES(?,?,?,?,?,?,?,?,datetime('now',?))`,
      [patientId,name,age,gender,pick(['A+','A-','B+','B-','O+','O-','AB+','AB-']),dept,doctor.doctor_id,pick(diagnoses),`-${rnd(1,500)} days`]);
    const type=pick(reportTypes); const status=pick(['Final','Final','Final','Pending Review']);
    const findings=`Clinical values reviewed for ${type}. Findings are consistent with ${pick(['normal limits','mild abnormality requiring follow-up','stable chronic condition','additional clinical correlation'])}.`;
    const impression=`${pick(diagnoses)}; correlate with symptoms and previous history.`;
    await qRun(`INSERT INTO patient_reports(report_id,patient_id,doctor_id,report_type,department,status,findings,impression,recommendation,generated_at) VALUES(?,?,?,?,?,?,?,?,?,datetime('now',?))`,
      [`RPT${String(i).padStart(6,'0')}`,patientId,doctor.doctor_id,type,dept,status,findings,impression,'Follow treating physician advice and repeat testing when clinically indicated.',`-${rnd(0,180)} days`]);
  }
  for(const d of doctors){
    for(let day=0;day<days;day++){
      const weekday=(new Date(Date.now()-day*86400000)).getDay(); if(weekday===0)continue;
      const samples=rnd(1,3);
      for(let s=0;s<samples;s++){
        const login=Math.max(5,Math.min(23,d.normal_login_hour+(Math.random()-.5)*1.4));
        await qRun(`INSERT INTO behavior_samples(doctor_id,login_hour,session_minutes,records_viewed,downloads,departments_accessed,failed_logins,unknown_device,external_ip,after_hours,export_all,label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now',?))`,
          [d.doctor_id,Number(login.toFixed(2)),Math.max(60,Math.round(d.avg_session_minutes+(Math.random()-.5)*120)),Math.max(1,Math.round(d.avg_records+(Math.random()-.5)*12)),Math.max(0,Math.round(d.avg_downloads+(Math.random()-.5)*3)),1,0,0,0,0,0,'normal',`-${day} days`]);
      }
    }
  }
  const count=await qGet(`SELECT COUNT(*) reports FROM patient_reports`); const samples=await qGet(`SELECT COUNT(*) samples FROM behavior_samples`);
  return {reports:count.reports,patients:patientCount,samples:samples.samples,doctors:doctors.length,days};
}
module.exports={generateDataset,ensureDoctors};
