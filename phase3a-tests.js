// test/phase3a-tests.js
// Phase 3A integration tests: session creation, JWT session identity,
// trusted-device registration, concurrent-session detection, unknown-device
// detection, risk events, role guards, and real-time socket events.

const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
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

function login(username, password, expectedRole, deviceLabel) {
  return httpReq("POST", "/api/auth/login", {}, {
    username, password, expectedRole, deviceLabel: deviceLabel || "Test Device",
  });
}

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
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

(async () => {
  // Clean Phase 3A + Phase 2 data before tests.
  await dbRun("DELETE FROM active_sessions");
  await dbRun("DELETE FROM trusted_devices");
  await dbRun("DELETE FROM revoked_tokens");
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

    // Connect a socket client.
    client = io("http://localhost:3000", { transports: ["websocket"] });
    await new Promise((resolve) => client.on("connect", resolve));

    const collect = (name) => client.on(name, (d) => socketEvents.push({ name, data: d }));
    collect("session:created");
    collect("session:updated");
    collect("security:concurrent-session");
    collect("security:unknown-device");

    // Admin login (needed for admin session API).
    const adminLogin = await login("admin", "admin123", "admin");
    const adminToken = adminLogin.body.token;
    const adminAuth = { Authorization: "Bearer " + adminToken };

    // ===== TEST 1: Doctor login creates an active session =====
    const docLogin1 = await login("doctor", "doctor123", "doctor", "Hospital Doctor Laptop");
    const docToken1 = docLogin1.body.token;
    const docAuth1 = { Authorization: "Bearer " + docToken1 };
    assert(docLogin1.status === 200 && docLogin1.body.success === true, "doctor login succeeds");

    const sessionsAfter1 = await dbAll("SELECT * FROM active_sessions WHERE user_id = ?", [docLogin1.body.user.id]);
    assert(sessionsAfter1.length === 1, "doctor login creates an active session");
    assert(sessionsAfter1[0].status === "active", "session status is active");

    // ===== TEST 2: JWT includes session ID and jti =====
    const payload = JSON.parse(Buffer.from(docToken1.split(".")[1], "base64url").toString());
    assert(typeof payload.sessionId === "string" && payload.sessionId.length > 0, "JWT includes a session ID");
    assert(typeof payload.jti === "string" && payload.jti.length > 0, "JWT includes a jti");

    // JWT IDs must not be exposed in the normal API response.
    assert(!docLogin1.body.user.jti, "JWT ID (jti) is not exposed in login response");
    assert(!docLogin1.body.user.sessionId, "session ID is not exposed in login response user object");

    // ===== TEST 3: First doctor device is registered as trusted =====
    const trustedDevices = await dbAll("SELECT * FROM trusted_devices WHERE user_id = ?", [docLogin1.body.user.id]);
    assert(trustedDevices.length === 1, "first doctor device is registered in trusted_devices");
    assert(sessionsAfter1[0].is_trusted === 1, "first session is marked trusted");
    assert(sessionsAfter1[0].is_suspicious === 0, "first session is not suspicious");

    // ===== TEST 4: A second login creates a separate session =====
    // Use a different User-Agent to simulate a different device.
    const docLogin2 = await httpReq("POST", "/api/auth/login", {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 AttackerBrowser",
    }, {
      username: "doctor", password: "doctor123", expectedRole: "doctor", deviceLabel: "Attacker Laptop",
    });
    const docToken2 = docLogin2.body.token;
    const docAuth2 = { Authorization: "Bearer " + docToken2 };
    assert(docLogin2.status === 200 && docLogin2.body.success === true, "second doctor login succeeds");

    const sessionsAfter2 = await dbAll("SELECT * FROM active_sessions WHERE user_id = ? ORDER BY id DESC", [docLogin1.body.user.id]);
    assert(sessionsAfter2.length === 2, "second login creates a separate session");

    // ===== TEST 5: Second login detects a concurrent session =====
    const newestSession = sessionsAfter2[0]; // DESC order, newest first
    assert(newestSession.is_suspicious === 1, "newest session is marked suspicious (concurrent)");

    // ===== TEST 6: A new device is marked unknown =====
    // The attacker browser has a different User-Agent, so different device_id.
    assert(newestSession.is_trusted === 0, "new device session is marked not trusted (unknown)");

    // ===== TEST 7: Newest suspicious session remains active =====
    assert(newestSession.status === "active", "newest suspicious session remains active (not terminated)");

    // ===== TEST 8: Existing trusted session remains active =====
    const oldestSession = sessionsAfter2[1];
    assert(oldestSession.status === "active", "existing trusted session remains active (not terminated)");
    assert(oldestSession.is_trusted === 1, "existing trusted session is still trusted");

    // ===== TEST 9: Concurrent-session risk activity is created =====
    const concurrentActivities = await dbAll(
      "SELECT * FROM activity_logs WHERE user_id = ? AND action_type = 'CONCURRENT_SESSION'",
      [docLogin1.body.user.id]
    );
    assert(concurrentActivities.length >= 1, "concurrent-session risk activity is created");
    assert(concurrentActivities[0].risk_points === 40, "concurrent-session awards 40 risk points");

    // ===== TEST 10: Unknown-device risk activity is created =====
    const unknownDeviceActivities = await dbAll(
      "SELECT * FROM activity_logs WHERE user_id = ? AND action_type = 'UNKNOWN_DEVICE_LOGIN'",
      [docLogin1.body.user.id]
    );
    assert(unknownDeviceActivities.length >= 1, "unknown-device risk activity is created");
    assert(unknownDeviceActivities[0].risk_points === 35, "unknown-device awards 35 risk points");

    // ===== TEST 11: Admin can list sessions =====
    const adminSessions = await httpReq("GET", "/api/admin/sessions", adminAuth);
    assert(adminSessions.status === 200 && adminSessions.body.success === true, "admin can list sessions");
    assert(adminSessions.body.sessions.length >= 2, "admin sessions list includes both doctor sessions");
    // JWT IDs must not be exposed.
    const adminSessionData = adminSessions.body.sessions[0];
    assert(!adminSessionData.jwtId, "admin session API does not expose JWT ID");

    // ===== TEST 12: Doctor cannot access Admin session routes =====
    const docAsAdmin = await httpReq("GET", "/api/admin/sessions", docAuth1);
    assert(docAsAdmin.status === 403, "doctor cannot access admin sessions route (403)");

    // ===== TEST 13: Doctor can list only their own sessions =====
    const docSessions = await httpReq("GET", "/api/sessions/my-sessions", docAuth1);
    assert(docSessions.status === 200 && docSessions.body.success === true, "doctor can list own sessions");
    assert(docSessions.body.sessions.length === 2, "doctor sees both of their own sessions");
    assert(docSessions.body.sessions.some((s) => s.isCurrent === true), "doctor sessions list marks current session");
    // All sessions belong to the same doctor.
    const allOwn = docSessions.body.sessions.every((s) => s.userId === docLogin1.body.user.id);
    assert(allOwn, "doctor sessions list contains only the doctor's own sessions");
    // JWT IDs not exposed.
    assert(!docSessions.body.sessions[0].jwtId, "doctor session API does not expose JWT ID");

    // ===== TEST 14: Socket session:created event is emitted =====
    await delay(400);
    const sessionCreatedEvents = socketEvents.filter((e) => e.name === "session:created");
    assert(sessionCreatedEvents.length >= 2, "session:created event emitted for each login");

    // ===== TEST 15: Socket security:concurrent-session event is emitted =====
    const concurrentSocketEvents = socketEvents.filter((e) => e.name === "security:concurrent-session");
    assert(concurrentSocketEvents.length >= 1, "security:concurrent-session event emitted");

    // Also check unknown-device socket event.
    const unknownDeviceSocketEvents = socketEvents.filter((e) => e.name === "security:unknown-device");
    assert(unknownDeviceSocketEvents.length >= 1, "security:unknown-device event emitted");

    client.disconnect();
  } catch (err) {
    console.error("Test harness error:", err);
    failed++;
  } finally {
    if (client) client.disconnect();
    server.kill("SIGTERM");
    await delay(300);
    try {
      await dbRun("DELETE FROM active_sessions");
      await dbRun("DELETE FROM trusted_devices");
      await dbRun("DELETE FROM revoked_tokens");
      await dbRun("DELETE FROM activity_logs");
      await dbRun("DELETE FROM security_incidents");
    } catch (_) {}
    console.log(failed === 0 ? "\nALL PHASE 3A TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
