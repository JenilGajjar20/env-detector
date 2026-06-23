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

test("--from-backup <path> copies the backup file directly to .env", () => {
  const rootDir = createFixture();
  const backupContent = [
    "DB_HOST=localhost",
    "JWT_SECRET=backup-secret",
    "OLD_KEY=kept-because-explicit-copy",
    ""
  ].join("\n");

  fs.writeFileSync(path.join(rootDir, "env-backup"), backupContent);

  const output = childProcess.execFileSync(
    process.execPath,
    [cliPath, "--from-backup", "env-backup"],
    { cwd: rootDir, encoding: "utf8" }
  );

  assert.match(output, /OK: \.env copied from backup/);
  assert.equal(fs.readFileSync(path.join(rootDir, ".env"), "utf8"), backupContent);
});
