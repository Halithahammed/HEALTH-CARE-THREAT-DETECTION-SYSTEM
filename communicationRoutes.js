const express = require('express');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');
const db = require('../database/database');
const { getIncident: getEvidenceIncident } = require('../services/evidenceService');

function run(sql, params=[]) { return new Promise((resolve,reject)=>db.run(sql,params,function(e){e?reject(e):resolve({id:this.lastID,changes:this.changes})})); }
function all(sql, params=[]) { return new Promise((resolve,reject)=>db.all(sql,params,(e,r)=>e?reject(e):resolve(r))); }
function get(sql, params=[]) { return new Promise((resolve,reject)=>db.get(sql,params,(e,r)=>e?reject(e):resolve(r))); }
function audit(user, action, resourceType, resourceId, reason, req, risk='Low', points=0) {
  return run(`INSERT INTO activity_logs (user_id,username,doctor_id,action_type,resource_type,resource_id,department,ip_address,device_info,risk_points,risk_level,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [user.id,user.username,user.doctorId||null,action,resourceType,resourceId||null,user.department||null,req.ip,req.headers['user-agent']||'unknown',points,risk,reason||null]);
}

module.exports = function createCommunicationRoutes(io) {
  const router = express.Router();
  router.use(authenticateToken);

  router.get('/messages', async (req,res)=>{
    try {
      const rows = req.user.role === 'admin'
        ? await all(`SELECT * FROM messages ORDER BY id DESC LIMIT 300`)
        : await all(`SELECT * FROM messages WHERE recipient_user_id=? OR recipient_doctor_id=? OR recipient_role='doctor' OR recipient_role='all' ORDER BY id DESC LIMIT 150`, [req.user.id, req.user.doctorId]);
      res.json({success:true,messages:rows});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  router.post('/messages', async (req,res)=>{
    try {
      const { recipientUserId, recipientDoctorId, recipientRole, subject, body, category='Security Notice', priority='Normal', incidentId=null } = req.body;
      if(!subject || !body) return res.status(400).json({success:false,message:'subject and body are required'});
      if(req.user.role==='doctor' && recipientRole!=='admin') return res.status(403).json({success:false,message:'Doctors may send requests only to administrators'});
      const result=await run(`INSERT INTO messages (sender_user_id,sender_name,sender_role,recipient_user_id,recipient_doctor_id,recipient_role,subject,body,category,priority,incident_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [req.user.id,req.user.fullName,req.user.role,recipientUserId||null,recipientDoctorId||null,recipientRole||null,subject,body,category,priority,incidentId]);
      await audit(req.user,'MESSAGE_SENT','message',String(result.id),`${category}: ${subject}`,req);
      const message=await get('SELECT * FROM messages WHERE id=?',[result.id]);
      io.emit('communication:new-message',message);
      res.status(201).json({success:true,message});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  router.post('/messages/:id/read', async (req,res)=>{
    try {
      const row=await get('SELECT * FROM messages WHERE id=?',[req.params.id]);
      if(!row) return res.status(404).json({success:false,message:'Message not found'});
      if(req.user.role!=='admin' && !(row.recipient_user_id===req.user.id || row.recipient_doctor_id===req.user.doctorId || ['doctor','all'].includes(row.recipient_role))) return res.status(403).json({success:false,message:'Access denied'});
      await run(`UPDATE messages SET status='Read',read_at=datetime('now') WHERE id=?`,[req.params.id]);
      await audit(req.user,'MESSAGE_READ','message',req.params.id,row.subject,req);
      io.emit('communication:message-read',{id:Number(req.params.id),reader:req.user.fullName});
      res.json({success:true});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  // Phase 2: normal 1-10 record exports always require a reason.
  // Every successful small export is stored as one transaction so repeated
  // 1-by-1 / small-batch activity can be correlated over time.
  async function ensureExportAuthorizationTable(){
    await run(`CREATE TABLE IF NOT EXISTS export_authorizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_user_id INTEGER,
      doctor_id TEXT,
      doctor_name TEXT,
      section TEXT,
      record_index INTEGER,
      patient TEXT,
      item TEXT,
      reason TEXT,
      other_reason TEXT,
      exported_at TEXT DEFAULT (datetime('now')),
      admin_status TEXT DEFAULT 'Pending',
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      record_count INTEGER DEFAULT 1,
      record_indices TEXT DEFAULT '[]',
      records_json TEXT DEFAULT '[]'
    )`);
    const columns=await all(`PRAGMA table_info(export_authorizations)`);
    const names=new Set(columns.map(x=>x.name));
    const additions=[
      ['record_count','INTEGER DEFAULT 1'],
      ['record_indices',`TEXT DEFAULT '[]'`],
      ['records_json',`TEXT DEFAULT '[]'`]
    ];
    for(const [name,type] of additions){
      if(!names.has(name)) await run(`ALTER TABLE export_authorizations ADD COLUMN ${name} ${type}`);
    }
  }

  async function recentCompletedExportActivity(userId){
    await ensureExportAuthorizationTable();
    await ensureBatchExportTable();

    const small=await all(`SELECT id,section,record_count,reason,other_reason,exported_at
      FROM export_authorizations
      WHERE doctor_user_id=? AND exported_at>=datetime('now','-7 days')
      ORDER BY id DESC LIMIT 100`,[userId]);

    const approved=await all(`SELECT id,section,record_count,reason,other_reason,purpose,risk_level,downloaded_at
      FROM batch_export_requests
      WHERE doctor_user_id=? AND downloaded_at IS NOT NULL AND downloaded_at>=datetime('now','-7 days')
      ORDER BY id DESC LIMIT 100`,[userId]);

    const smallRecords=small.reduce((sum,row)=>sum+Number(row.record_count||1),0);
    const approvedRecords=approved.reduce((sum,row)=>sum+Number(row.record_count||0),0);

    return {
      small,
      approved,
      smallTransactionCount:small.length,
      approvedTransactionCount:approved.length,
      transactionCount:small.length+approved.length,
      recordCount:smallRecords+approvedRecords
    };
  }

  async function exportPolicyFor(userId,currentCount){
    const count=Number(currentCount||0);
    const recent=await recentCompletedExportActivity(userId);
    const projected=recent.recordCount+count;

    let requiresApproval=false;
    let trigger='normal';
    let message='Normal clinical export. A reason is required and the action will be logged.';

    if(count>=11 && count<=50){
      requiresApproval=true;
      trigger='medium_batch';
      message=`${count} selected records require Administrator approval before download.`;
    }else if(count>=1 && count<=10 && recent.smallTransactionCount>=3){
      requiresApproval=true;
      trigger='repeated_small_exports';
      message=`You have already completed ${recent.smallTransactionCount} small export transactions in the last 7 days. Additional export approval is required. Contact the Administrator.`;
    }else if(count>=1 && count<=10 && projected>=11){
      requiresApproval=true;
      trigger='cumulative_records';
      message=`This export would bring your recent 7-day exported total to ${projected} records. Administrator approval is required.`;
    }

    let risk='Low', riskScore=10;
    if(requiresApproval){risk='Medium';riskScore=45;}
    if(trigger==='repeated_small_exports' && (recent.smallTransactionCount>=3 || projected>=20)){
      risk='High';riskScore=75;
    }

    return {
      selectedCount:count,
      requiresApproval,
      trigger,
      risk,
      riskScore,
      recentTransactionCount:recent.transactionCount,
      recentSmallTransactionCount:recent.smallTransactionCount,
      recentRecordCount:recent.recordCount,
      projectedRecordCount:projected,
      message
    };
  }

  router.get('/export-policy', async (req,res)=>{
    try{
      if(req.user.role!=='doctor') return res.status(403).json({success:false,message:'Doctor account required'});
      const count=Number(req.query.count||0);
      if(!Number.isInteger(count)||count<1||count>50) return res.status(400).json({success:false,message:'Export policy check supports 1-50 selected records'});
      const policy=await exportPolicyFor(req.user.id,count);
      res.json({success:true,policy});
    }catch(e){res.status(500).json({success:false,message:e.message});}
  });

  router.post('/single-export', async (req,res)=>{
    try {
      if(req.user.role!=='doctor') return res.status(403).json({success:false,message:'Doctor account required'});
      const {section,recordIndex,recordIndices,records,patient,item,reason,reasons,otherReason}=req.body||{};
      const ids=Array.isArray(recordIndices)?recordIndices.map(Number).filter(Number.isInteger):[Number(recordIndex||0)];
      const cleanIds=ids.filter(Number.isInteger);
      const count=cleanIds.length;
      if(count<1||count>10) return res.status(400).json({success:false,message:'Normal export authorization applies only to 1-10 selected records'});

      const policy=await exportPolicyFor(req.user.id,count);
      if(policy.requiresApproval){
        return res.status(409).json({
          success:false,
          requiresApproval:true,
          policy,
          message:policy.message
        });
      }

      const allowed=['Diagnosis / Treatment','Continuity of Patient Care','Patient Handover / Department Transfer','Specialist / Referral','Clinical Audit','Approved Medical Research','Regulatory / Legal Requirement','Patient Request','Other'];
      const selectedReasons=Array.isArray(reasons)?reasons.filter(x=>allowed.includes(x)):(reason&&allowed.includes(reason)?[reason]:[]);
      if(!selectedReasons.length) return res.status(400).json({success:false,message:'At least one valid export reason is required'});
      if(selectedReasons.includes('Other') && !String(otherReason||'').trim()) return res.status(400).json({success:false,message:'Explain the Other export reason'});

      const recordList=Array.isArray(records)?records.slice(0,10):[];
      const reasonText=selectedReasons.join('; ');
      await ensureExportAuthorizationTable();

      const firstRecord=recordList[0]||{};
      const firstPatient=patient||firstRecord.patient||firstRecord.name||'Selected records';
      const firstItem=item||firstRecord.scan||firstRecord.report||firstRecord.test||firstRecord.diagnosis||section||'Clinical records';

      const result=await run(`INSERT INTO export_authorizations(
        doctor_user_id,doctor_id,doctor_name,section,record_index,patient,item,reason,other_reason,
        record_count,record_indices,records_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[
        req.user.id,req.user.doctorId,req.user.fullName,section||'',cleanIds[0]??0,
        firstPatient,firstItem,reasonText,otherReason||'',count,JSON.stringify(cleanIds),JSON.stringify(recordList)
      ]);

      await audit(req.user,'SMALL_RECORD_EXPORT',section||'clinical_record',String(result.id),
        `${count} record${count===1?'':'s'} exported; ${reasonText}${otherReason?': '+otherReason:''}`,
        req,'Low',Math.min(10,count*2));

      const event={
        id:result.id,
        doctor:req.user.fullName,
        doctorId:req.user.doctorId,
        role:'Doctor',
        section,
        patient:firstPatient,
        item:firstItem,
        reason:selectedReasons.includes('Other')?`${reasonText} — ${otherReason}`:reasonText,
        records:count,
        result:'Allowed',
        status:'Logged',
        time:new Date().toISOString()
      };

      io.to('admins').emit('communication:small-export',event);
      res.json({success:true,authorization:event});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  router.get('/exported-details', async (req,res)=>{
    try {
      if(req.user.role!=='admin') return res.status(403).json({success:false,message:'Administrator account required'});
      await ensureExportAuthorizationTable();
      const rows=await all(`SELECT * FROM export_authorizations ORDER BY id DESC LIMIT 500`);
      res.json({success:true,exports:rows});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  router.post('/exported-details/:id/acknowledge', async (req,res)=>{
    try {
      if(req.user.role!=='admin') return res.status(403).json({success:false,message:'Administrator account required'});
      await ensureExportAuthorizationTable();
      await run(`UPDATE export_authorizations SET admin_status='Acknowledged', acknowledged_at=datetime('now'), acknowledged_by=? WHERE id=?`,[req.user.fullName||'Admin',req.params.id]);
      const row=await get(`SELECT * FROM export_authorizations WHERE id=?`,[req.params.id]);
      if(!row) return res.status(404).json({success:false,message:'Export notification not found'});
      io.emit('communication:single-export-acknowledged',{id:Number(req.params.id),status:'Acknowledged',acknowledgedBy:req.user.fullName||'Admin'});
      res.json({success:true,export:row});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  // Phase 1 + Phase 2: controlled 11-50 record exports plus
  // persistent low-and-slow correlation across a rolling 7-day window.
  async function ensureBatchExportTable(){
    await run(`CREATE TABLE IF NOT EXISTS batch_export_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_user_id INTEGER NOT NULL,
      doctor_id TEXT,
      doctor_name TEXT,
      section TEXT,
      record_indices TEXT NOT NULL,
      records_json TEXT NOT NULL,
      columns_json TEXT NOT NULL,
      keys_json TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      reason TEXT NOT NULL,
      other_reason TEXT,
      purpose TEXT NOT NULL,
      risk_level TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Pending Approval',
      requested_at TEXT DEFAULT (datetime('now')),
      decided_at TEXT,
      decided_by TEXT,
      rejection_reason TEXT,
      downloaded_at TEXT,
      risk_score INTEGER DEFAULT 45,
      low_slow_detected INTEGER DEFAULT 0,
      recent_request_count INTEGER DEFAULT 0,
      recent_record_count INTEGER DEFAULT 0,
      previous_rejected_count INTEGER DEFAULT 0,
      risk_explanation TEXT,
      recent_history_json TEXT DEFAULT '[]'
    )`);

    // Safe migration for databases created by Phase 1.
    const columns=await all(`PRAGMA table_info(batch_export_requests)`);
    const names=new Set(columns.map(x=>x.name));
    const additions=[
      ['risk_score','INTEGER DEFAULT 45'],
      ['low_slow_detected','INTEGER DEFAULT 0'],
      ['recent_request_count','INTEGER DEFAULT 0'],
      ['recent_record_count','INTEGER DEFAULT 0'],
      ['previous_rejected_count','INTEGER DEFAULT 0'],
      ['risk_explanation','TEXT'],
      ['recent_history_json',`TEXT DEFAULT '[]'`]
    ];
    for(const [name,type] of additions){
      if(!names.has(name)) await run(`ALTER TABLE batch_export_requests ADD COLUMN ${name} ${type}`);
    }
  }

  function classifyRepeatedBatchRisk(recentRows,currentCount){
    const priorCount=recentRows.length;
    const priorRecords=recentRows.reduce((sum,row)=>sum+Number(row.record_count||0),0);
    const cumulativeRecords=priorRecords+Number(currentCount||0);
    const previousRejectedCount=recentRows.filter(row=>row.status==='Rejected').length;

    let risk='Medium', score=45, lowSlow=false;
    if(priorCount>=1 || cumulativeRecords>=50 || previousRejectedCount>0){
      risk='High'; score=75; lowSlow=true;
    }
    if(priorCount>=2 || cumulativeRecords>=75){
      risk='Critical'; score=95; lowSlow=true;
    }

    let explanation=`First medium-size export request in the current 7-day review window.`;
    if(risk==='High'){
      explanation=`Repeated bulk-export activity detected: ${priorCount} previous request${priorCount===1?'':'s'} and ${cumulativeRecords} total requested records within 7 days.`;
      if(previousRejectedCount) explanation+=` ${previousRejectedCount} previous request${previousRejectedCount===1?' was':'s were'} rejected.`;
    }
    if(risk==='Critical'){
      explanation=`Low-and-slow pattern detected: ${priorCount+1} medium-size export requests totaling ${cumulativeRecords} records within 7 days. Strong Administrator review is required.`;
      if(previousRejectedCount) explanation+=` ${previousRejectedCount} previous request${previousRejectedCount===1?' was':'s were'} rejected.`;
    }

    return {risk,score,lowSlow,priorCount,cumulativeRecords,previousRejectedCount,explanation};
  }

  router.post('/batch-export-request', async (req,res)=>{
    try {
      if(req.user.role!=='doctor') return res.status(403).json({success:false,message:'Doctor account required'});
      const {section,recordIndices,records,columns,keys,reasons,reason,otherReason,purpose}=req.body||{};
      const ids=Array.isArray(recordIndices)?recordIndices.map(Number).filter(Number.isInteger):[];
      const selectedRecords=Array.isArray(records)?records:[];
      const headers=Array.isArray(columns)?columns.map(String):[];
      const fields=Array.isArray(keys)?keys.map(String):[];
      const count=ids.length;
      if(count<1||count>50) return res.status(400).json({success:false,message:'Controlled export approval supports 1-50 selected records'});
      const policy=await exportPolicyFor(req.user.id,count);
      if(count<=10 && !policy.requiresApproval){
        return res.status(400).json({success:false,message:'This 1-10 record export is still within the normal authorization range'});
      }
      if(selectedRecords.length!==count) return res.status(400).json({success:false,message:'Selected record details do not match the requested record count'});
      if(!headers.length||headers.length!==fields.length) return res.status(400).json({success:false,message:'Export column definition is invalid'});
      const allowed=['Diagnosis / Treatment','Continuity of Patient Care','Patient Handover / Department Transfer','Specialist / Referral','Clinical Audit','Approved Medical Research','Regulatory / Legal Requirement','Patient Request','Other'];
      const selectedReasons=Array.isArray(reasons)?reasons.filter(x=>allowed.includes(x)):(reason&&allowed.includes(reason)?[reason]:[]);
      if(!selectedReasons.length) return res.status(400).json({success:false,message:'At least one valid export reason is required'});
      if(selectedReasons.includes('Other')&&!String(otherReason||'').trim()) return res.status(400).json({success:false,message:'Explain the Other export reason'});
      if(String(purpose||'').trim().length<10) return res.status(400).json({success:false,message:'Provide a short purpose explaining why this batch is required'});
      const reasonText=selectedReasons.join('; ');
      await ensureBatchExportTable();

      // Phase 2: correlate this request with both previous approval requests
      // and already-completed small exports. This closes the 1-by-1 loophole.
      const recentRows=await all(`SELECT id,record_count,status,reason,other_reason,purpose,risk_level,requested_at
        FROM batch_export_requests
        WHERE doctor_user_id=? AND requested_at>=datetime('now','-7 days')
        ORDER BY id DESC LIMIT 20`,[req.user.id]);
      const completed=await recentCompletedExportActivity(req.user.id);
      const context=classifyRepeatedBatchRisk(recentRows,count);

      if(policy.trigger==='repeated_small_exports'){
        context.risk='High';
        context.score=Math.max(context.score,75);
        context.lowSlow=true;
        context.explanation=`Low-and-slow pattern detected: ${policy.recentSmallTransactionCount} completed small export transactions were recorded in the last 7 days. This additional export requires Administrator review.`;
      }else if(policy.trigger==='cumulative_records'){
        context.risk='Medium';
        context.score=Math.max(context.score,45);
        context.lowSlow=true;
        context.explanation=`Cumulative export threshold reached: recent completed exports total ${policy.recentRecordCount} records and this request would bring the total to ${policy.projectedRecordCount}. Administrator approval is required.`;
      }

      const smallHistory=completed.small.map(row=>({
        id:`S${row.id}`,
        requestId:`SMALL-${String(row.id).padStart(5,'0')}`,
        recordCount:Number(row.record_count||1),
        status:'Allowed',
        reason:row.reason,
        otherReason:row.other_reason||'',
        purpose:'Normal authorized clinical export',
        riskLevel:'Low',
        requestedAt:row.exported_at,
        kind:'Small export'
      }));
      const requestHistory=recentRows.map(row=>({
        id:row.id,
        requestId:`EXP-${String(row.id).padStart(5,'0')}`,
        recordCount:Number(row.record_count||0),
        status:row.status,
        reason:row.reason,
        otherReason:row.other_reason||'',
        purpose:row.purpose||'',
        riskLevel:row.risk_level||'Medium',
        requestedAt:row.requested_at,
        kind:'Approval request'
      }));
      const history=[...smallHistory,...requestHistory]
        .sort((a,b)=>new Date(String(b.requestedAt||'').replace(' ','T')+'Z')-new Date(String(a.requestedAt||'').replace(' ','T')+'Z'))
        .slice(0,30);

      const result=await run(`INSERT INTO batch_export_requests(
        doctor_user_id,doctor_id,doctor_name,section,record_indices,records_json,columns_json,keys_json,
        record_count,reason,other_reason,purpose,risk_level,status,risk_score,low_slow_detected,
        recent_request_count,recent_record_count,previous_rejected_count,risk_explanation,recent_history_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        req.user.id,req.user.doctorId,req.user.fullName,section||'',JSON.stringify(ids),JSON.stringify(selectedRecords),
        JSON.stringify(headers),JSON.stringify(fields),count,reasonText,String(otherReason||'').trim(),String(purpose).trim(),
        context.risk,'Pending Approval',context.score,context.lowSlow?1:0,
        context.priorCount+completed.small.length,
        Math.max(context.cumulativeRecords,policy.projectedRecordCount),
        context.previousRejectedCount,context.explanation,JSON.stringify(history)
      ]);

      const auditAction=context.lowSlow?'LOW_AND_SLOW_BATCH_EXPORT_REQUEST':'MEDIUM_BATCH_EXPORT_REQUEST';
      const auditPoints=context.risk==='Critical'?90:context.risk==='High'?60:25;
      await audit(req.user,auditAction,section||'clinical_record',String(result.id),
        `${count} records requested; ${reasonText}; purpose: ${String(purpose).trim()}; ${context.explanation}`,
        req,context.risk,auditPoints);

      const event={
        id:result.id,
        requestId:`EXP-${String(result.id).padStart(5,'0')}`,
        doctor:req.user.fullName,
        doctorId:req.user.doctorId,
        section:section||'',
        records:count,
        reason:selectedReasons.includes('Other')?`${reasonText} — ${String(otherReason||'').trim()}`:reasonText,
        purpose:String(purpose).trim(),
        risk:context.risk,
        riskScore:context.score,
        lowSlowDetected:context.lowSlow,
        recentRequestCount:context.priorCount+completed.small.length,
        recentRecordCount:Math.max(context.cumulativeRecords,policy.projectedRecordCount),
        previousRejectedCount:context.previousRejectedCount,
        warning:context.explanation,
        recentHistory:history,
        status:'Pending Approval',
        time:new Date().toISOString()
      };
      io.to('admins').emit('communication:batch-export-request',event);
      res.status(201).json({success:true,request:event});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });


  // Phase 3: Administrator accountability for repeated High/Critical
  // "Approve Anyway" decisions.
  async function ensureAdminExportOverrideTable(){
    await run(`CREATE TABLE IF NOT EXISTS admin_export_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      admin_username TEXT,
      admin_name TEXT,
      export_request_id INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      doctor_user_id INTEGER,
      doctor_id TEXT,
      doctor_name TEXT,
      record_count INTEGER,
      request_risk TEXT,
      override_number INTEGER NOT NULL,
      admin_risk_level TEXT NOT NULL,
      evidence_incident_code TEXT,
      escalation_status TEXT DEFAULT 'None',
      created_at TEXT DEFAULT (datetime('now')),
      escalated_at TEXT
    )`);
    await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_export_override_once
      ON admin_export_overrides(admin_user_id,export_request_id)`);
  }

  async function recordAdminUnsafeApproval(admin,row,req){
    await ensureAdminExportOverrideTable();

    const existing=await get(`SELECT * FROM admin_export_overrides
      WHERE admin_user_id=? AND export_request_id=?`,[admin.id,row.id]);
    if(existing){
      return {
        overrideId:existing.id,
        overrideCount:Number(existing.override_number||1),
        riskLevel:existing.admin_risk_level||'Medium',
        requiresEvidence:Number(existing.override_number||1)>=3,
        alreadyRecorded:true
      };
    }

    const prior=await get(`SELECT COUNT(*) AS count FROM admin_export_overrides
      WHERE admin_user_id=? AND created_at>=datetime('now','-30 days')`,[admin.id]);
    const overrideCount=Number(prior?.count||0)+1;
    const adminRisk=overrideCount>=3?'Critical':overrideCount===2?'High':'Medium';
    const requestId=`EXP-${String(row.id).padStart(5,'0')}`;

    const inserted=await run(`INSERT INTO admin_export_overrides(
      admin_user_id,admin_username,admin_name,export_request_id,request_id,
      doctor_user_id,doctor_id,doctor_name,record_count,request_risk,
      override_number,admin_risk_level
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[
      admin.id,admin.username,admin.fullName||'Administrator',row.id,requestId,
      row.doctor_user_id,row.doctor_id,row.doctor_name,row.record_count,row.risk_level||'High',
      overrideCount,adminRisk
    ]);

    const points=overrideCount>=3?100:overrideCount===2?65:30;
    await audit(
      admin,
      overrideCount>=3?'ADMIN_CRITICAL_EXPORT_OVERRIDE':'ADMIN_UNSAFE_EXPORT_OVERRIDE',
      'export_request',
      String(row.id),
      `Administrator used Approve Anyway on ${requestId} (${row.risk_level||'High'} risk) for ${row.doctor_name}. Unsafe override ${overrideCount} of 3 in the 30-day monitoring window.`,
      req,
      adminRisk,
      points
    );

    const historyRows=await all(`SELECT id,request_id,doctor_name,record_count,request_risk,override_number,admin_risk_level,created_at
      FROM admin_export_overrides
      WHERE admin_user_id=? AND created_at>=datetime('now','-30 days')
      ORDER BY id DESC LIMIT 5`,[admin.id]);
    const history=historyRows.map(x=>({
      overrideId:x.id,
      requestId:x.request_id,
      doctor:x.doctor_name,
      records:Number(x.record_count||0),
      requestRisk:x.request_risk,
      overrideNumber:Number(x.override_number||0),
      adminRisk:x.admin_risk_level,
      time:x.created_at
    }));

    let message='Security override recorded. This approval is being monitored.';
    if(overrideCount===2){
      message='Strong warning: this is your second unsafe High/Critical export approval. One more unsafe override will trigger Critical administrator evidence capture and escalation.';
    }else if(overrideCount>=3){
      message='Critical administrator risk detected. Three unsafe High/Critical export approvals have been recorded. Evidence must be preserved before the account is restricted and the incident is escalated.';
    }

    const accountability={
      overrideId:inserted.id,
      overrideCount,
      riskLevel:adminRisk,
      requestId,
      doctor:row.doctor_name,
      doctorId:row.doctor_id,
      records:Number(row.record_count||0),
      requestRisk:row.risk_level||'High',
      message,
      history,
      requiresEvidence:overrideCount>=3
    };

    if(accountability.requiresEvidence){
      accountability.incident={
        actionType:'ADMIN_REPEATED_UNSAFE_EXPORT_APPROVALS',
        actionLabel:'Repeated unsafe export approvals',
        reason:`Administrator ${admin.fullName||admin.username} approved three High/Critical patient-data export warnings using Approve Anyway.`,
        riskLevel:'Critical',
        riskScore:100,
        totalRiskScore:100,
        requestId,
        doctor:row.doctor_name,
        doctorId:row.doctor_id,
        recordCount:Number(row.record_count||0),
        requestRisk:row.risk_level||'High',
        overrideCount,
        overrideHistory:history,
        relatedIncidentCode:requestId,
        originalIncidentCode:requestId,
        suppressAdminAlert:true,
        timestamp:new Date().toISOString()
      };
    }

    return accountability;
  }

  router.get('/batch-export-requests', async (req,res)=>{
    try {
      if(req.user.role!=='admin') return res.status(403).json({success:false,message:'Administrator account required'});
      await ensureBatchExportTable();
      const rows=await all(`SELECT id,doctor_user_id,doctor_id,doctor_name,section,record_indices,records_json,record_count,reason,other_reason,purpose,risk_level,status,requested_at,decided_at,decided_by,rejection_reason,downloaded_at,risk_score,low_slow_detected,recent_request_count,recent_record_count,previous_rejected_count,risk_explanation,recent_history_json FROM batch_export_requests ORDER BY id DESC LIMIT 500`);
      res.json({success:true,requests:rows.map(x=>({...x,request_id:`EXP-${String(x.id).padStart(5,'0')}`}))});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  router.post('/batch-export-requests/:id/decision', async (req,res)=>{
    try {
      if(req.user.role!=='admin') return res.status(403).json({success:false,message:'Administrator account required'});
      await ensureBatchExportTable();
      const id=Number(req.params.id||0), decision=String(req.body?.decision||'');
      if(!['Approved','Rejected'].includes(decision)) return res.status(400).json({success:false,message:'Decision must be Approved or Rejected'});
      const row=await get(`SELECT * FROM batch_export_requests WHERE id=?`,[id]);
      if(!row) return res.status(404).json({success:false,message:'Export request not found'});
      if(row.status!=='Pending Approval') return res.status(409).json({success:false,message:`Request is already ${row.status}`});

      // High/Critical repeated-export requests must use the explicit
      // "Approve Anyway" path. Phase 3 will add accountability/escalation.
      const overrideConfirmed=req.body?.overrideConfirmed===true;
      if(decision==='Approved' && ['High','Critical'].includes(row.risk_level) && !overrideConfirmed){
        return res.status(409).json({
          success:false,
          requiresOverride:true,
          risk:row.risk_level,
          message:'This repeated export request requires explicit Approve Anyway confirmation.'
        });
      }

      const rejectionReason=decision==='Rejected'?String(req.body?.rejectionReason||'').trim():'';
      if(decision==='Rejected'&&rejectionReason.length<3) return res.status(400).json({success:false,message:'A rejection reason is required'});
      await run(`UPDATE batch_export_requests SET status=?,decided_at=datetime('now'),decided_by=?,rejection_reason=? WHERE id=?`,[decision,req.user.fullName||'Administrator',rejectionReason,id]);

      let adminAccountability=null;
      const unsafeOverride=decision==='Approved' && overrideConfirmed && ['High','Critical'].includes(row.risk_level);
      if(unsafeOverride){
        adminAccountability=await recordAdminUnsafeApproval(req.user,row,req);
      }

      const decisionAction=decision==='Approved'
        ?(`${String(row.risk_level||'Medium').toUpperCase()}_BATCH_EXPORT_APPROVED`)
        :(`${String(row.risk_level||'Medium').toUpperCase()}_BATCH_EXPORT_REJECTED`);
      await audit(req.user,decisionAction,'export_request',String(id),
        decision==='Approved'
          ?`Approved ${row.record_count}-record export for ${row.doctor_name}; request risk ${row.risk_level||'Medium'}${unsafeOverride?'; explicit security override used':''}`
          :`Rejected ${row.record_count}-record export for ${row.doctor_name}: ${rejectionReason}`,
        req,unsafeOverride?(adminAccountability?.riskLevel||'Medium'):'Low',unsafeOverride?20:0);

      const event={id,rowId:id,requestId:`EXP-${String(id).padStart(5,'0')}`,doctor:row.doctor_name,doctorId:row.doctor_id,records:row.record_count,risk:row.risk_level||'Medium',status:decision,rejectionReason,decidedBy:req.user.fullName||'Administrator',time:new Date().toISOString()};
      io.to(`user:${row.doctor_user_id}`).emit('communication:batch-export-decision',event);
      io.to('admins').emit('communication:batch-export-updated',event);
      if(adminAccountability) io.to(`user:${req.user.id}`).emit('security:admin-override-accountability',adminAccountability);
      res.json({success:true,request:event,adminAccountability});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });


  router.post('/admin-export-override/:overrideId/finalize-critical', async (req,res)=>{
    try{
      if(req.user.role!=='admin') return res.status(403).json({success:false,message:'Administrator account required'});
      await ensureAdminExportOverrideTable();

      const overrideId=Number(req.params.overrideId||0);
      const evidenceIncidentCode=String(req.body?.evidenceIncidentCode||'').trim();
      if(!overrideId||!evidenceIncidentCode) return res.status(400).json({success:false,message:'Override ID and Admin evidence incident code are required'});

      const override=await get(`SELECT * FROM admin_export_overrides WHERE id=? AND admin_user_id=?`,[overrideId,req.user.id]);
      if(!override) return res.status(404).json({success:false,message:'Administrator override record not found'});
      if(Number(override.override_number||0)<3) return res.status(409).json({success:false,message:'Critical escalation requires three unsafe Administrator overrides'});
      if(override.escalation_status==='Higher Official'){
        return res.json({
          success:true,
          alreadyEscalated:true,
          terminated:true,
          reportedTo:'Higher Official',
          evidenceIncidentCode:override.evidence_incident_code||evidenceIncidentCode
        });
      }

      const evidence=await getEvidenceIncident(evidenceIncidentCode);
      if(!evidence || evidence.role!=='admin' || Number(evidence.user_id)!==Number(req.user.id)){
        return res.status(400).json({success:false,message:'Administrator evidence does not belong to the current Administrator'});
      }
      if(evidence.evidence_status!=='Complete'){
        return res.status(409).json({success:false,message:'Administrator screenshot and session replay must be fully stored before containment'});
      }

      const recent=await all(`SELECT request_id,doctor_name,record_count,request_risk,override_number,admin_risk_level,created_at
        FROM admin_export_overrides
        WHERE admin_user_id=? AND created_at>=datetime('now','-30 days')
        ORDER BY id DESC LIMIT 5`,[req.user.id]);

      const summary=`Critical administrative insider-risk pattern: ${req.user.fullName||req.user.username} used Approve Anyway on three High/Critical patient-data export warnings. Evidence ${evidenceIncidentCode} was preserved and the incident was escalated to a Higher Official.`;
      const incident=await run(`INSERT INTO security_incidents(user_id,username,total_risk_score,severity,status,summary)
        VALUES(?,?,?,?,?,?)`,[req.user.id,req.user.username,100,'Critical','open',summary]);

      await run(`INSERT INTO investigation_reports(incident_id,user_id,doctor_id,title,classification,risk_score,summary,evidence)
        VALUES(?,?,?,?,?,?,?,?)`,[
          incident.id,req.user.id,null,'Critical Administrative Security Override Report',
          'Potential Administrative Insider Threat',100,summary,
          JSON.stringify({
            admin:{id:req.user.id,username:req.user.username,name:req.user.fullName||req.user.username},
            evidenceIncidentCode,
            triggeringRequest:override.request_id,
            overrideCount:Number(override.override_number||3),
            recentOverrides:recent,
            reportedTo:'Higher Official',
            timestamp:new Date().toISOString()
          })
        ]);

      const activeRestriction=await get(`SELECT id FROM account_restrictions WHERE user_id=? AND status='Active' ORDER BY id DESC LIMIT 1`,[req.user.id]);
      if(!activeRestriction){
        await run(`INSERT INTO account_restrictions(user_id,doctor_id,reason,incident_id,status)
          VALUES(?,?,?,?,?)`,[
            req.user.id,null,
            'Critical administrative insider-risk: repeated unsafe approval of High/Critical patient-data export warnings',
            incident.id,'Active'
          ]);
      }

      await run(`UPDATE admin_export_overrides
        SET evidence_incident_code=?,escalation_status='Higher Official',escalated_at=datetime('now')
        WHERE id=?`,[evidenceIncidentCode,overrideId]);

      await run(`INSERT INTO messages(
        sender_user_id,sender_name,sender_role,recipient_user_id,recipient_doctor_id,recipient_role,
        subject,body,category,priority,incident_id
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[
        req.user.id,'WeCare Security Operations','system',null,null,'higher_official',
        'Critical Administrative Security Incident',
        `${summary} Triggering request: ${override.request_id}.`,
        'Critical Security Escalation','Critical',incident.id
      ]);

      await audit(
        req.user,
        'ADMIN_CRITICAL_OVERRIDE_ESCALATED',
        'administrator_security',
        String(incident.id),
        `Three unsafe High/Critical export approvals detected. Admin evidence ${evidenceIncidentCode} preserved; account restricted; escalation sent to Higher Official.`,
        req,
        'Critical',
        100
      );

      const event={
        incidentId:incident.id,
        incidentCode:`ADM-SEC-${String(incident.id).padStart(5,'0')}`,
        adminUserId:req.user.id,
        adminUsername:req.user.username,
        adminName:req.user.fullName||req.user.username,
        overrideCount:Number(override.override_number||3),
        requestId:override.request_id,
        doctor:override.doctor_name,
        records:Number(override.record_count||0),
        requestRisk:override.request_risk,
        risk:'Critical',
        evidenceIncidentCode,
        reportedTo:'Higher Official',
        restricted:true,
        terminated:true,
        time:new Date().toISOString()
      };

      io.emit('security:higher-official-escalation',event);
      io.to(`user:${req.user.id}`).emit('security:admin-session-terminated',event);

      res.json({
        success:true,
        terminated:true,
        restricted:true,
        reportedTo:'Higher Official',
        evidenceIncidentCode,
        incident:event
      });
    }catch(e){
      res.status(500).json({success:false,message:e.message});
    }
  });

  router.get('/batch-export-requests/:id/download', async (req,res)=>{
    try {
      if(req.user.role!=='doctor') return res.status(403).json({success:false,message:'Doctor account required'});
      await ensureBatchExportTable();
      const id=Number(req.params.id||0);
      const row=await get(`SELECT * FROM batch_export_requests WHERE id=? AND doctor_user_id=?`,[id,req.user.id]);
      if(!row) return res.status(404).json({success:false,message:'Export request not found'});
      if(row.status!=='Approved') return res.status(403).json({success:false,message:`Export is ${row.status}. Administrator approval is required before download.`});
      const records=JSON.parse(row.records_json||'[]'), columns=JSON.parse(row.columns_json||'[]'), keys=JSON.parse(row.keys_json||'[]');
      const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;
      const csv=[columns.map(quote).join(','),...records.map(record=>keys.map(k=>quote(record?.[k])).join(','))].join('\n');
      await run(`UPDATE batch_export_requests SET downloaded_at=COALESCE(downloaded_at,datetime('now')) WHERE id=?`,[id]);
      await audit(req.user,'APPROVED_CONTROLLED_EXPORT_DOWNLOADED',row.section||'clinical_record',String(id),`${row.record_count} approved records downloaded`,req,'Low',2);
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="wecare-${String(row.section||'records').replace(/[^a-z0-9_-]/gi,'-')}-${String(id).padStart(5,'0')}.csv"`);
      res.send(csv);
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  router.post('/export-all', async (req,res)=>{
    try {
      if(req.user.role!=='doctor') return res.status(403).json({success:false,message:'Doctor account required'});
      const requestedCount=Number(req.body.requestedCount||6000);
      const reasons=['Bulk export of all patient records','Access volume far above personal baseline','Cross-department data request','Potential data exfiltration'];
      await audit(req.user,'EXPORT_ALL_ATTEMPT','patient_records','ALL',reasons.join('; '),req,'Critical',100);
      const incident=await run(`INSERT INTO security_incidents (user_id,username,total_risk_score,severity,status,summary) VALUES (?,?,?,?,?,?)`,[req.user.id,req.user.username,100,'Critical','open',`Suspected unauthorized bulk data export: ${requestedCount} records requested. Export blocked; evidence capture required before containment.`]);
      await run(`INSERT INTO investigation_reports (incident_id,user_id,doctor_id,title,classification,risk_score,summary,evidence) VALUES (?,?,?,?,?,?,?,?)`,[incident.id,req.user.id,req.user.doctorId,'Suspected Unauthorized Bulk Data Export Report','Potential Insider Threat',100,'The doctor attempted a bulk export. No export file was delivered. Evidence capture must complete before the account is restricted.',JSON.stringify({requestedCount,action:'EXPORT_ALL',result:'BLOCKED',reasons,ip:req.ip,device:req.headers['user-agent'],timestamp:new Date().toISOString()})]);

      const event={
        incidentId:incident.id,
        userId:req.user.id,
        username:req.user.username,
        fullName:req.user.fullName,
        doctorId:req.user.doctorId,
        doctor:req.user.fullName,
        department:req.user.department,
        role:req.user.role,
        actionType:'BULK_EXPORT_ATTEMPT',
        actionLabel:'Bulk patient data export',
        requestedCount,
        risk:'Critical',
        riskLevel:'Critical',
        totalRiskScore:100,
        result:'Blocked',
        reason:reasons.join('; '),
        time:new Date().toISOString(),
        timestamp:new Date().toISOString(),
        requiresEvidence:true
      };

      // Tell only the suspicious Doctor browser to preserve evidence.  Admin is
      // notified by evidenceRoutes only after the media has physically saved.
      io.to(`user:${req.user.id}`).emit('security:critical-alert',event);
      return res.status(403).json({
        success:false,
        terminated:false,
        requiresEvidence:true,
        incidentId:incident.id,
        message:'Critical bulk export blocked. Preserving evidence before the session is terminated.',
        incident:event
      });
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  router.post('/finalize-critical', async (req,res)=>{
    try {
      if(req.user.role!=='doctor') return res.status(403).json({success:false,message:'Doctor account required'});
      const incidentId=Number(req.body.incidentId||0);
      if(!incidentId) return res.status(400).json({success:false,message:'incidentId is required'});
      const incident=await get(`SELECT * FROM security_incidents WHERE id=? AND user_id=?`,[incidentId,req.user.id]);
      if(!incident) return res.status(404).json({success:false,message:'Incident not found'});

      const existing=await get(`SELECT id FROM account_restrictions WHERE user_id=? AND incident_id=? AND status='Active'`,[req.user.id,incidentId]);
      if(!existing){
        await run(`INSERT INTO account_restrictions(user_id,doctor_id,reason,incident_id,status) VALUES(?,?,?,?,?)`,[req.user.id,req.user.doctorId,'Critical bulk patient-data export attempt',incidentId,'Active']);
      }
      await run(`UPDATE security_incidents SET status='contained' WHERE id=?`,[incidentId]);
      await run(`INSERT INTO messages(sender_name,sender_role,recipient_user_id,recipient_doctor_id,recipient_role,subject,body,category,priority,incident_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,['WeCare Security','admin',req.user.id,req.user.doctorId,'doctor','Critical security restriction',`Bulk export incident INC-${String(incidentId).padStart(5,'0')} was blocked. Evidence was preserved and your session has been restricted pending administrator review.`,'Security Notice','Critical',incidentId]);

      io.to(`user:${req.user.id}`).emit('security:insider-contained',{
        incidentId,doctorId:req.user.doctorId,doctor:req.user.fullName,
        action:'Bulk patient data export',requestedCount:Number(req.body.requestedCount||0),
        risk:'Critical',response:'Export blocked; evidence preserved; session terminated',
        terminated:true,time:new Date().toISOString()
      });
      res.json({success:true,terminated:true,incidentId,message:'Evidence preserved. Doctor session terminated and account restricted pending review.'});
    } catch(e){ res.status(500).json({success:false,message:e.message}); }
  });

  return router;
};
