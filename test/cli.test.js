const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "bin", "env-scan.js");

function createFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "env-detector-cli-"));
}

function writeFile(rootDir, filePath, content) {
  const fullPath = path.join(rootDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function runCli(rootDir, args = []) {
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: rootDir,
    encoding: "utf8"
  });
}

test("default command does not create .env when no variables are detected", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", "const value = 1;\n");

  const result = runCli(rootDir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No environment variables detected/);
  assert.equal(fs.existsSync(path.join(rootDir, ".env")), false);
});

test("default command creates .env with missing variables", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", [
    "process.env.DB_HOST;",
    "process.env.PORT || 3000;",
    ""
  ].join("\n"));

  const result = runCli(rootDir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Added: 2/);
  assert.equal(fs.readFileSync(path.join(rootDir, ".env"), "utf8"), [
    "DB_HOST=",
    "PORT=3000",
    ""
  ].join("\n"));
});

test("--compare reports used, missing, empty, and unused variables without writing", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", "process.env.DB_HOST;\nprocess.env.PORT;\n");
  writeFile(rootDir, ".env", "DB_HOST=localhost\nEMPTY=\nUNUSED=value\n");

  const before = fs.readFileSync(path.join(rootDir, ".env"), "utf8");
  const result = runCli(rootDir, ["--compare"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Used \(2\):/);
  assert.match(result.stdout, /Missing \(1\):/);
  assert.match(result.stdout, /Empty \(1\):/);
  assert.match(result.stdout, /Unused \(2\):/);
  assert.equal(fs.readFileSync(path.join(rootDir, ".env"), "utf8"), before);
});

test("--check fails on missing variables but ignores unused variables", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", "process.env.DB_HOST;\nprocess.env.PORT;\n");
  writeFile(rootDir, ".env", "DB_HOST=localhost\nUNUSED=value\n");

  const result = runCli(rootDir, ["--check"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR: ENV check failed/);
  assert.match(result.stdout, /Missing \(1\):/);
  assert.match(result.stdout, /Unused variables are reported by --compare/);
});

test("--strict fails on missing and unused variables", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", "process.env.DB_HOST;\nprocess.env.PORT;\n");
  writeFile(rootDir, ".env", "DB_HOST=localhost\nUNUSED=value\n");

  const result = runCli(rootDir, ["--strict"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR: strict mode failed/);
  assert.match(result.stdout, /Missing \(1\):/);
  assert.match(result.stdout, /Unused \(1\):/);
});

test("--security reports hardcoded source secrets and unignored .env secrets", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", "const JWT_SECRET = \"hardcoded-secret\";\n");
  writeFile(rootDir, ".env", "SMTP_PASSWORD=mail-password\n");

  const result = runCli(rootDir, ["--security"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Security issues found:/);
  assert.match(result.stdout, /Hardcoded secret-looking value found/);
  assert.match(result.stdout, /Sensitive value found in \.env/);
});

test("--security skips .env values when .env is ignored", () => {
  const rootDir = createFixture();

  writeFile(rootDir, ".gitignore", ".env\n");
  writeFile(rootDir, ".env", "SMTP_PASSWORD=mail-password\n");

  const result = runCli(rootDir, ["--security"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /OK: No security issues found/);
});

test("unknown flags fail and show help", () => {
  const rootDir = createFixture();

  const result = runCli(rootDir, ["--unknown"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Error: Unknown flag "--unknown"/);
  assert.match(result.stdout, /Usage: env-detector/);
});

test("--from-backup <path> copies the backup file directly to .env", () => {
  const rootDir = createFixture();
  const backupContent = [
    "DB_HOST=localhost",
    "JWT_SECRET=backup-secret",
    "OLD_KEY=kept-because-explicit-copy",
    ""
  ].join("\n");

  writeFile(rootDir, "env-backup", backupContent);
  const result = runCli(rootDir, ["--from-backup", "env-backup"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /OK: \.env copied from backup/);
  assert.equal(fs.readFileSync(path.join(rootDir, ".env"), "utf8"), backupContent);
});
