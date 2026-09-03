// test/phase2-tests.js
// Phase 2 integration tests: activity logging, risk scoring, role guards,
// invalid action rejection, high-risk threshold, and critical incident creation.
// Spawns the server, connects a Socket.IO client to observe real-time events,
// then exercises the protected API.

const { spawn } = require("child_process");
const http = require("http");
const io = require("socket.io-client");
const db = require("../database/database");

function httpReq(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "localhost",
      port: 3000,
      path,
      method,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        headers,
        data ? { "Content-Length": Buffer.byteLength(data) } : {}
      ),
    };
    const req = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function login(username, password, expectedRole) {
  return httpReq("POST", "/api/auth/login", {}, { username, password, expectedRole });
}

// Promise wrappers for sqlite cleanup.
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

(async () => {
  // Clean any leftover Phase 2 data before tests.
  await dbRun("DELETE FROM activity_logs");
  await dbRun("DELETE FROM security_incidents");

  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "3000" },
    stdio: "pipe",
  });
  server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
  server.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));

  let failed = 0;
  const assert = (cond, label) => {
    console.log((cond ? "PASS  " : "FAIL  ") + label);
    if (!cond) failed++;
  };

  // Collect socket events for assertions.
  const socketEvents = [];
  let client;

  try {
    // Wait for server boot.
    let up = false;
    for (let i = 0; i < 20; i++) {
      try {
        const h = await httpReq("GET", "/api/health");
        if (h.status === 200) { up = true; break; }
      } catch (_) {}
      await delay(250);
    }
    assert(up, "server boots");

    // Connect a socket client to observe real-time events.
    client = io("http://localhost:3000", { transports: ["websocket"] });
    await new Promise((resolve) => client.on("connect", resolve));

    const collect = (name) => client.on(name, (d) => socketEvents.push({ name, data: d }));
    collect("activity:new");
    collect("risk:updated");
    collect("security:high-risk-alert");
    collect("security:critical-alert");

    // Login as doctor and admin.
    const docLogin = await login("doctor", "doctor123", "doctor");
    const adminLogin = await login("admin", "admin123", "admin");
    const docToken = docLogin.body.token;
    const adminToken = adminLogin.body.token;
    const docAuth = { Authorization: "Bearer " + docToken };
    const adminAuth = { Authorization: "Bearer " + adminToken };

    // 1. Normal activity logging
    const normalAct = await httpReq("POST", "/api/activity/log", docAuth, {
      actionType: "VIEW_PATIENT_RECORD",
    });
    assert(normalAct.status === 200 && normalAct.body.success === true, "normal activity logs successfully");
    assert(normalAct.body.activity.riskPoints === 2, "VIEW_PATIENT_RECORD awards 2 points");
    assert(normalAct.body.activity.totalRiskScore === 2, "total risk score is 2 after one normal action");
    assert(typeof normalAct.body.activity.reason === "string" && normalAct.body.activity.reason.length > 0, "activity includes a reason");

    // 2. Invalid action rejection
    const invalidAct = await httpReq("POST", "/api/activity/log", docAuth, {
      actionType: "HACK_THE_MAINFRAME",
    });
    assert(invalidAct.status === 400, "invalid action type returns 400");
    assert(invalidAct.body.success === false, "invalid action rejected");

    // 3. Protected route rejection without JWT
    const noToken = await httpReq("GET", "/api/activity/my-activity");
    assert(noToken.status === 401, "activity route rejects request without JWT");

    const noTokenLog = await httpReq("POST", "/api/activity/log", {}, { actionType: "VIEW_PATIENT_RECORD" });
    assert(noTokenLog.status === 401, "activity log rejects POST without JWT");

    // 4. Doctor unable to access admin routes
    const docAsAdmin = await httpReq("GET", "/api/admin/activities", docAuth);
    assert(docAsAdmin.status === 403, "doctor cannot access admin activities route (403)");

    const docAsAdminInc = await httpReq("GET", "/api/admin/incidents", docAuth);
    assert(docAsAdminInc.status === 403, "doctor cannot access admin incidents route (403)");

    // Admin can access admin routes.
    const adminActs = await httpReq("GET", "/api/admin/activities", adminAuth);
    assert(adminActs.status === 200 && adminActs.body.success === true, "admin can access activities route");

    // 5. Risk score calculation — build up a known total.
    // Already at 2. Add emergency (5) + own dept (3) = 10.
    await httpReq("POST", "/api/activity/log", docAuth, { actionType: "VIEW_EMERGENCY_RECORD" });
    await httpReq("POST", "/api/activity/log", docAuth, { actionType: "ACCESS_OWN_DEPARTMENT" });
    const myRisk = await httpReq("GET", "/api/activity/my-risk", docAuth);
    assert(myRisk.body.success === true, "my-risk responds successfully");
    assert(myRisk.body.totalRiskScore === 10, "risk score is 10 after 2+5+3");

    // 6. High-risk alert threshold (>=60). Add export 100 (45) + other dept (20) = 75.
    await httpReq("POST", "/api/activity/log", docAuth, { actionType: "EXPORT_100_RECORDS" });
    await httpReq("POST", "/api/activity/log", docAuth, { actionType: "ACCESS_OTHER_DEPARTMENT" });
    const highRisk = await httpReq("GET", "/api/activity/my-risk", docAuth);
    assert(highRisk.body.totalRiskScore === 75, "risk score is 75 after reaching high-risk band");

    // Give socket events time to arrive.
    await delay(400);
    const highAlert = socketEvents.find((e) => e.name === "security:high-risk-alert");
    assert(!!highAlert, "security:high-risk-alert emitted when score >= 60");

    // 7. Critical incident creation (>=80). Add confidential report (25) -> 100 (capped).
    const critAct = await httpReq("POST", "/api/activity/log", docAuth, {
      actionType: "DOWNLOAD_CONFIDENTIAL_REPORT",
    });
    assert(critAct.body.activity.totalRiskScore === 100, "risk score capped at 100 at critical band");

    await delay(400);
    const critAlert = socketEvents.find((e) => e.name === "security:critical-alert");
    assert(!!critAlert, "security:critical-alert emitted when score >= 80");

    // Verify an incident row was created in the database.
    const incidents = await dbAll("SELECT * FROM security_incidents WHERE user_id = ?", [docLogin.body.user.id]);
    assert(incidents.length >= 1, "security incident created in database");
    assert(incidents[0].severity === "Critical", "incident severity is Critical");
    assert(incidents[0].status === "open", "incident status is open");

    // 8. attack simulation reaches critical.
    await dbRun("DELETE FROM activity_logs");
    await dbRun("DELETE FROM security_incidents");
    socketEvents.length = 0;

    const sim = await httpReq("POST", "/api/activity/simulate-attack", docAuth);
    assert(sim.status === 200 && sim.body.success === true, "attack simulation completes successfully");
    // 35 + 20 + 45 = 100
    assert(sim.body.finalRiskScore === 100, "attack simulation reaches 100 (critical)");

    await delay(400);
    const simCrit = socketEvents.find((e) => e.name === "security:critical-alert");
    assert(!!simCrit, "critical alert emitted during attack simulation");

    const simIncidents = await dbAll("SELECT * FROM security_incidents WHERE user_id = ?", [docLogin.body.user.id]);
    assert(simIncidents.length >= 1, "incident created during attack simulation");

    // 9. reset-demo clears the doctor's data.
    const reset = await httpReq("POST", "/api/activity/reset-demo", docAuth);
    assert(reset.status === 200 && reset.body.success === true, "reset-demo responds successfully");
    const afterReset = await dbAll("SELECT * FROM activity_logs WHERE user_id = ?", [docLogin.body.user.id]);
    assert(afterReset.length === 0, "reset-demo clears activity logs");
    const afterResetInc = await dbAll("SELECT * FROM security_incidents WHERE user_id = ?", [docLogin.body.user.id]);
    assert(afterResetInc.length === 0, "reset-demo clears incidents");

    // 10. Frontend never controls score — send a forged riskPoints, ensure ignored.
    await dbRun("DELETE FROM activity_logs");
    const forged = await httpReq("POST", "/api/activity/log", docAuth, {
      actionType: "VIEW_PATIENT_RECORD",
      riskPoints: 9999, // should be ignored
    });
    assert(forged.body.activity.riskPoints === 2, "frontend-supplied riskPoints is ignored by backend");

    client.disconnect();
  } catch (err) {
    console.error("Test harness error:", err);
    failed++;
  } finally {
    if (client) client.disconnect();
    server.kill("SIGTERM");
    await delay(300);
    // Clean up test data.
    try {
      await dbRun("DELETE FROM activity_logs");
      await dbRun("DELETE FROM security_incidents");
    } catch (_) {}
    console.log(failed === 0 ? "\nALL PHASE 2 TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
