const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  appendMissingVars,
  importFromBackup,
  isEmptyEnvValue,
  normalizeEnvValue,
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

test("parseEnv strips inline comments from unquoted values", () => {
  const parsed = parseEnv([
    "PLAIN=value # comment",
    "EMPTY= # comment",
    "HASH_VALUE=value#not-comment",
    "QUOTED=\"value # not comment\" # comment",
    "SINGLE='value # not comment' # comment",
    ""
  ].join("\n"));

  assert.equal(parsed.vars.get("PLAIN").value, "value");
  assert.equal(parsed.vars.get("EMPTY").value, "");
  assert.equal(parsed.vars.get("HASH_VALUE").value, "value#not-comment");
  assert.equal(parsed.vars.get("QUOTED").value, "\"value # not comment\"");
  assert.equal(parsed.vars.get("SINGLE").value, "'value # not comment'");
});

test("parseEnv handles CRLF content", () => {
  const parsed = parseEnv([
    "DB_HOST=localhost",
    "EMPTY='' # required later",
    "QUOTED=\"value # retained\" # comment",
    ""
  ].join("\r\n"));

  assert.equal(parsed.vars.get("DB_HOST").value, "localhost");
  assert.equal(parsed.vars.get("EMPTY").value, "''");
  assert.equal(parsed.vars.get("QUOTED").value, '"value # retained"');
});

test("normalizeEnvValue removes wrapping quotes for validation", () => {
  assert.equal(normalizeEnvValue('""'), "");
  assert.equal(normalizeEnvValue("''"), "");
  assert.equal(normalizeEnvValue("'   '"), "");
  assert.equal(normalizeEnvValue('"hello"'), "hello");
  assert.equal(normalizeEnvValue("'hello world'"), "hello world");
  assert.equal(normalizeEnvValue("plain-value"), "plain-value");
});

test("isEmptyEnvValue treats quoted blank values as empty", () => {
  assert.equal(isEmptyEnvValue(""), true);
  assert.equal(isEmptyEnvValue("   "), true);
  assert.equal(isEmptyEnvValue('""'), true);
  assert.equal(isEmptyEnvValue("''"), true);
  assert.equal(isEmptyEnvValue("'   '"), true);
  assert.equal(isEmptyEnvValue('"actual"'), false);
  assert.equal(isEmptyEnvValue("' actual '"), false);
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

test("appendMissingVars does not duplicate keys across grouped sections", () => {
  const rootDir = createFixture();

  const result = appendMissingVars(
    envPath(rootDir),
    ["DB_USERNAME", "DB_PASSWORD"],
    {},
    {
      development: ["DB_USERNAME", "DB_PASSWORD"],
      production: ["DB_USERNAME"]
    }
  );

  assert.deepEqual(result.added, ["DB_USERNAME", "DB_PASSWORD"]);
  assert.equal(readEnv(rootDir), [
    "# development",
    "DB_USERNAME=",
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

test("updateEnvValues preserves inline comments on updated lines", () => {
  const rootDir = createFixture();

  fs.writeFileSync(envPath(rootDir), [
    "PORT=3000 # app port",
    "JWT_SECRET= # required secret",
    ""
  ].join("\n"));

  const result = updateEnvValues(envPath(rootDir), {
    PORT: "4000",
    JWT_SECRET: "secret-value"
  });

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.updated, ["PORT", "JWT_SECRET"]);
  assert.equal(readEnv(rootDir), [
    "PORT=4000 # app port",
    "JWT_SECRET=secret-value # required secret",
    ""
  ].join("\n"));
});

test("writer operations preserve CRLF line endings", () => {
  const rootDir = createFixture();
  const filePath = envPath(rootDir);

  fs.writeFileSync(filePath, [
    "# app",
    "PORT=3000 # app port",
    "UNUSED=value",
    ""
  ].join("\r\n"));

  updateEnvValues(filePath, { PORT: "4000" });
  appendMissingVars(filePath, ["PORT", "JWT_SECRET"]);
  removeEnvVars(filePath, ["UNUSED"]);

  const content = readEnv(rootDir);
  assert.equal(content, [
    "# app",
    "PORT=4000 # app port",
    "",
    "JWT_SECRET=",
    ""
  ].join("\r\n"));
  assert.equal(content.replaceAll("\r\n", "").includes("\n"), false);
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
