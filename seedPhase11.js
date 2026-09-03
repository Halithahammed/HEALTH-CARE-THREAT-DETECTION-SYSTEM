const db=require('./database');
const crypto=require('crypto');
const run=(s,p=[])=>new Promise((ok,no)=>db.run(s,p,function(e){e?no(e):ok(this)}));
const get=(s,p=[])=>new Promise((ok,no)=>db.get(s,p,(e,r)=>e?no(e):ok(r)));
(async()=>{
 const incident=await get('SELECT * FROM security_incidents ORDER BY id DESC LIMIT 1');
 if(!incident){console.log('No incident available; run a High/Critical simulation first.');return db.close();}
 const exists=await get('SELECT id FROM forensic_cases WHERE incident_id=?',[incident.id]);
 if(exists){console.log('Phase 11 case already exists.');return db.close();}
 const user=await get('SELECT * FROM users WHERE id=?',[incident.user_id]);
 const code=`CASE-${new Date().getFullYear()}-${String(incident.id).padStart(5,'0')}`;
 const c=await run('INSERT INTO forensic_cases(case_code,incident_id,doctor_id,priority,status,summary,ai_recommendation,investigator) VALUES(?,?,?,?,?,?,?,?)',[code,incident.id,user?.doctor_id,incident.severity,'Open',incident.summary,'Preserve evidence and perform administrator review.','Hospital Security Administrator']);
 const payload=JSON.stringify(incident), hash=crypto.createHash('sha256').update(payload).digest('hex');
 await run('INSERT INTO digital_evidence(case_id,title,evidence_type,payload,sha256_hash,locked) VALUES(?,?,?,?,?,1)',[c.lastID,'Incident Snapshot','incident',payload,hash]);
 console.log('Created',code); db.close();
})().catch(e=>{console.error(e);db.close();process.exitCode=1});
