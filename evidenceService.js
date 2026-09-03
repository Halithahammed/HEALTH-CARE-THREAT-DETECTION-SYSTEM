const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const vaultRoot = path.join(__dirname, '..', 'EvidenceVault');
const dbPath = path.join(__dirname, '..', 'database', 'evidence.db');
fs.mkdirSync(vaultRoot, { recursive: true });
const evidenceDb = new sqlite3.Database(dbPath);
evidenceDb.serialize(() => {
  evidenceDb.run(`CREATE TABLE IF NOT EXISTS evidence_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_code TEXT UNIQUE NOT NULL,
    user_id INTEGER,
    username TEXT,
    full_name TEXT,
    role TEXT NOT NULL,
    doctor_id TEXT,
    department TEXT,
    action_type TEXT,
    risk_level TEXT NOT NULL,
    risk_score INTEGER,
    reason TEXT,
    evidence_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    dismissal_count INTEGER DEFAULT 0,
    acknowledgement_status TEXT DEFAULT 'Pending',
    escalation_status TEXT DEFAULT 'None',
    escalated_at DATETIME,
    related_incident_code TEXT,
    evidence_status TEXT DEFAULT 'Pending'
  )`);
  // Safe additive migrations for evidence.db files created by older builds.
  for (const sql of [
    `ALTER TABLE evidence_incidents ADD COLUMN dismissal_count INTEGER DEFAULT 0`,
    `ALTER TABLE evidence_incidents ADD COLUMN acknowledgement_status TEXT DEFAULT 'Pending'`,
    `ALTER TABLE evidence_incidents ADD COLUMN escalation_status TEXT DEFAULT 'None'`,
    `ALTER TABLE evidence_incidents ADD COLUMN escalated_at DATETIME`,
    `ALTER TABLE evidence_incidents ADD COLUMN related_incident_code TEXT`,
    `ALTER TABLE evidence_incidents ADD COLUMN evidence_status TEXT DEFAULT 'Pending'`
  ]) evidenceDb.run(sql, () => {});
  evidenceDb.run(`CREATE TABLE IF NOT EXISTS alert_dismissals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_code TEXT NOT NULL,
    admin_user_id INTEGER,
    admin_username TEXT,
    admin_full_name TEXT,
    dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const safe = v => String(v || 'unknown').replace(/[^a-z0-9_.-]/gi, '_');
function run(sql, params=[]) { return new Promise((resolve,reject)=>evidenceDb.run(sql,params,function(err){err?reject(err):resolve(this)})); }
function all(sql, params=[]) { return new Promise((resolve,reject)=>evidenceDb.all(sql,params,(err,rows)=>err?reject(err):resolve(rows))); }
function get(sql, params=[]) { return new Promise((resolve,reject)=>evidenceDb.get(sql,params,(err,row)=>err?reject(err):resolve(row))); }
function nextCode(role){return `${role==='admin'?'ADM':'DOC'}-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;}
function decodeDataUrl(dataUrl){
  if(!dataUrl || typeof dataUrl!=='string') return null;
  const m=dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/); if(!m)return null;
  return {ext:m[1]==='jpeg'?'jpg':'png', buffer:Buffer.from(m[2],'base64')};
}
async function saveEvidence({user, incident, screenshot, recording, replay, timeline, pageSnapshot}){
  const role=user.role==='admin'?'admin':'doctor';
  const code=incident.incidentCode || (incident.incidentId ? `INC-${String(incident.incidentId).padStart(5,'0')}` : nextCode(role));
  const folder=path.join(vaultRoot, role==='admin'?'Admin':'Doctor', safe(code)); fs.mkdirSync(folder,{recursive:true});
  const files=[];
  const write=(name,data)=>{const b=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data,null,2));fs.writeFileSync(path.join(folder,name),b);files.push({name,sha256:sha(b),bytes:b.length});};
  const img=decodeDataUrl(screenshot); if(img) write(`screenshot.${img.ext}`,img.buffer);
  if(recording && typeof recording==='string'){ const m=recording.match(/^data:video\/webm(?:;[^,]*)?;base64,(.+)$/); if(m) write('recording.webm',Buffer.from(m[1],'base64')); }
  if(pageSnapshot) write('page-snapshot.html',pageSnapshot);
  write('replay.json', replay||[]); write('timeline.json', timeline||[]);
  write('incident.json',{incidentCode:code,user:{id:user.id,username:user.username,fullName:user.fullName,role:user.role,doctorId:user.doctorId,department:user.department},incident,createdAt:new Date().toISOString()});
  const hasScreenshot=files.some(f=>/^screenshot\.(png|jpg)$/.test(f.name) && f.bytes>4096);
  const hasRecording=files.some(f=>f.name==='recording.webm' && f.bytes>2048);
  const hasReplay=files.some(f=>f.name==='replay.json' && f.bytes>128);
  const evidenceStatus=hasScreenshot && hasReplay ? 'Complete' : 'Partial';
  write('manifest.json',{incidentCode:code,readOnly:true,evidenceStatus,hasScreenshot,hasRecording,hasReplay,files,createdAt:new Date().toISOString()});
  await run(`INSERT OR REPLACE INTO evidence_incidents(incident_code,user_id,username,full_name,role,doctor_id,department,action_type,risk_level,risk_score,reason,evidence_path,related_incident_code,evidence_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    code,user.id,user.username,user.fullName,role,user.doctorId||null,user.department||null,incident.actionType||null,incident.riskLevel||'High',incident.totalRiskScore||incident.riskScore||0,incident.reason||incident.summary||'',folder,incident.originalIncidentCode||incident.relatedIncidentCode||null,evidenceStatus
  ]);
  return {incidentCode:code,files,evidenceStatus,hasScreenshot,hasRecording,hasReplay};
}

async function recordAlertDismissal({incidentCode, adminUser}){
  if(!incidentCode) throw new Error('Incident code is required');
  const original=await get(`SELECT acknowledgement_status, escalation_status FROM evidence_incidents WHERE incident_code=?`,[incidentCode]);
  if(!original) throw new Error('Evidence incident not found');
  if(original.acknowledgement_status==='Reviewed') return {dismissalCount:0,reviewed:true,requiresEscalation:false};
  if(original.escalation_status==='Higher Official'){
    const row=await get(`SELECT COUNT(*) AS count FROM alert_dismissals WHERE incident_code=?`,[incidentCode]);
    return {dismissalCount:Number(row?.count||3),escalated:true,requiresEscalation:false};
  }
  const identity=adminUser?.id!=null ? `id:${adminUser.id}` : `user:${adminUser?.username||'admin'}`;
  const existing=await get(`SELECT COUNT(*) AS count FROM alert_dismissals WHERE incident_code=? AND (admin_user_id=? OR admin_username=?)`,[incidentCode,adminUser?.id||-1,adminUser?.username||'admin']);
  let count=Number(existing?.count||0);
  if(count<3){
    await run(`INSERT INTO alert_dismissals(incident_code,admin_user_id,admin_username,admin_full_name) VALUES(?,?,?,?)`,[
      incidentCode,adminUser?.id||null,adminUser?.username||'admin',adminUser?.fullName||adminUser?.username||'Admin'
    ]);
    count+=1;
  }
  await run(`UPDATE evidence_incidents SET dismissal_count=? WHERE incident_code=?`,[count,incidentCode]);
  return {dismissalCount:count,requiresEscalation:count>=3,identity};
}

async function finalizeEscalation({incidentCode, adminEvidenceIncidentCode}){
  if(!incidentCode) throw new Error('Incident code is required');
  if(!adminEvidenceIncidentCode) throw new Error('Admin evidence incident code is required');
  const adminEvidence=await get(`SELECT evidence_status FROM evidence_incidents WHERE incident_code=?`,[adminEvidenceIncidentCode]);
  if(!adminEvidence) throw new Error('Admin evidence was not stored');
  await run(`UPDATE evidence_incidents SET acknowledgement_status='Failed', escalation_status='Higher Official', escalated_at=? WHERE incident_code=?`,[new Date().toISOString(),incidentCode]);
  return {escalated:true,reportedTo:'Higher Official',adminEvidenceIncidentCode,evidenceStatus:adminEvidence.evidence_status};
}

async function acknowledgeIncident({incidentCode}){
  if(!incidentCode) return;
  await run(`UPDATE evidence_incidents SET acknowledgement_status='Reviewed' WHERE incident_code=? AND escalation_status!='Higher Official'`,[incidentCode]);
}

async function getDismissals(code){return all(`SELECT admin_full_name,admin_username,dismissed_at FROM alert_dismissals WHERE incident_code=? ORDER BY id ASC`,[code]);}

async function listIncidents(){return all('SELECT * FROM evidence_incidents ORDER BY id DESC LIMIT 500');}
async function getIncident(code){return get('SELECT * FROM evidence_incidents WHERE incident_code=?',[code]);}
function readFileSafe(row,name){const base=path.resolve(row.evidence_path),target=path.resolve(base,name);if(!target.startsWith(base+path.sep))throw Error('Invalid evidence file');return fs.readFileSync(target);}
module.exports={saveEvidence,listIncidents,getIncident,getDismissals,readFileSafe,recordAlertDismissal,finalizeEscalation,acknowledgeIncident,vaultRoot,dbPath};
