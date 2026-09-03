// riskEngine.js
// Explainable, rule-based risk scoring engine.
// The backend derives risk points solely from action_type — never from
// values supplied by the frontend.

// Each rule maps a permitted action_type to its risk points, resource type,
// and a human-readable reason template. The reason is built server-side so
// explanations are always trustworthy.
const RULES = {
  VIEW_PATIENT_RECORD: {
    points: 2,
    resourceType: "patient_record",
    reason: "Viewed a normal patient record.",
  },
  VIEW_EMERGENCY_RECORD: {
    points: 5,
    resourceType: "emergency_record",
    reason: "Viewed an emergency record.",
  },
  ACCESS_OWN_DEPARTMENT: {
    points: 3,
    resourceType: "department",
    reason: "Accessed their own department.",
  },
  ACCESS_OTHER_DEPARTMENT: {
    points: 20,
    resourceType: "department",
    reason: "Accessed a different department.",
  },
  EXPORT_10_RECORDS: {
    points: 15,
    resourceType: "export",
    reason: "Exported 10 patient records.",
  },
  EXPORT_100_RECORDS: {
    points: 45,
    resourceType: "export",
    reason: "Exported 100 patient records.",
  },
  DOWNLOAD_CONFIDENTIAL_REPORT: {
    points: 25,
    resourceType: "report",
    reason: "Downloaded a confidential report.",
  },
  UNKNOWN_DEVICE_LOGIN: {
    points: 35,
    resourceType: "device",
    reason: "Logged in from an unknown device.",
  },
  RAPID_RECORD_ACCESS: {
    points: 30,
    resourceType: "patient_record",
    reason: "Rapid sequential record access detected.",
  },
};

// Display labels used in the UI for the permitted action set.
const ACTION_LABELS = {
  VIEW_PATIENT_RECORD: "View Patient Record",
  VIEW_EMERGENCY_RECORD: "View Emergency Record",
  ACCESS_OWN_DEPARTMENT: "Access Cardiology Department",
  ACCESS_OTHER_DEPARTMENT: "Access Oncology Department",
  EXPORT_10_RECORDS: "Export 10 Patient Records",
  EXPORT_100_RECORDS: "Export 100 Patient Records",
  DOWNLOAD_CONFIDENTIAL_REPORT: "Download Confidential Report",
  UNKNOWN_DEVICE_LOGIN: "Simulate Unknown Device Login",
  RAPID_RECORD_ACCESS: "Simulate Rapid Record Access",
};

// Ordered attack simulation sequence.
const SIMULATION_SEQUENCE = [
  "UNKNOWN_DEVICE_LOGIN",
  "ACCESS_OTHER_DEPARTMENT",
  "EXPORT_100_RECORDS",
];

const MAX_SCORE = 100;

function isPermittedAction(actionType) {
  return Object.prototype.hasOwnProperty.call(RULES, actionType);
}

function getRule(actionType) {
  return RULES[actionType] || null;
}

// Returns the risk band for a given total score.
function riskLevelForScore(score) {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 30) return "Medium";
  return "Low";
}

// The Normal/Suspicious/Critical status label requested for the doctor UI.
function riskStatusLabel(level) {
  if (level === "Critical" || level === "High") return "Critical";
  if (level === "Medium") return "Suspicious";
  return "Normal";
}

// Maps a level to one of the severity colors used across the UI.
function riskColor(level) {
  switch (level) {
    case "Critical": return "red";
    case "High": return "orange";
    case "Medium": return "yellow";
    default: return "green";
  }
}

// Builds a human-readable explanation for a single activity.
function explainPoints(actionType) {
  const rule = getRule(actionType);
  if (!rule) return "Unknown activity.";
  return `Risk increased by ${rule.points} because the doctor ${rule.reason.replace(/\.$/, "")}.`;
}

module.exports = {
  RULES,
  ACTION_LABELS,
  SIMULATION_SEQUENCE,
  MAX_SCORE,
  isPermittedAction,
  getRule,
  riskLevelForScore,
  riskStatusLabel,
  riskColor,
  explainPoints,
};
