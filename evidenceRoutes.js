const express = require('express');
const jwt = require('jsonwebtoken');
const { saveEvidence } = require('../services/evidenceService');

function evidenceAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Missing authentication token' });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    if (!['doctor', 'admin'].includes(user.role)) return res.status(403).json({ success: false, message: 'Access denied' });
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

function createEvidenceRoutes(io) {
  const router = express.Router();
  router.use(evidenceAuth);

  router.get('/status', (req, res) => res.json({ success: true, user: req.user.fullName, role: req.user.role, capture: 'ready' }));

  router.post('/capture', async (req, res) => {
    try {
      const { incident, screenshot, recording, replay, timeline, pageSnapshot } = req.body || {};
      if (!incident || !['High', 'Critical'].includes(incident.riskLevel)) {
        return res.status(400).json({ success: false, message: 'Only High/Critical incidents can be stored.' });
      }

      const out = await saveEvidence({
        user: req.user,
        incident,
        screenshot,
        recording,
        replay,
        timeline,
        pageSnapshot
      });
      if (out.evidenceStatus !== 'Complete' || !out.hasScreenshot || !out.hasReplay) {
        return res.status(422).json({ success:false, message:'Evidence capture incomplete. Screenshot and session recording are required.', ...out });
      }

      // IMPORTANT: alert Admin only after screenshot + replay are physically stored.
      if (io) {
        const event = {
          ...incident,
          incidentCode: out.incidentCode,
          incidentId: incident.incidentId || null,
          userId: req.user.id,
          username: req.user.username,
          fullName: req.user.fullName,
          doctor: req.user.role === 'doctor' ? req.user.fullName : undefined,
          doctorId: req.user.doctorId || null,
          department: req.user.department || null,
          role: req.user.role,
          risk: incident.riskLevel,
          riskLevel: incident.riskLevel,
          evidenceReady: true,
          evidenceFiles: out.files,
          time: new Date().toISOString(),
          timestamp: new Date().toISOString()
        };
        io.emit('admin:critical-alert', event);
        io.emit('evidence:stored', event);
      }

      res.json({ success: true, ...out });
    } catch (error) {
      console.error('Evidence capture error:', error);
      res.status(500).json({ success: false, message: 'Evidence capture failed: ' + error.message });
    }
  });

  return router;
}
module.exports = createEvidenceRoutes;
