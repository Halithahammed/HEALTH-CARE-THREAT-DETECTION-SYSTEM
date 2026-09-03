// test/run-tests.js
// One-shot integration test: starts the server, exercises the auth API,
// verifies static + socket.io serving, then shuts the server down.

const { spawn } = require("child_process");
const http = require("http");

function request(method, path, headers = {}, body = null) {
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
    // Wait for the server to boot.
    let up = false;
    for (let i = 0; i < 20; i++) {
      try {
        const h = await request("GET", "/api/health");
        if (h.status === 200) { up = true; break; }
      } catch (_) {}
      await delay(250);
    }
    assert(up, "server boots and /api/health responds 200");

    // 1. Admin login
    const adminLogin = await request("POST", "/api/auth/login", {}, {
      username: "admin", password: "admin123", expectedRole: "admin",
    });
    assert(adminLogin.status === 200 && adminLogin.body.success === true, "admin login returns 200 success");
    assert(adminLogin.body.token && typeof adminLogin.body.token === "string", "admin login returns a token");
    assert(adminLogin.body.user && adminLogin.body.user.role === "admin", "admin user role is admin");
    assert(!adminLogin.body.user.password_hash, "password_hash is not exposed on admin login");
    const adminToken = adminLogin.body.token;

    // 2. Doctor login
    const docLogin = await request("POST", "/api/auth/login", {}, {
      username: "doctor", password: "doctor123", expectedRole: "doctor",
    });
    assert(docLogin.status === 200 && docLogin.body.success === true, "doctor login returns 200 success");
    assert(docLogin.body.user.doctorId === "DOC001", "doctor user has doctorId DOC001");
    assert(docLogin.body.user.department === "Cardiology", "doctor user has department Cardiology");
    assert(!docLogin.body.user.password_hash, "password_hash is not exposed on doctor login");
    const docToken = docLogin.body.token;

    // 3. Protected /me with admin token
    const meAdmin = await request("GET", "/api/auth/me", { Authorization: "Bearer " + adminToken });
    assert(meAdmin.status === 200 && meAdmin.body.success === true, "/api/auth/me works with valid admin token");
    assert(meAdmin.body.user.role === "admin", "/me returns admin role");

    // 4. /me with no token -> 401
    const meNoToken = await request("GET", "/api/auth/me");
    assert(meNoToken.status === 401, "/me without token returns 401");

    // 5. Role mismatch: admin via doctor portal -> 403
    const roleMismatch = await request("POST", "/api/auth/login", {}, {
      username: "admin", password: "admin123", expectedRole: "doctor",
    });
    assert(roleMismatch.status === 403, "admin logging in with expectedRole doctor returns 403");
    assert(roleMismatch.body.message === "Access denied for this role", "role mismatch message correct");

    // 6. Bad password -> 401
    const badPw = await request("POST", "/api/auth/login", {}, {
      username: "admin", password: "wrong", expectedRole: "admin",
    });
    assert(badPw.status === 401, "wrong password returns 401");
    assert(badPw.body.message === "Invalid username or password", "bad password message correct");

    // 7. Invalid token -> 401
    const badToken = await request("GET", "/api/auth/me", { Authorization: "Bearer garbage.token.here" });
    assert(badToken.status === 401, "invalid token returns 401");

    // 8. Static admin-login.html
    const staticPage = await request("GET", "/admin-login.html");
    assert(staticPage.status === 200, "admin-login.html is served");

    // 9. Socket.io client
    const sio = await request("GET", "/socket.io/socket.io.js");
    assert(sio.status === 200, "socket.io client is served");

    // 10. doctor-dashboard.js served
    const dashJs = await request("GET", "/js/doctor-dashboard.js");
    assert(dashJs.status === 200, "doctor-dashboard.js is served");

    // 11. Unknown API route -> 404
    const unknown = await request("GET", "/api/unknown");
    assert(unknown.status === 404, "unknown /api route returns 404");

    // 12. Token expiry set to 8h (decode payload)
    const payload = JSON.parse(Buffer.from(adminToken.split(".")[1], "base64url").toString());
    assert(payload.exp - payload.iat === 8 * 60 * 60, "JWT expires in 8 hours");

  } catch (err) {
    console.error("Test harness error:", err);
    failed++;
  } finally {
    server.kill("SIGTERM");
    await delay(300);
    console.log(failed === 0 ? "\nALL TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
