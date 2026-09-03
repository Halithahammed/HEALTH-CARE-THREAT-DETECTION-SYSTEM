const express=require('express');
const {authenticateToken,authorizeRoles}=require('../middleware/authMiddleware');
const {trainModel,predict,status,qAll,qGet,qRun}=require('../services/mlService');
const {generateDataset}=require('../services/datasetService');
module.exports=function(io){
 const r=express.Router(); r.use(authenticateToken,authorizeRoles('admin'));

 r.get('/soc-summary',async(_q,res)=>{try{
   const [doctors,audit,high,incidents,restricted,reports,events]=await Promise.all([
     qGet(`SELECT COUNT(*) c FROM doctor_baselines`),qGet(`SELECT COUNT(*) c FROM activity_logs`),qGet(`SELECT COUNT(*) c FROM ml_predictions WHERE risk_level IN ('High','Critical')`),qGet(`SELECT COUNT(*) c FROM security_incidents WHERE status='open'`),qGet(`SELECT COUNT(*) c FROM account_restrictions WHERE status='Active'`),qGet(`SELECT COUNT(*) c FROM investigation_reports`),qAll(`SELECT a.*,u.full_name FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 15`)
   ]);
   res.json({success:true,summary:{doctors:doctors.c,auditEvents:audit.c,highRisk:high.c,openIncidents:incidents.c,restricted:restricted.c,reports:reports.c,events}})
 }catch(e){res.status(500).json({success:false,message:e.message})}});
 r.post('/simulate',async(req,res)=>{try{
   const doctorId=req.body.doctorId; const scenario=req.body.scenario||'normal';
   const baseline=await qGet(`SELECT * FROM doctor_baselines WHERE doctor_id=?`,[doctorId]);
   if(!baseline)return res.status(404).json({success:false,message:'Doctor baseline not found'});
   const normal={doctor_id:doctorId,login_hour:Number(baseline.normal_login_hour||8),session_minutes:Number(baseline.avg_session_minutes||420),records_viewed:Math.round(baseline.avg_records||20),downloads:Math.round(baseline.avg_downloads||2),departments_accessed:1,failed_logins:0,unknown_device:0,external_ip:0,after_hours:0,export_all:0};
   const variants={
    normal:{},midnight:{login_hour:2.2,after_hours:1,records_viewed:45},'unknown-device':{unknown_device:1,external_ip:1,failed_logins:2},'bulk-download':{records_viewed:280,downloads:65,departments_accessed:4},'cross-department':{records_viewed:140,downloads:18,departments_accessed:8},'export-all':{login_hour:2.1,records_viewed:520,downloads:120,departments_accessed:12,unknown_device:1,external_ip:1,after_hours:1,export_all:1}
   };
   const input={...normal,...(variants[scenario]||variants.normal)}; const prediction=await predict(input);
   const response=['Audit event recorded']; let incidentId=null,reportId=null;
   const user=await qGet(`SELECT * FROM users WHERE doctor_id=?`,[doctorId]);
   await qRun(`INSERT INTO activity_logs(user_id,username,doctor_id,action_type,resource_type,resource_id,department,ip_address,device_info,risk_points,risk_level,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[user?.id||null,user?.username||doctorId,doctorId,`SIMULATION_${scenario.toUpperCase().replace(/-/g,'_')}`,'ml_simulation',scenario,baseline.department,'127.0.0.1',input.unknown_device?'Unknown external device':'Known hospital workstation',Math.round(prediction.anomalyScore*100),prediction.risk,prediction.reasons.join('; ')]);
   if(['Medium','High','Critical'].includes(prediction.risk)){response.push('Administrator notified');}
   if(['High','Critical'].includes(prediction.risk)){
     const incident=await qRun(`INSERT INTO security_incidents(user_id,username,total_risk_score,severity,status,summary) VALUES(?,?,?,?,?,?)`,[user?.id||null,user?.username||doctorId,Math.round(prediction.anomalyScore*100),prediction.risk,'open',`${scenario} behavior detected for ${baseline.doctor_name}. ${prediction.reasons.join('; ')}`]); incidentId=incident.lastID||incident.id;
     const report=await qRun(`INSERT INTO investigation_reports(incident_id,user_id,doctor_id,title,classification,risk_score,summary,evidence) VALUES(?,?,?,?,?,?,?,?)`,[incidentId,user?.id||null,doctorId,'AI Insider Threat Investigation Report','Potential Insider Threat',Math.round(prediction.anomalyScore*100),`Isolation Forest classified ${baseline.doctor_name}'s ${scenario} scenario as ${prediction.risk}. Administrator investigation is required.`,JSON.stringify({scenario,input,prediction,doctor:{id:doctorId,name:baseline.doctor_name,department:baseline.department},timestamp:new Date().toISOString(),timezone:'Asia/Kolkata'})]); reportId=report.lastID||report.id; response.push('Incident and investigation report created');
     await qRun(`INSERT INTO messages(sender_name,sender_role,recipient_user_id,recipient_doctor_id,recipient_role,subject,body,category,priority,incident_id) VALUES(?,?,?,?,?,?,?,?,?)`,['WeCare Security Operations','admin',user?.id||null,doctorId,'doctor','Security review in progress',`Your account activity was classified as ${prediction.risk} risk. Incident INC-${String(incidentId).padStart(5,'0')} is under administrator review. You cannot self-approve or delete evidence.`,'Security Notice',prediction.risk,incidentId]);
   }
   if(prediction.risk==='Critical'){
     response.push('Sensitive operation blocked','Session terminated','Account restricted');
     if(user?.id)await qRun(`INSERT INTO account_restrictions(user_id,doctor_id,reason,incident_id,status) VALUES(?,?,?,?,?)`,[user.id,doctorId,`Critical ML anomaly: ${scenario}`,incidentId,'Active']);
     io.emit('security:insider-contained',{incidentId,doctorId,doctor:baseline.doctor_name,action:scenario,risk:'Critical',response:response.join(', ')});
   }
   io.emit('communication:new-message',{recipient_doctor_id:doctorId,recipient_role:'doctor',priority:prediction.risk,subject:'Security review in progress'});
   res.json({success:true,result:{...prediction,doctorName:baseline.doctor_name,scenario,response,incidentId,reportId}})
 }catch(e){res.status(500).json({success:false,message:e.message})}});
 r.get('/investigation-report/:id',async(req,res)=>{try{const report=await qGet(`SELECT r.*,u.full_name FROM investigation_reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=?`,[req.params.id]);if(!report)return res.status(404).json({success:false,message:'Report not found'});res.json({success:true,report})}catch(e){res.status(500).json({success:false,message:e.message})}});

 r.get('/status',async(_q,res)=>{try{res.json({success:true,...await status()})}catch(e){res.status(500).json({success:false,message:e.message})}});
 r.post('/generate',async(req,res)=>{try{const out=await generateDataset({reports:Number(req.body.reports)||1200,days:Number(req.body.days)||60});io.emit('ml:dataset-generated',out);res.json({success:true,...out})}catch(e){res.status(500).json({success:false,message:e.message})}});
 r.post('/train',async(_q,res)=>{try{const model=await trainModel();io.emit('ml:model-trained',model);res.json({success:true,model})}catch(e){res.status(400).json({success:false,message:e.message})}});
 r.post('/predict',async(req,res)=>{try{const result=await predict(req.body);io.emit('ml:prediction',result);res.json({success:true,result})}catch(e){res.status(400).json({success:false,message:e.message})}});
 r.get('/predictions',async(_q,res)=>{try{res.json({success:true,predictions:await qAll(`SELECT * FROM ml_predictions ORDER BY id DESC LIMIT 100`)})}catch(e){res.status(500).json({success:false,message:e.message})}});
 r.get('/baselines',async(_q,res)=>{try{res.json({success:true,baselines:await qAll(`SELECT * FROM doctor_baselines ORDER BY doctor_id`)})}catch(e){res.status(500).json({success:false,message:e.message})}});
 r.get('/reports',async(req,res)=>{try{const limit=Math.min(200,Number(req.query.limit)||100),offset=Number(req.query.offset)||0;const reports=await qAll(`SELECT r.*,p.full_name patient_name,p.age,p.gender,p.blood_group,b.doctor_name FROM patient_reports r JOIN patients p ON p.patient_id=r.patient_id LEFT JOIN doctor_baselines b ON b.doctor_id=r.doctor_id ORDER BY r.id DESC LIMIT ? OFFSET ?`,[limit,offset]);const total=(await qGet(`SELECT COUNT(*) c FROM patient_reports`)).c;res.json({success:true,reports,total,limit,offset})}catch(e){res.status(500).json({success:false,message:e.message})}});
 return r;
}
