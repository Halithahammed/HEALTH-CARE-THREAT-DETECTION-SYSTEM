// seed.js
// Seeds the database with one admin and one doctor user.
// Passwords are hashed with bcryptjs. Running repeatedly will not create duplicates.

const bcrypt = require("bcryptjs");
const db = require("./database");

const SALT_ROUNDS = 10;

const seedUsers = [
  { username: "admin", password: "admin123", full_name: "Security Administrator", role: "admin", doctor_id: null, department: null },
  { username: "doctor", password: "doctor123", full_name: "Dr. Arjun Kumar", role: "doctor", doctor_id: "DOC001", department: "Cardiology" },
  { username: "doctor123", password: "doctor123", full_name: "Dr. Arjun Kumar", role: "doctor", doctor_id: "DOC001", department: "Cardiology" },
  { username: "doctor456", password: "doctor456", full_name: "Dr. Priya Sharma", role: "doctor", doctor_id: "DOC002", department: "Neurology" },
  { username: "doctor789", password: "doctor789", full_name: "Dr. Rahul Nair", role: "doctor", doctor_id: "DOC003", department: "Orthopedics" },
  { username: "doctor000", password: "doctor000", full_name: "Dr. Meera Joseph", role: "doctor", doctor_id: "DOC004", department: "Radiology" }
];

async function seed() {
  try {
    for (const u of seedUsers) {
      // Check if the username already exists to avoid duplicates.
      const existing = await getRow(
        "SELECT id FROM users WHERE username = ?",
        [u.username]
      );

      if (existing) {
        console.log(`User '${u.username}' already exists (id=${existing.id}). Skipping.`);
        continue;
      }

      const hash = await bcrypt.hash(u.password, SALT_ROUNDS);

      await runQuery(
        `INSERT INTO users (username, password_hash, full_name, role, doctor_id, department)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [u.username, hash, u.full_name, u.role, u.doctor_id, u.department]
      );

      console.log(`Seeded user '${u.username}' (${u.role}).`);
    }

    console.log("Seeding complete.");
  } catch (err) {
    console.error("Seeding error:", err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

// --- small promise wrappers around sqlite3 callbacks ---
function getRow(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

seed();
