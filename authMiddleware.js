// authMiddleware.js
// JWT authentication + role-based access control middleware.

const jwt = require("jsonwebtoken");
const db = require("../database/database");

// Verifies the Bearer token from the Authorization header.
// On success attaches the decoded payload to req.user.
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Missing authentication token" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
    req.user = decoded;
    db.get("SELECT id, reason FROM account_restrictions WHERE user_id=? AND status='Active' ORDER BY id DESC LIMIT 1", [decoded.id], (dbErr, restriction) => {
      if (dbErr) return res.status(500).json({ success: false, message: "Unable to verify account status" });
      if (restriction && decoded.role === "doctor") {
        return res.status(423).json({ success: false, terminated: true, message: "Account restricted by Hospital Security. Please contact an administrator.", reason: restriction.reason });
      }
      if (restriction && decoded.role === "admin") {
        return res.status(423).json({ success: false, terminated: true, message: "Administrator account restricted by WeCare Security and escalated for higher-level review.", reason: restriction.reason });
      }
      next();
    });
  });
}

// Authorizes a request only if req.user.role is one of the allowed roles.
// Must be used AFTER authenticateToken.
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Access denied for this role" });
    }
    next();
  };
}

module.exports = { authenticateToken, authorizeRoles };
