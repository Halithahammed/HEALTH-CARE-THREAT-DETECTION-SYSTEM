const db = require('../database/database');
const IsolationForest = require('./isolationForest');

let model = null;
let modelMeta = null;
const FEATURES = ['login_hour','session_minutes','records_viewed','downloads','departments_accessed','failed_logins','unknown_device','external_ip','after_hours','export_all'];
const qAll=(sql,p=[])=>new Promise((resolve,reject)=>db.all(sql,p,(e,r)=>e?reject(e):resolve(r)));
const qGet=(sql,p=[])=>new Promise((resolve,reject)=>db.get(sql,p,(e,r)=>e?reject(e):resolve(r)));
const qRun=(sql,p=[])=>new Promise((resolve,reject)=>db.run(sql,p,function(e){e?reject(e):resolve(this)}));
const vector = r => FEATURES.map(f => Number(r[f] || 0));

async function trainModel() {
  const rows = await qAll(`SELECT ${FEATURES.join(',')} FROM behavior_samples WHERE label='normal' ORDER BY RANDOM() LIMIT 12000`);
  if (rows.length < 100) throw new Error('Generate the historical dataset first');
  model = new IsolationForest({trees:100,sampleSize:256}).fit(rows.map(vector));
  const version = `IF-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-5)}`;
  modelMeta = {version, trainedAt:new Date().toISOString(), samples:rows.length, trees:100, features:FEATURES};
  await qRun(`INSERT INTO ml_models(version,algorithm,training_samples,feature_count,status,metrics,trained_at) VALUES(?,?,?,?,?,?,datetime('now'))`,
    [version,'Isolation Forest',rows.length,FEATURES.length,'Active',JSON.stringify({trees:100,sampleSize:256,contamination:'adaptive'})]);
  return modelMeta;
}

function explain(input, baseline) {
  const reasons=[];
  const b=baseline||{};
  if(input.login_hour < 5 || input.login_hour > 23) reasons.push('Login occurred outside normal working hours');
  if(input.unknown_device) reasons.push('Unrecognized device');
  if(input.external_ip) reasons.push('Connection originated outside the hospital network');
  if(input.records_viewed > Math.max(80,(b.avg_records||20)*4)) reasons.push(`Record access volume (${input.records_viewed}) exceeded the behavioral baseline`);
  if(input.downloads > Math.max(10,(b.avg_downloads||2)*5)) reasons.push(`Download volume (${input.downloads}) exceeded the behavioral baseline`);
  if(input.departments_accessed > 3) reasons.push('Cross-department access pattern');
  if(input.failed_logins >= 3) reasons.push('Repeated failed authentication attempts');
  if(input.export_all) reasons.push('Export All operation requested');
  return reasons.length?reasons:['Combined behavior deviated from the learned baseline'];
}

async function predict(input) {
  if(!model) await trainModel();
  const score = model.score(vector(input));
  const anomaly = Math.max(0,Math.min(1,(score-0.42)/0.28));
  let risk='Low'; if(anomaly>=.35)risk='Medium'; if(anomaly>=.60)risk='High'; if(anomaly>=.78)risk='Critical';
  const baseline=await qGet(`SELECT * FROM doctor_baselines WHERE doctor_id=?`,[input.doctor_id]);
  const reasons=explain(input,baseline);
  const result={doctorId:input.doctor_id, anomalyScore:Number(anomaly.toFixed(3)), rawScore:Number(score.toFixed(3)), confidence:Math.round(70+anomaly*29), risk, prediction:anomaly>=.35?'Anomalous':'Normal', reasons, modelVersion:modelMeta.version};
  await qRun(`INSERT INTO ml_predictions(doctor_id,model_version,anomaly_score,confidence,risk_level,prediction,reasons,feature_vector,created_at) VALUES(?,?,?,?,?,?,?,?,datetime('now'))`,
    [input.doctor_id,modelMeta.version,result.anomalyScore,result.confidence,risk,result.prediction,JSON.stringify(reasons),JSON.stringify(input)]);
  return result;
}

async function status(){
  const latest=await qGet(`SELECT * FROM ml_models ORDER BY id DESC LIMIT 1`);
  const counts=await qGet(`SELECT COUNT(*) samples, COUNT(DISTINCT doctor_id) doctors FROM behavior_samples`);
  const predictions=await qGet(`SELECT COUNT(*) total, SUM(CASE WHEN risk_level IN ('High','Critical') THEN 1 ELSE 0 END) escalated FROM ml_predictions`);
  return {active:Boolean(model), model:modelMeta||latest, dataset:counts, predictions};
}

module.exports={trainModel,predict,status,FEATURES,qAll,qGet,qRun};
