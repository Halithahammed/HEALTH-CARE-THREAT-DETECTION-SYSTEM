// services/activityService.js
// Shared activity-logging + risk-scoring logic used by the activity routes.
// Centralized so the HTTP route, attack simulation, and future callers all
// apply identical scoring and event emission.

const db = require("../database/database");
const {
  getRule,
  riskLevelForScore,
  riskColor,
  explainPoints,
  MAX_SCORE,
} = require("./riskEngine");
const {
  emitActivityNew,
  emitRiskUpdated,
  emitHighRiskAlert,
  emitCriticalAlert,
} = require("./socketService");

// Wraps sqlite3 db.run in a Promise.
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Wraps sqlite3 db.get in a Promise.
function getRow(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

// Wraps sqlite3 db.all in a Promise.
function allRows(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// Returns the doctor's current total session risk score (sum of all activity).
function getSessionScore(userId) {
  return getRow(
    "SELECT COALESCE(SUM(risk_points), 0) AS total FROM activity_logs WHERE user_id = ?",
    [userId]
  ).then((row) => Math.min(row.total, MAX_SCORE));
}

// Inserts one activity log row, recomputes the session score, emits the
// real-time events, and creates a security incident when the score is critical.
async function recordActivity({ user, actionType, resourceType, resourceId, department, ipAddress, deviceInfo, io }) {
  const rule = getRule(actionType);
  if (!rule) {
    const err = new Error("Invalid action type");
    err.code = "INVALID_ACTION";
    throw err;
  }

  const safeIp = ipAddress || "unknown";
  const safeDevice = deviceInfo || "unknown";

  // Insert the activity log (risk points come from the server-side rule).
  const result = await runQuery(
    `INSERT INTO activity_logs
       (user_id, username, doctor_id, action_type, resource_type, resource_id,
        department, ip_address, device_info, risk_points, risk_level, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.username,
      user.doctorId || null,
      actionType,
      resourceType || rule.resourceType,
      resourceId || null,
      department || user.department || null,
      safeIp,
      safeDevice,
      rule.points,
      riskLevelForScore(await getSessionScore(user.id).then((s) => s + rule.points)),
      explainPoints(actionType),
    ]
  );

  const activityId = result.lastID;
  const totalScore = await getSessionScore(user.id);
  const level = riskLevelForScore(totalScore);
  const color = riskColor(level);
  const reason = explainPoints(actionType);

  const activityPayload = {
    activityId,
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    doctorId: user.doctorId,
    department: department || user.department,
    actionType,
    actionLabel: rule.reason,
    resourceType: resourceType || rule.resourceType,
    resourceId: resourceId || null,
    riskPoints: rule.points,
    totalRiskScore: totalScore,
    riskLevel: level,
    riskColor: color,
    reason,
    ipAddress: safeIp,
    deviceInfo: safeDevice,
    timestamp: new Date().toISOString(),
  };

  if (io) {
    emitActivityNew(io, activityPayload);

    emitRiskUpdated(io, {
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      doctorId: user.doctorId,
      department: user.department,
      totalRiskScore: totalScore,
      riskLevel: level,
      riskColor: color,
      timestamp: new Date().toISOString(),
    });

    if (totalScore >= 60 && totalScore < 80) {
      emitHighRiskAlert(io, activityPayload);
    }

    if (totalScore >= 80) {
      const summary = `${user.fullName} (${user.doctorId || user.username}) reached ${totalScore} risk points — ${level}.`;
      await runQuery(
        `INSERT INTO security_incidents (user_id, username, total_risk_score, severity, status, summary)
         VALUES (?, ?, ?, ?, 'open', ?)`,
        [user.id, user.username, totalScore, level, summary]
      );
      emitCriticalAlert(io, { ...activityPayload, summary });
    }
  }

  return activityPayload;
}

// Clears the demo activity + incidents for a single doctor.
async function resetDemo(userId) {
  await runQuery("DELETE FROM activity_logs WHERE user_id = ?", [userId]);
  await runQuery("DELETE FROM security_incidents WHERE user_id = ?", [userId]);
}

module.exports = { recordActivity, getSessionScore, resetDemo, runQuery, getRow, allRows };
