// test/syntax-check.js
// Build step: parses every server-side JS file to catch syntax errors.
// This is a vanilla Node/HTML/CSS project (no bundler), so a syntax check
// is the appropriate "build" verification.

const { execFileSync } = require("child_process");
const path = require("path");

const files = [
  "server.js",
  "database/database.js",
  "database/seed.js",
  "middleware/authMiddleware.js",
  "routes/authRoutes.js",
  "routes/activityRoutes.js",
  "routes/adminRoutes.js",
  "services/socketService.js",
  "services/riskEngine.js",
  "services/activityService.js",
  "test/run-tests.js",
  "test/socket-event-test.js",
  "test/phase2-tests.js",
];

let failed = 0;

for (const rel of files) {
  const file = path.join(__dirname, "..", rel);
  try {
    // node --check parses without executing.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log("PASS  " + rel);
  } catch (err) {
    failed++;
    console.error("FAIL  " + rel);
    console.error(err.stderr ? err.stderr.toString() : err.message);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}
console.log("\nBUILD OK - all server-side files pass syntax check.");
