// test/socket-event-test.js
// Verifies the real-time auth:user-login event reaches a connected client
// when a doctor logs in. Spawns the server, connects a Socket.IO client,
// triggers a doctor login via HTTP, and asserts the event payload.

const { spawn } = require("child_process");
const http = require("http");
const io = require("socket.io-client");

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
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
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

    // Connect a Socket.IO client (simulates the admin dashboard).
    const client = io("http://localhost:3000", { transports: ["websocket"] });

    const events = {};
    await new Promise((resolve) => client.on("connect", resolve));
    console.log("PASS  socket client connected");

    client.on("system:connection", (d) => { events.systemConnection = d; });
    client.on("auth:user-login", (d) => { events.authUserLogin = d; });

    // Trigger a doctor login over HTTP.
    const docLogin = await httpReq("POST", "/api/auth/login", {}, {
      username: "doctor", password: "doctor123", expectedRole: "doctor",
    });
    assert(JSON.parse(docLogin.body).success === true, "doctor login HTTP call succeeds");

    // Give the event a moment to arrive.
    await delay(500);

    assert(!!events.systemConnection, "received system:connection event");
    assert(!!events.authUserLogin, "received auth:user-login event");
    if (events.authUserLogin) {
      const e = events.authUserLogin;
      assert(e.username === "doctor", "event username is doctor");
      assert(e.fullName === "Dr. Alex Morgan", "event fullName is Dr. Alex Morgan");
      assert(e.role === "doctor", "event role is doctor");
      assert(e.doctorId === "DOC001", "event doctorId is DOC001");
      assert(e.department === "Cardiology", "event department is Cardiology");
      assert(typeof e.ipAddress === "string" && e.ipAddress.length > 0, "event ipAddress is populated");
      assert(typeof e.loginTime === "string" && e.loginTime.length > 0, "event loginTime is populated");
    }

    client.disconnect();
  } catch (err) {
    console.error("Test harness error:", err);
    failed++;
  } finally {
    server.kill("SIGTERM");
    await delay(300);
    console.log(failed === 0 ? "\nALL SOCKET TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
