// database.js
// Initializes and exports the SQLite database connection.
// Creates the users and login_logs tables automatically if they do not exist.

const sqlite3 = require("sqlite3").Database;
const path = require("path");

const DB_PATH = path.join(__dirname, "health.db");

const db = new sqlite3(DB_PATH, (err) => {
  if (err) {
    console.error("Database connection error:", err.message);
    process.exit(1);
  }
  console.log("Database connected at", DB_PATH);
});

// Enable Write-Ahead Logging for better concurrency and reliability.
db.run("PRAGMA journal_mode = WAL;");

// Create tables on startup. Uses IF NOT EXISTS so it is safe to run repeatedly.
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name     TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin','doctor')),
      doctor_id     TEXT,
      department    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER,
      username     TEXT,
      role         TEXT,
      ip_address   TEXT,
      user_agent   TEXT,
      login_time   TEXT NOT NULL DEFAULT (datetime('now')),
      login_status TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER,
      username      TEXT,
      doctor_id     TEXT,
      action_type   TEXT NOT NULL,
      resource_type TEXT,
      resource_id   TEXT,
      department    TEXT,
      ip_address    TEXT,
      device_info   TEXT,
      risk_points   INTEGER NOT NULL DEFAULT 0,
      risk_level    TEXT NOT NULL,
      reason        TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS security_incidents (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER,
      username         TEXT,
      total_risk_score INTEGER NOT NULL,
      severity         TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'open',
      summary          TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_user_id INTEGER,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      recipient_user_id INTEGER,
      recipient_doctor_id TEXT,
      recipient_role TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Security Notice',
      priority TEXT NOT NULL DEFAULT 'Normal',
      status TEXT NOT NULL DEFAULT 'Unread',
      incident_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS account_restrictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      doctor_id TEXT,
      reason TEXT,
      incident_id INTEGER,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS investigation_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER,
      user_id INTEGER,
      doctor_id TEXT,
      title TEXT,
      classification TEXT,
      risk_score INTEGER,
      summary TEXT,
      evidence TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);


  db.run(`
    CREATE TABLE IF NOT EXISTS doctor_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id TEXT NOT NULL UNIQUE,
      doctor_name TEXT NOT NULL,
      department TEXT,
      normal_login_hour REAL,
      normal_logout_hour REAL,
      avg_session_minutes REAL,
      avg_records REAL,
      avg_downloads REAL,
      known_devices TEXT,
      known_locations TEXT,
      baseline_score REAL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS behavior_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id TEXT NOT NULL,
      login_hour REAL,
      session_minutes REAL,
      records_viewed INTEGER,
      downloads INTEGER,
      departments_accessed INTEGER,
      failed_logins INTEGER,
      unknown_device INTEGER,
      external_ip INTEGER,
      after_hours INTEGER,
      export_all INTEGER,
      label TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ml_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      training_samples INTEGER,
      feature_count INTEGER,
      status TEXT,
      metrics TEXT,
      trained_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ml_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id TEXT,
      model_version TEXT,
      anomaly_score REAL,
      confidence INTEGER,
      risk_level TEXT,
      prediction TEXT,
      reasons TEXT,
      feature_vector TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      age INTEGER,
      gender TEXT,
      blood_group TEXT,
      department TEXT,
      primary_doctor_id TEXT,
      diagnosis TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS patient_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT NOT NULL UNIQUE,
      patient_id TEXT NOT NULL,
      doctor_id TEXT,
      report_type TEXT,
      department TEXT,
      status TEXT,
      findings TEXT,
      impression TEXT,
      recommendation TEXT,
      generated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);


  db.run(`
    CREATE TABLE IF NOT EXISTS forensic_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_code TEXT NOT NULL UNIQUE,
      incident_id INTEGER,
      doctor_id TEXT,
      priority TEXT NOT NULL DEFAULT 'High',
      status TEXT NOT NULL DEFAULT 'Open',
      summary TEXT,
      ai_recommendation TEXT,
      investigator TEXT,
      admin_decision TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS digital_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      sha256_hash TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

});

module.exports = db;
