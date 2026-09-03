// services/sessionService.js
// Phase 3A: session identity, device fingerprinting, trusted-device logic,
// concurrent-session detection, and active-session tracking.
//
// All trust and risk decisions are made here on the backend. The frontend
// device label is display-only and never determines trust status.

const crypto = require("crypto");
const db = require("../database/database");

const { runQuery, getRow, allRows } = require("./activityService");

// Generates a cryptographically secure random hex ID.
function generateSecureId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

// Normalizes IPv4-mapped IPv6 addresses (::ffff:127.0.0.1 -> 127.0.0.1)
// and trims any leading brackets from bracketed IPv6.
function normalizeIp(ip) {
  if (!ip || ip === "unknown") return "unknown";
  let cleaned = ip.trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("::ffff:")) {
    cleaned = cleaned.slice(7);
  }
  return cleaned;
}

// Extracts the client IP, preferring x-forwarded-for then req.ip.
function extractIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return normalizeIp(forwarded.split(",")[0].trim());
  }
  if (req.ip) return normalizeIp(req.ip);
  if (req.socket && req.socket.remoteAddress) return normalizeIp(req.socket.remoteAddress);
  if (req.handshake && req.handshake.address) return normalizeIp(req.handshake.address);
  return "unknown";
}

// Parses a User-Agent string into a browser + OS label (demo-grade, no
// invasive fingerprinting).
function parseUserAgent(userAgent) {
  const ua = userAgent || "unknown";
  let browser = "Unknown";
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";

  let os = "Unknown";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os|macintosh|iphone|ipad/i.test(ua)) os = "macOS/iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  return { browser, os };
}

// Generates a stable, privacy-safe device ID from server-side signals.
// Combines User-Agent + browser + OS, then SHA-256 hashes the result.
function generateDeviceId(userAgent, browser, os) {
  const fingerprint = [userAgent || "unknown", browser || "unknown", os || "unknown"].join("|");
  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

// Returns a human-readable device label, using the frontend-supplied label
// when available, otherwise a generated label from browser + OS.
function resolveDeviceName(frontendLabel, browser, os) {
  if (frontendLabel && frontendLabel.trim()) return frontendLabel.trim();
  return `${browser} on ${os}`;
}

// Returns true if the given device_id is already trusted for this user.
async function isTrustedDevice(userId, deviceId) {
  const row = await getRow(
    "SELECT id FROM trusted_devices WHERE user_id = ? AND device_id = ? AND is_blocked = 0",
    [userId, deviceId]
  );
  return !!row;
}

// Registers a device as trusted for a user. Called on first login only.
async function registerTrustedDevice({ userId, doctorId, deviceId, deviceName, browser, os }) {
  await runQuery(
    `INSERT INTO trusted_devices (user_id, doctor_id, device_id, device_name, browser, operating_system)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, doctorId || null, deviceId, deviceName, browser, os]
  );
}

// Returns the count of active sessions for a user (excluding a given session).
async function countActiveSessions(userId, excludeSessionId) {
  const row = await getRow(
    "SELECT COUNT(*) AS cnt FROM active_sessions WHERE user_id = ? AND status = 'active' AND session_id != ?",
    [userId, excludeSessionId || ""]
  );
  return row ? row.cnt : 0;
}

// Creates an active_sessions row for a doctor login.
async function createActiveSession({
  userId, username, doctorId, jwtId, sessionId, ipAddress, deviceId, deviceName,
  browser, os, userAgent, isTrusted, isSuspicious,
}) {
  const result = await runQuery(
    `INSERT INTO active_sessions
       (session_id, user_id, username, doctor_id, jwt_id, ip_address, device_id,
        device_name, browser, operating_system, user_agent, is_trusted, is_suspicious, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [sessionId, userId, username, doctorId || null, jwtId, ipAddress, deviceId,
     deviceName, browser, os, userAgent, isTrusted ? 1 : 0, isSuspicious ? 1 : 0]
  );
  return result.lastID;
}

// Updates last_activity for the current session on every authenticated request.
async function touchSession(sessionId) {
  if (!sessionId) return;
  await runQuery(
    "UPDATE active_sessions SET last_activity = datetime('now') WHERE session_id = ? AND status = 'active'",
    [sessionId]
  );
}

// Marks a session as logged_out (used on logout).
async function markSessionLoggedOut(sessionId) {
  if (!sessionId) return;
  await runQuery(
    "UPDATE active_sessions SET status = 'logged_out', logout_time = datetime('now') WHERE session_id = ?",
    [sessionId]
  );
}

// Fetches all sessions for a doctor (for the doctor's own view).
async function getSessionsForUser(userId) {
  return allRows(
    `SELECT session_id, user_id, username, doctor_id, ip_address, device_name, browser,
            operating_system, is_trusted, is_suspicious, status, login_time,
            last_activity, logout_time
     FROM active_sessions
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 50`,
    [userId]
  );
}

// Fetches all recent sessions (for the admin view).
async function getAllSessions() {
  return allRows(
    `SELECT s.session_id, s.user_id, s.username, s.doctor_id, s.ip_address,
            s.device_name, s.browser, s.operating_system, s.is_trusted,
            s.is_suspicious, s.status, s.login_time, s.last_activity, s.logout_time,
            u.full_name
     FROM active_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     ORDER BY s.id DESC
     LIMIT 200`,
    []
  );
}

// Strips sensitive fields (jwt_id) before sending sessions to any client.
function sanitizeSession(row) {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    fullName: row.full_name,
    doctorId: row.doctor_id,
    ipAddress: row.ip_address,
    deviceName: row.device_name,
    browser: row.browser,
    operatingSystem: row.operating_system,
    isTrusted: !!row.is_trusted,
    isSuspicious: !!row.is_suspicious,
    status: row.status,
    loginTime: row.login_time,
    lastActivity: row.last_activity,
    logoutTime: row.logout_time,
  };
}

// ===== Phase 3B additions =====

// Returns true if the given jti is in the revoked_tokens table.
async function isJwtRevoked(jti) {
  const row = await getRow(
    "SELECT id FROM revoked_tokens WHERE jwt_id = ?",
    [jti]
  );
  return !!row;
}

// Returns true if the session is still active.
async function isSessionActive(sessionId) {
  const row = await getRow(
    "SELECT status FROM active_sessions WHERE session_id = ?",
    [sessionId]
  );
  if (!row) return false;
  return row.status === "active";
}

// Terminates a session: marks it terminated + records a session event.
async function terminateSession(sessionId, reason) {
  if (!sessionId) return;
  await runQuery(
    "UPDATE active_sessions SET status = 'terminated', logout_time = datetime('now') WHERE session_id = ?",
    [sessionId]
  );
  await addSessionEvent(sessionId, "session_terminated", reason || "Terminated by security");
}

// Revokes a JWT by inserting its jti into revoked_tokens.
async function revokeJwt(jti, sessionId, userId, reason) {
  await runQuery(
    `INSERT INTO revoked_tokens (jwt_id, session_id, user_id, reason)
     VALUES (?, ?, ?, ?)`,
    [jti, sessionId || null, userId || null, reason || "Revoked"]
  );
}

// Fetches the jwt_id + user_id for a session (needed for revocation).
async function getSessionById(sessionId) {
  return getRow("SELECT * FROM active_sessions WHERE session_id = ?", [sessionId]);
}

// Fetches the trusted (active) session for a doctor (the first active trusted session).
async function getTrustedSessionForDoctor(userId) {
  return getRow(
    "SELECT * FROM active_sessions WHERE user_id = ? AND is_trusted = 1 AND status = 'active' ORDER BY id ASC LIMIT 1",
    [userId]
  );
}

// ----- Trusted-device management -----
async function trustDevice(userId, deviceId) {
  await runQuery(
    "UPDATE trusted_devices SET is_blocked = 0 WHERE user_id = ? AND device_id = ?",
    [userId, deviceId]
  );
}

async function untrustDevice(userId, deviceId) {
  await runQuery(
    "DELETE FROM trusted_devices WHERE user_id = ? AND device_id = ?",
    [userId, deviceId]
  );
}

async function blockDevice(userId, deviceId) {
  await runQuery(
    "UPDATE trusted_devices SET is_blocked = 1 WHERE user_id = ? AND device_id = ?",
    [userId, deviceId]
  );
}

async function unblockDevice(userId, deviceId) {
  await runQuery(
    "UPDATE trusted_devices SET is_blocked = 0 WHERE user_id = ? AND device_id = ?",
    [userId, deviceId]
  );
}

// Adds a device to trusted_devices (used when admin trusts or doctor confirms).
async function trustDeviceByInsert({ userId, doctorId, deviceId, deviceName, browser, os }) {
  const existing = await getRow(
    "SELECT id FROM trusted_devices WHERE user_id = ? AND device_id = ?",
    [userId, deviceId]
  );
  if (existing) {
    await runQuery(
      "UPDATE trusted_devices SET is_blocked = 0 WHERE id = ?",
      [existing.id]
    );
  } else {
    await registerTrustedDevice({ userId, doctorId, deviceId, deviceName, browser, os });
  }
  // Mark the session as trusted too.
  await runQuery(
    "UPDATE active_sessions SET is_trusted = 1, is_suspicious = 0 WHERE device_id = ? AND user_id = ? AND status = 'active'",
    [deviceId, userId]
  );
}

// Fetches all trusted devices with user names for the admin page.
async function getAllTrustedDevices() {
  return allRows(
    `SELECT t.id, t.user_id, t.doctor_id, t.device_id, t.device_name, t.browser,
            t.operating_system, t.first_seen, t.last_seen, t.is_blocked,
            t.created_at, u.full_name, u.username
     FROM trusted_devices t
     LEFT JOIN users u ON u.id = t.user_id
     ORDER BY t.id DESC
     LIMIT 200`,
    []
  );
}

// Fetches trusted devices for a single user.
async function getTrustedDevicesForUser(userId) {
  return allRows(
    "SELECT * FROM trusted_devices WHERE user_id = ? ORDER BY id DESC",
    [userId]
  );
}

// ----- Session verification -----
async function createVerification({
  doctorId, userId, trustedSessionId, suspiciousSessionId,
}) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const result = await runQuery(
    `INSERT INTO session_verifications
       (doctor_id, user_id, trusted_session_id, suspicious_session_id, status, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [doctorId, userId, trustedSessionId, suspiciousSessionId, expiresAt]
  );
  const row = await getRow("SELECT * FROM session_verifications WHERE id = ?", [result.lastID]);
  return row;
}

async function getVerificationById(id) {
  return getRow("SELECT * FROM session_verifications WHERE id = ?", [id]);
}

async function getPendingVerificationsForUser(userId) {
  return allRows(
    `SELECT v.*, s.device_name, s.browser, s.operating_system, s.ip_address, s.login_time
     FROM session_verifications v
     LEFT JOIN active_sessions s ON s.session_id = v.suspicious_session_id
     WHERE v.user_id = ? AND v.status = 'pending'
     ORDER BY v.id DESC`,
    [userId]
  );
}

async function updateVerificationStatus(id, status) {
  await runQuery(
    "UPDATE session_verifications SET status = ?, responded_at = datetime('now') WHERE id = ?",
    [status, id]
  );
}

// Expires pending verifications whose expires_at has passed.
async function expireOldVerifications() {
  await runQuery(
    "UPDATE session_verifications SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')",
    []
  );
}

// ----- Audit logs -----
async function addAuditLog({ userId, doctorId, action, ipAddress, browser, os, deviceName, details }) {
  await runQuery(
    `INSERT INTO audit_logs (user_id, doctor_id, action, ip_address, browser, operating_system, device_name, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId || null, doctorId || null, action, ipAddress || null, browser || null,
     os || null, deviceName || null, details || null]
  );
}

async function getAllAuditLogs() {
  return allRows(
    `SELECT a.id, a.user_id, a.doctor_id, a.action, a.ip_address, a.browser,
            a.operating_system, a.device_name, a.details, a.created_at,
            u.full_name, u.username
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC
     LIMIT 200`,
    []
  );
}

// ----- Session timeline events -----
async function addSessionEvent(sessionId, eventType, details) {
  const session = await getSessionById(sessionId);
  await runQuery(
    `INSERT INTO session_events (session_id, user_id, doctor_id, event_type, details)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, session ? session.user_id : null, session ? session.doctor_id : null,
     eventType, details || null]
  );
}

async function getSessionEvents(sessionId) {
  return allRows(
    "SELECT id, session_id, event_type, details, created_at FROM session_events WHERE session_id = ? ORDER BY id ASC",
    [sessionId]
  );
}

// ----- Mobile device registration -----
async function registerMobileDevice({ doctorId, userId, deviceId, deviceLabel }) {
  const existing = await getRow(
    "SELECT id FROM doctor_mobile_devices WHERE doctor_id = ? AND device_id = ?",
    [doctorId, deviceId]
  );
  if (existing) {
    await runQuery(
      "UPDATE doctor_mobile_devices SET last_seen = datetime('now'), is_registered = 1, device_label = ? WHERE id = ?",
      [deviceLabel || null, existing.id]
    );
    return existing.id;
  }
  const result = await runQuery(
    `INSERT INTO doctor_mobile_devices (doctor_id, user_id, device_id, device_label)
     VALUES (?, ?, ?, ?)`,
    [doctorId, userId, deviceId, deviceLabel || null]
  );
  return result.lastID;
}

async function getMobileDevicesForDoctor(doctorId) {
  return allRows(
    "SELECT * FROM doctor_mobile_devices WHERE doctor_id = ? AND is_registered = 1 ORDER BY id DESC",
    [doctorId]
  );
}

module.exports = {
  generateSecureId,
  normalizeIp,
  extractIp,
  parseUserAgent,
  generateDeviceId,
  resolveDeviceName,
  isTrustedDevice,
  registerTrustedDevice,
  countActiveSessions,
  createActiveSession,
  touchSession,
  markSessionLoggedOut,
  getSessionsForUser,
  getAllSessions,
  sanitizeSession,
  // Phase 3B
  isJwtRevoked,
  isSessionActive,
  terminateSession,
  revokeJwt,
  getSessionById,
  getTrustedSessionForDoctor,
  trustDevice,
  untrustDevice,
  blockDevice,
  unblockDevice,
  trustDeviceByInsert,
  getAllTrustedDevices,
  getTrustedDevicesForUser,
  createVerification,
  getVerificationById,
  getPendingVerificationsForUser,
  updateVerificationStatus,
  expireOldVerifications,
  addAuditLog,
  getAllAuditLogs,
  addSessionEvent,
  getSessionEvents,
  registerMobileDevice,
  getMobileDevicesForDoctor,
  // Re-export the Promise wrappers for middleware convenience.
  getRow,
  runQuery,
  allRows,
};
