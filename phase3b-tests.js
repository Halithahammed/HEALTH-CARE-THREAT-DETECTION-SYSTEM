// test/phase3b-tests.js
// Phase 3B integration tests: verification creation, confirm, deny,
// JWT revocation, session termination, admin actions, socket events.

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
  // Clean all test data.
  await dbRun("DELETE FROM active_sessions");
  await dbRun("DELETE FROM trusted_devices");
  await dbRun("DELETE FROM revoked_tokens");
  await dbRun("DELETE FROM activity_logs");
  await dbRun("DELETE FROM security_incidents");
  await dbRun("DELETE FROM session_verifications");
  await dbRun("DELETE FROM doctor_mobile_devices");
  await dbRun("DELETE FROM audit_logs");
  await dbRun("DELETE FROM session_events");

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
  let mobileClient, doctorClient;

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

    // Admin login.
    const adminLogin = await httpReq("POST", "/api/auth/login", {}, {
      username: "admin", password: "admin123", expectedRole: "admin",
    });
    const adminToken = adminLogin.body.token;
    const adminAuth = { Authorization: "Bearer " + adminToken };

    // ===== Step 1: First doctor login (trusted, desktop) =====
    const docLogin1 = await httpReq("POST", "/api/auth/login", {}, {
      username: "doctor", password: "doctor123", expectedRole: "doctor",
      deviceLabel: "Hospital Doctor Laptop",
    });
    const docToken1 = docLogin1.body.token;
    const docAuth1 = { Authorization: "Bearer " + docToken1 };
    assert(docLogin1.status === 200, "first doctor login succeeds");

    // Connect a socket as the doctor (simulates desktop dashboard).
    doctorClient = io("http://localhost:3000", {
      transports: ["websocket"],
      auth: { token: docToken1 },
    });
    await new Promise((resolve) => doctorClient.on("connect", resolve));

    const collect = (name) => (d) => socketEvents.push({ name, data: d });
    doctorClient.on("verification:created", collect("verification:created"));
    doctorClient.on("verification:confirmed", collect("verification:confirmed"));
    doctorClient.on("verification:denied", collect("verification:denied"));
    doctorClient.on("session:terminated", collect("session:terminated"));

    // Also connect an admin socket (no auth token).
    const adminClient = io("http://localhost:3000", { transports: ["websocket"] });
    await new Promise((resolve) => adminClient.on("connect", resolve));
    adminClient.on("verification:created", collect("admin:verification:created"));
    adminClient.on("verification:confirmed", collect("admin:verification:confirmed"));
    adminClient.on("verification:denied", collect("admin:verification:denied"));
    adminClient.on("session:terminated", collect("admin:session:terminated"));

    // ===== Step 2: Second doctor login (suspicious, different device) =====
    const docLogin2 = await httpReq("POST", "/api/auth/login", {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 AttackerKali",
    }, {
      username: "doctor", password: "doctor123", expectedRole: "doctor",
      deviceLabel: "Attacker Laptop",
    });
    const docToken2 = docLogin2.body.token;
    const docAuth2 = { Authorization: "Bearer " + docToken2 };
    assert(docLogin2.status === 200, "second suspicious doctor login succeeds");

    await delay(500);

    // ===== TEST 1: Verification request is created =====
    const verifications = await dbAll(
      "SELECT * FROM session_verifications WHERE user_id = ? AND status = 'pending'",
      [docLogin1.body.user.id]
    );
    assert(verifications.length === 1, "verification request is created (pending)");
    assert(verifications[0].doctor_id === "DOC001", "verification doctor_id is DOC001");

    // ===== TEST 2: Socket verification:created event emitted to doctor room =====
    const verCreatedEvents = socketEvents.filter((e) => e.name === "verification:created");
    assert(verCreatedEvents.length >= 1, "verification:created event emitted to doctor room");
    if (verCreatedEvents.length > 0) {
      assert(verCreatedEvents[0].data.doctorId === "DOC001", "verification event targets correct doctor");
    }

    // ===== TEST 3: Admin also receives verification:created =====
    const adminVerCreated = socketEvents.filter((e) => e.name === "admin:verification:created");
    assert(adminVerCreated.length >= 1, "admin receives verification:created event");

    // ===== TEST 4: Pending verifications API =====
    const pending = await httpReq("GET", "/api/sessions/pending-verifications", docAuth1);
    assert(pending.status === 200 && pending.body.success === true, "pending-verifications API works");
    assert(pending.body.verifications.length >= 1, "pending verifications list is non-empty");

    // ===== TEST 5: Doctor confirms verification (YES) =====
    const verificationId = verifications[0].id;
    const confirmRes = await httpReq("POST", `/api/sessions/verifications/${verificationId}/confirm`, docAuth1);
    assert(confirmRes.status === 200 && confirmRes.body.success === true, "confirm verification succeeds");
    assert(confirmRes.body.verification.status === "confirmed", "verification status is confirmed");

    // Suspicious session stays active.
    const suspiciousSession = await dbGet(
      "SELECT * FROM active_sessions WHERE session_id = ?",
      [verifications[0].suspicious_session_id]
    );
    assert(suspiciousSession.status === "active", "suspicious session stays active after confirm");

    // Device should now be trusted.
    assert(suspiciousSession.is_trusted === 1, "device is trusted after confirm");

    // ===== TEST 6: verification:confirmed socket event =====
    await delay(300);
    const confirmedEvents = socketEvents.filter((e) => e.name === "verification:confirmed" || e.name === "admin:verification:confirmed");
    assert(confirmedEvents.length >= 1, "verification:confirmed event emitted");

    // ===== TEST 7: Admin can list verifications =====
    const adminVerRes = await httpReq("GET", "/api/admin/verifications", adminAuth);
    assert(adminVerRes.status === 200, "admin can list verifications");
    assert(adminVerRes.body.verifications.length >= 1, "admin verifications list non-empty");

    // ===== Now test the DENY flow with a new verification =====
    // Clean and create a second scenario.
    await dbRun("DELETE FROM session_verifications");

    // Third login (another suspicious device).
    const docLogin3 = await httpReq("POST", "/api/auth/login", {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0 AttackerKali2",
    }, {
      username: "doctor", password: "doctor123", expectedRole: "doctor",
      deviceLabel: "Kali Machine 2",
    });
    const docToken3 = docLogin3.body.token;
    assert(docLogin3.status === 200, "third suspicious login succeeds");

    await delay(500);

    const verifications2 = await dbAll(
      "SELECT * FROM session_verifications WHERE user_id = ? AND status = 'pending'",
      [docLogin1.body.user.id]
    );
    assert(verifications2.length === 1, "second verification request created");

    // ===== TEST 8: Doctor denies verification (NO) =====
    const verificationId2 = verifications2[0].id;
    const denyRes = await httpReq("POST", `/api/sessions/verifications/${verificationId2}/deny`, docAuth1);
    assert(denyRes.status === 200 && denyRes.body.success === true, "deny verification succeeds");
    assert(denyRes.body.verification.status === "denied", "verification status is denied");
    assert(denyRes.body.verification.terminated === true, "deny response indicates session terminated");
    assert(denyRes.body.verification.jwtRevoked === true, "deny response indicates JWT revoked");

    // ===== TEST 9: Suspicious session is terminated =====
    const terminatedSession = await dbGet(
      "SELECT * FROM active_sessions WHERE session_id = ?",
      [verifications2[0].suspicious_session_id]
    );
    assert(terminatedSession.status === "terminated", "suspicious session is terminated after deny");

    // ===== TEST 10: JWT is revoked =====
    const revokedToken = await dbGet(
      "SELECT * FROM revoked_tokens WHERE session_id = ?",
      [verifications2[0].suspicious_session_id]
    );
    assert(!!revokedToken, "JWT jti inserted into revoked_tokens");

    // ===== TEST 11: Revoked JWT can no longer access protected routes =====
    const revokedAccess = await httpReq("GET", "/api/sessions/my-sessions", { Authorization: "Bearer " + docToken3 });
    assert(revokedAccess.status === 401, "revoked JWT returns 401 on protected route");
    assert(revokedAccess.body.message === "Session revoked", "revoked JWT message is 'Session revoked'");

    // ===== TEST 12: Critical security incident created =====
    const incidents = await dbAll(
      "SELECT * FROM security_incidents WHERE user_id = ? AND severity = 'Critical' ORDER BY id DESC LIMIT 1",
      [docLogin1.body.user.id]
    );
    assert(incidents.length >= 1, "critical security incident created after deny");
    assert(incidents[0].summary.includes("Unauthorized Concurrent Login"), "incident title is correct");

    // ===== TEST 13: session:terminated socket event emitted =====
    await delay(300);
    const terminatedEvents = socketEvents.filter((e) => e.name === "session:terminated" || e.name === "admin:session:terminated");
    assert(terminatedEvents.length >= 1, "session:terminated event emitted");

    // ===== TEST 14: verification:denied socket event =====
    const deniedEvents = socketEvents.filter((e) => e.name === "verification:denied" || e.name === "admin:verification:denied");
    assert(deniedEvents.length >= 1, "verification:denied event emitted");

    // ===== TEST 15: Audit logs created =====
    const auditLogs = await dbAll("SELECT * FROM audit_logs WHERE user_id = ?", [docLogin1.body.user.id]);
    assert(auditLogs.length >= 3, "audit logs created for verification actions");

    // ===== TEST 18: Admin trusted devices page data =====
    const trustedDevicesRes = await httpReq("GET", "/api/admin/trusted-devices", adminAuth);
    assert(trustedDevicesRes.status === 200, "admin can list trusted devices");
    assert(trustedDevicesRes.body.devices.length >= 1, "trusted devices list non-empty");

    // ===== TEST 19: Non-existent verification returns 404 (run before admin terminates doc1) =====
    const nonExistRes = await httpReq("POST", "/api/sessions/verifications/99999/confirm", docAuth1);
    assert(nonExistRes.status === 404, "non-existent verification returns 404");

    // ===== TEST 20: Session timeline events exist =====
    const timelineRes = await httpReq(
      "GET", `/api/admin/sessions/${verifications2[0].suspicious_session_id}/timeline`, adminAuth
    );
    assert(timelineRes.status === 200, "session timeline API works");
    assert(timelineRes.body.events.length >= 3, "session timeline has multiple events");

    // ===== Now admin terminates the first doctor's session (must be after tests using docAuth1) =====
    const firstSession = await dbGet(
      "SELECT * FROM active_sessions WHERE session_id = ?",
      [JSON.parse(Buffer.from(docToken1.split(".")[1], "base64url").toString()).sessionId]
    );
    const adminTerminateRes = await httpReq(
      "POST", `/api/admin/sessions/${firstSession.session_id}/terminate`, adminAuth
    );
    assert(adminTerminateRes.status === 200, "admin can terminate a session");

    const adminTerminatedSession = await dbGet(
      "SELECT * FROM active_sessions WHERE session_id = ?",
      [firstSession.session_id]
    );
    assert(adminTerminatedSession.status === "terminated", "admin-terminated session is terminated");

    // ===== Admin can trust a device =====
    const sessions = await dbAll("SELECT * FROM active_sessions WHERE is_trusted = 0 LIMIT 1");
    if (sessions.length > 0) {
      const trustRes = await httpReq(
        "POST", `/api/admin/sessions/${sessions[0].session_id}/trust-device`, adminAuth
      );
      assert(trustRes.status === 200, "admin can trust a device");
    } else {
      assert(true, "admin can trust a device (no untrusted session to test — skipped)");
    }

    doctorClient.disconnect();
    adminClient.disconnect();
  } catch (err) {
    console.error("Test harness error:", err);
    failed++;
  } finally {
    if (doctorClient) doctorClient.disconnect();
    server.kill("SIGTERM");
    await delay(300);
    try {
      await dbRun("DELETE FROM active_sessions");
      await dbRun("DELETE FROM trusted_devices");
      await dbRun("DELETE FROM revoked_tokens");
      await dbRun("DELETE FROM activity_logs");
      await dbRun("DELETE FROM security_incidents");
      await dbRun("DELETE FROM session_verifications");
      await dbRun("DELETE FROM doctor_mobile_devices");
      await dbRun("DELETE FROM audit_logs");
      await dbRun("DELETE FROM session_events");
    } catch (_) {}
    console.log(failed === 0 ? "\nALL PHASE 3B TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
