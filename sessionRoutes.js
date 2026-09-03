// routes/sessionRoutes.js
// Phase 3A: doctor-facing session routes (my-sessions).
// Phase 3B: verification request endpoints (pending, confirm, deny).
//
// Doctors may only access their own verification requests.

const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const {
  getSessionsForUser,
  sanitizeSession,
  getVerificationById,
  getPendingVerificationsForUser,
  updateVerificationStatus,
  getSessionById,
  terminateSession,
  revokeJwt,
  addSessionEvent,
  addAuditLog,
} = require("../services/sessionService");
const { recordActivity } = require("../services/activityService");
const {
  emitVerificationConfirmed,
  emitVerificationDenied,
  emitSessionTerminated,
  emitSessionUpdated,
} = require("../services/socketService");

function createSessionRoutes(io) {
  const router = express.Router();

  // All routes require a valid token and the doctor role.
  router.use(authenticateToken, authorizeRoles("doctor"));

  // GET /api/sessions/my-sessions  (Phase 3A)
  router.get("/my-sessions", async (req, res) => {
    try {
      const rows = await getSessionsForUser(req.user.id);
      const sessions = rows.map((r) => {
        const s = sanitizeSession(r);
        s.isCurrent = s.sessionId === req.user.sessionId;
        return s;
      });
      res.json({ success: true, sessions });
    } catch (err) {
      console.error("my-sessions error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // GET /api/sessions/pending-verifications  (Phase 3B)
  router.get("/pending-verifications", async (req, res) => {
    try {
      const rows = await getPendingVerificationsForUser(req.user.id);
      res.json({ success: true, verifications: rows });
    } catch (err) {
      console.error("pending-verifications error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // POST /api/sessions/verifications/:id/confirm  (Phase 3B)
  // Doctor taps YES — suspicious session stays active, optionally trust device.
  router.post("/verifications/:id/confirm", async (req, res) => {
    try {
      const verification = await getVerificationById(req.params.id);
      if (!verification) {
        return res.status(404).json({ success: false, message: "Verification not found" });
      }
      if (verification.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      if (verification.status !== "pending") {
        return res.status(400).json({ success: false, message: "Verification already resolved" });
      }

      await updateVerificationStatus(verification.id, "confirmed");

      // Optionally trust the suspicious device.
      const suspiciousSession = await getSessionById(verification.suspicious_session_id);
      if (suspiciousSession) {
        const { trustDeviceByInsert } = require("../services/sessionService");
        await trustDeviceByInsert({
          userId: suspiciousSession.user_id,
          doctorId: suspiciousSession.doctor_id,
          deviceId: suspiciousSession.device_id,
          deviceName: suspiciousSession.device_name,
          browser: suspiciousSession.browser,
          os: suspiciousSession.operating_system,
        });
        await addSessionEvent(suspiciousSession.session_id, "verification_approved",
          `Doctor approved login. Device trusted.`);
      }

      await addAuditLog({
        userId: req.user.id,
        doctorId: req.user.doctorId,
        action: "verification_confirmed",
        ipAddress: suspiciousSession ? suspiciousSession.ip_address : null,
        browser: suspiciousSession ? suspiciousSession.browser : null,
        os: suspiciousSession ? suspiciousSession.operating_system : null,
        deviceName: suspiciousSession ? suspiciousSession.device_name : null,
        details: `Verification #${verification.id} confirmed by doctor.`,
      });

      const payload = {
        verificationId: verification.id,
        doctorId: verification.doctor_id,
        suspiciousSessionId: verification.suspicious_session_id,
        status: "confirmed",
        timestamp: new Date().toISOString(),
      };

      if (io) {
        emitVerificationConfirmed(io, payload);
        emitSessionUpdated(io, payload);
      }

      res.json({ success: true, message: "Verification confirmed", verification: payload });
    } catch (err) {
      console.error("confirm verification error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // POST /api/sessions/verifications/:id/deny  (Phase 3B)
  // Doctor taps NO — terminate suspicious session, revoke JWT, create incident.
  router.post("/verifications/:id/deny", async (req, res) => {
    try {
      const verification = await getVerificationById(req.params.id);
      if (!verification) {
        return res.status(404).json({ success: false, message: "Verification not found" });
      }
      if (verification.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      if (verification.status !== "pending") {
        return res.status(400).json({ success: false, message: "Verification already resolved" });
      }

      await updateVerificationStatus(verification.id, "denied");

      const suspiciousSession = await getSessionById(verification.suspicious_session_id);

      // Terminate the suspicious session.
      if (suspiciousSession) {
        await terminateSession(verification.suspicious_session_id, "Doctor denied verification");
        await revokeJwt(
          suspiciousSession.jwt_id,
          suspiciousSession.session_id,
          suspiciousSession.user_id,
          "Denied by doctor verification"
        );
        await addSessionEvent(suspiciousSession.session_id, "verification_denied",
          "Doctor denied the login verification.");
        await addSessionEvent(suspiciousSession.session_id, "session_terminated",
          "Session terminated after doctor denial.");
        await addSessionEvent(suspiciousSession.session_id, "jwt_revoked",
          "JWT revoked after doctor denial.");
      }

      // Record the risk event.
      try {
        await recordActivity({
          user: {
            id: req.user.id,
            username: req.user.username,
            fullName: req.user.fullName,
            doctorId: req.user.doctorId,
            department: req.user.department,
          },
          actionType: "VERIFICATION_DENIED",
          ipAddress: suspiciousSession ? suspiciousSession.ip_address : "unknown",
          deviceInfo: suspiciousSession ? suspiciousSession.device_name : "unknown",
          io,
        });
      } catch (actErr) {
        console.error("Verification-denied activity log error:", actErr.message);
      }

      // Create a critical security incident.
      const { runQuery } = require("../services/sessionService");
      const incidentSummary = `Unauthorized Concurrent Login — Doctor denied verification. Suspicious session terminated. JWT revoked.`;
      await runQuery(
        `INSERT INTO security_incidents (user_id, username, total_risk_score, severity, status, summary)
         VALUES (?, ?, ?, 'Critical', 'open', ?)`,
        [req.user.id, req.user.username, 100, incidentSummary]
      );

      await addAuditLog({
        userId: req.user.id,
        doctorId: req.user.doctorId,
        action: "verification_denied",
        ipAddress: suspiciousSession ? suspiciousSession.ip_address : null,
        browser: suspiciousSession ? suspiciousSession.browser : null,
        os: suspiciousSession ? suspiciousSession.operating_system : null,
        deviceName: suspiciousSession ? suspiciousSession.device_name : null,
        details: `Verification #${verification.id} denied. Session terminated + JWT revoked.`,
      });

      const payload = {
        verificationId: verification.id,
        doctorId: verification.doctor_id,
        suspiciousSessionId: verification.suspicious_session_id,
        status: "denied",
        terminated: true,
        jwtRevoked: true,
        incident: "Unauthorized Concurrent Login",
        timestamp: new Date().toISOString(),
      };

      if (io) {
        emitVerificationDenied(io, payload);
        emitSessionTerminated(io, {
          sessionId: verification.suspicious_session_id,
          doctorId: verification.doctor_id,
          reason: "Your session has been terminated by Hospital Security.",
          timestamp: new Date().toISOString(),
        });
        emitSessionUpdated(io, payload);
      }

      res.json({ success: true, message: "Verification denied — session terminated", verification: payload });
    } catch (err) {
      console.error("deny verification error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  return router;
}

module.exports = createSessionRoutes;
