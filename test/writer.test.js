const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  appendMissingVars,
  importFromBackup,
  parseEnv,
  removeEnvVars,
  updateEnvValues
} = require("../src/writer");

function createFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "env-detector-writer-"));
}

function envPath(rootDir) {
  return path.join(rootDir, ".env");
}

function readEnv(rootDir) {
  return fs.readFileSync(envPath(rootDir), "utf8");
}

test("parseEnv reads keys while ignoring comments and blank lines", () => {
  const parsed = parseEnv([
    "# comment",
    "",
    "DB_HOST=localhost",
    "export PORT=3000",
    "JWT_SECRET=",
    ""
  ].join("\n"));

  assert.equal(parsed.vars.get("DB_HOST").value, "localhost");
  assert.equal(parsed.vars.get("PORT").value, "3000");
  assert.equal(parsed.vars.get("JWT_SECRET").value, "");
  assert.equal(parsed.vars.has("# comment"), false);
});

test("appendMissingVars appends only missing keys and preserves existing content", () => {
  const rootDir = createFixture();

  fs.writeFileSync(envPath(rootDir), [
    "# database",
    "DB_HOST=localhost",
    "",
    "PORT=3000"
  ].join("\n"));

  const result = appendMissingVars(
    envPath(rootDir),
    ["DB_HOST", "JWT_SECRET", "NODE_ENV"],
    { NODE_ENV: "development" }
  );

  assert.deepEqual(result.added, ["JWT_SECRET", "NODE_ENV"]);
  assert.equal(readEnv(rootDir), [
    "# database",
    "DB_HOST=localhost",
    "",
    "PORT=3000",
    "",
    "JWT_SECRET=",
    "NODE_ENV=development",
    ""
  ].join("\n"));
});

test("appendMissingVars writes grouped missing keys when grouped config is provided", () => {
  const rootDir = createFixture();

  const result = appendMissingVars(
    envPath(rootDir),
    ["GLOBAL_KEY", "DB_USER", "DB_PASSWORD"],
    { GLOBAL_KEY: "global" },
    { development: ["DB_USER", "DB_PASSWORD"] }
  );

  assert.deepEqual(result.added, ["GLOBAL_KEY", "DB_USER", "DB_PASSWORD"]);
  assert.equal(readEnv(rootDir), [
    "GLOBAL_KEY=global",
    "",
    "# development",
    "DB_USER=",
    "DB_PASSWORD=",
    ""
  ].join("\n"));
});

test("updateEnvValues updates existing keys and appends new keys", () => {
  const rootDir = createFixture();

  fs.writeFileSync(envPath(rootDir), [
    "# app",
    "export PORT=3000",
    "JWT_SECRET=",
    ""
  ].join("\n"));

  const result = updateEnvValues(envPath(rootDir), {
    PORT: "4000",
    JWT_SECRET: "secret-value",
    NEW_KEY: "new-value"
  });

  assert.deepEqual(result.added, ["NEW_KEY"]);
  assert.deepEqual(result.updated, ["PORT", "JWT_SECRET"]);
  assert.equal(readEnv(rootDir), [
    "# app",
    "export PORT=4000",
    "JWT_SECRET=secret-value",
    "",
    "NEW_KEY=new-value",
    ""
  ].join("\n"));
});

test("removeEnvVars removes selected keys while preserving comments and unrelated lines", () => {
  const rootDir = createFixture();

  fs.writeFileSync(envPath(rootDir), [
    "# keep comment",
    "DB_HOST=localhost",
    "UNUSED=value",
    "",
    "PORT=3000",
    ""
  ].join("\n"));

  const result = removeEnvVars(envPath(rootDir), ["UNUSED", "MISSING"]);

  assert.deepEqual(result.removed, ["UNUSED"]);
  assert.equal(readEnv(rootDir), [
    "# keep comment",
    "DB_HOST=localhost",
    "",
    "PORT=3000",
    ""
  ].join("\n"));
});

test("importFromBackup fills only used keys and skips backup-only keys", () => {
  const rootDir = createFixture();
  const backupPath = path.join(rootDir, "env-backup");

  fs.writeFileSync(backupPath, [
    "DB_HOST=localhost",
    "JWT_SECRET=backup-secret",
    "OLD_KEY=unused",
    ""
  ].join("\n"));

  const result = importFromBackup(
    envPath(rootDir),
    backupPath,
    ["DB_HOST", "JWT_SECRET", "PORT"],
    { PORT: 3000 }
  );

  assert.deepEqual(result.added, ["DB_HOST", "JWT_SECRET", "PORT"]);
  assert.deepEqual(result.filledFromBackup, ["DB_HOST", "JWT_SECRET"]);
  assert.deepEqual(result.skippedBackupOnly, ["OLD_KEY"]);
  assert.equal(result.leftEmpty, 0);
  assert.equal(readEnv(rootDir), [
    "DB_HOST=localhost",
    "JWT_SECRET=backup-secret",
    "PORT=3000",
    ""
  ].join("\n"));
});

test("importFromBackup does not overwrite existing non-empty values", () => {
  const rootDir = createFixture();
  const backupPath = path.join(rootDir, "env-backup");

  fs.writeFileSync(envPath(rootDir), [
    "DB_HOST=current-host",
    "JWT_SECRET=",
    ""
  ].join("\n"));

  fs.writeFileSync(backupPath, [
    "DB_HOST=backup-host",
    "JWT_SECRET=backup-secret",
    "PORT=4000",
    ""
  ].join("\n"));

  const result = importFromBackup(
    envPath(rootDir),
    backupPath,
    ["DB_HOST", "JWT_SECRET", "PORT"]
  );

  assert.deepEqual(result.added, ["PORT"]);
  assert.deepEqual(result.updated, ["JWT_SECRET"]);
  assert.deepEqual(result.filledFromBackup, ["JWT_SECRET", "PORT"]);
  assert.equal(result.leftEmpty, 0);
  assert.equal(readEnv(rootDir), [
    "DB_HOST=current-host",
    "JWT_SECRET=backup-secret",
    "",
    "PORT=4000",
    ""
  ].join("\n"));
});
