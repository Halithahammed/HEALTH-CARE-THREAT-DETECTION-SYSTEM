// routes/activityRoutes.js
// Doctor-facing activity routes: log an activity, fetch own activity + risk,
// run attack simulation, and reset demo data. All routes are JWT-protected.

const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { recordActivity, getSessionScore, resetDemo } = require("../services/activityService");
const { SIMULATION_SEQUENCE, ACTION_LABELS } = require("../services/riskEngine");
const { getRow, allRows } = require("../services/activityService");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function createActivityRoutes(io) {
  const router = express.Router();

  // All routes require a valid token and the doctor role.
  router.use(authenticateToken, authorizeRoles("doctor"));

  // POST /api/activity/log
  // Body: { actionType, resourceType?, resourceId?, department? }
  router.post("/log", async (req, res) => {
    const { actionType, resourceType, resourceId, department } = req.body;

    try {
      const payload = await recordActivity({
        user: req.user,
        actionType,
        resourceType,
        resourceId,
        department,
        ipAddress: req.ip || (req.socket && req.socket.remoteAddress) || "unknown",
        deviceInfo: req.headers["user-agent"] || "unknown",
        io,
      });
      res.json({ success: true, activity: payload });
    } catch (err) {
      if (err.code === "INVALID_ACTION") {
        return res.status(400).json({ success: false, message: "Invalid or unknown action type" });
      }
      console.error("Activity log error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // GET /api/activity/my-activity
  router.get("/my-activity", async (req, res) => {
    try {
      const rows = await allRows(
        `SELECT id, action_type, resource_type, resource_id, department, ip_address,
                device_info, risk_points, risk_level, reason, created_at
         FROM activity_logs
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 50`,
        [req.user.id]
      );
      res.json({ success: true, activities: rows });
    } catch (err) {
      console.error("my-activity error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // GET /api/activity/my-risk
  router.get("/my-risk", async (req, res) => {
    try {
      const score = await getSessionScore(req.user.id);
      res.json({ success: true, totalRiskScore: score });
    } catch (err) {
      console.error("my-risk error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // POST /api/activity/simulate-attack
  // Sequentially logs the attack-simulation actions with a short delay so the
  // admin dashboard visibly updates in real time.
  router.post("/simulate-attack", async (req, res) => {
    try {
      const results = [];
      const ipAddress = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
      const deviceInfo = req.headers["user-agent"] || "unknown";

      for (const actionType of SIMULATION_SEQUENCE) {
        const payload = await recordActivity({
          user: req.user,
          actionType,
          ipAddress,
          deviceInfo,
          io,
        });
        results.push(payload);
        await delay(1200);
      }

      const finalScore = await getSessionScore(req.user.id);
      res.json({ success: true, results, finalRiskScore: finalScore });
    } catch (err) {
      console.error("simulate-attack error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // POST /api/activity/reset-demo
  // Clears the current doctor's activity logs + incidents.
  router.post("/reset-demo", async (req, res) => {
    try {
      await resetDemo(req.user.id);
      res.json({ success: true, message: "Demo data reset" });
    } catch (err) {
      console.error("reset-demo error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  return router;
}

module.exports = createActivityRoutes;
module.exports.ACTION_LABELS = ACTION_LABELS;
