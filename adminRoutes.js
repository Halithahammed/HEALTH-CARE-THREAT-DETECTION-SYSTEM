const { recordAlertDismissal, finalizeEscalation, acknowledgeIncident } = require('../services/evidenceService');
// routes/adminRoutes.js
// Admin-only routes for viewing all activity logs and security incidents.

const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { allRows } = require("../services/activityService");

function createAdminRoutes(io) {
  const router = express.Router();

  // All routes require a valid token and the admin role.
  router.use(authenticateToken, authorizeRoles("admin"));

  router.post('/critical-alert-dismissal', async (req,res)=>{
    try{
      const incidentCode=String(req.body?.incidentCode||'').trim();
      if(!incidentCode)return res.status(400).json({success:false,message:'Incident code is required'});
      const state=await recordAlertDismissal({incidentCode,adminUser:req.user});
      const adminIncident=state.requiresEscalation?{
        incidentCode:`ADM-${Date.now()}`,
        actionType:'CRITICAL_ALERT_IGNORED_3_TIMES',
        actionLabel:'Ignored critical security alert three times',
        reason:`Administrator failed to acknowledge ${incidentCode} after three critical alerts.`,
        riskLevel:'Critical',riskScore:95,totalRiskScore:95,
        originalIncidentCode:incidentCode,dismissalCount:state.dismissalCount,
        acknowledgementStatus:'Failed',escalationStatus:'Higher Official',
        suppressAdminAlert:true,timestamp:new Date().toISOString()
      }:null;
      res.json({success:true,...state,adminIncident});
    }catch(error){res.status(500).json({success:false,message:error.message})}
  });

  router.post('/critical-alert-escalate-complete', async (req,res)=>{
    try{
      const incidentCode=String(req.body?.incidentCode||'').trim();
      const adminEvidenceIncidentCode=String(req.body?.adminEvidenceIncidentCode||'').trim();
      const state=await finalizeEscalation({incidentCode,adminEvidenceIncidentCode});
      io?.emit('evidence:escalated',{incidentCode,reportedTo:'Higher Official',adminEvidenceIncidentCode,time:new Date().toISOString()});
      res.json({success:true,...state});
    }catch(error){res.status(500).json({success:false,message:error.message})}
  });

  router.post('/critical-alert-acknowledge', async (req,res)=>{
    try{const incidentCode=String(req.body?.incidentCode||'').trim();if(!incidentCode)return res.status(400).json({success:false,message:'Incident code is required'});await acknowledgeIncident({incidentCode});res.json({success:true});}
    catch(error){res.status(500).json({success:false,message:error.message})}
  });

  // GET /api/admin/activities
  router.get("/activities", async (req, res) => {
    try {
      const rows = await allRows(
        `SELECT a.id, a.user_id, a.username, a.doctor_id, a.action_type,
                a.resource_type, a.resource_id, a.department, a.ip_address,
                a.device_info, a.risk_points, a.risk_level, a.reason, a.created_at,
                u.full_name
         FROM activity_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC
         LIMIT 200`,
        []
      );
      res.json({ success: true, activities: rows });
    } catch (err) {
      console.error("admin activities error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // GET /api/admin/incidents
  router.get("/incidents", async (req, res) => {
    try {
      const rows = await allRows(
        `SELECT id, user_id, username, total_risk_score, severity, status, summary, created_at
         FROM security_incidents
         ORDER BY id DESC
         LIMIT 100`,
        []
      );
      res.json({ success: true, incidents: rows });
    } catch (err) {
      console.error("admin incidents error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });


  router.get("/investigation-reports", async (_req, res) => {
    try { const reports = await allRows(`SELECT r.*, u.full_name FROM investigation_reports r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 100`, []); res.json({success:true,reports}); }
    catch(err){ res.status(500).json({success:false,message:err.message}); }
  });

  router.get("/restrictions", async (_req, res) => {
    try { const restrictions = await allRows(`SELECT a.*, u.full_name FROM account_restrictions a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100`, []); res.json({success:true,restrictions}); }
    catch(err){ res.status(500).json({success:false,message:err.message}); }
  });

  return router;
}

module.exports = createAdminRoutes;
