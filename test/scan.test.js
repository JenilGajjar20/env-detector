const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { scanProject } = require("../src/scan");

function createFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "env-detector-scan-"));
}

function writeFile(rootDir, filePath, content) {
  const fullPath = path.join(rootDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function sort(values) {
  return [...values].sort();
}

test("scanProject detects used, missing, empty, unused, defaults, and locations", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", [
    "const host = process.env.DB_HOST;",
    "const port = process.env.PORT || 3000;",
    "const { JWT_SECRET } = process.env;",
    ""
  ].join("\n"));

  writeFile(rootDir, ".env", [
    "DB_HOST=localhost",
    "EMPTY=",
    "UNUSED=value",
    ""
  ].join("\n"));

  const result = scanProject(rootDir);

  assert.deepEqual(sort(result.used), ["DB_HOST", "JWT_SECRET", "PORT"]);
  assert.deepEqual(sort(result.missing), ["JWT_SECRET", "PORT"]);
  assert.deepEqual(sort(result.empty), ["EMPTY"]);
  assert.deepEqual(sort(result.unused), ["EMPTY", "UNUSED"]);
  assert.equal(result.defaults.PORT, 3000);
  assert.deepEqual(result.locations.DB_HOST, [{ file: path.join("src", "app.js"), line: 1 }]);
});

test("scanProject detects grouped config variables and defaults", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "config/database.ts", [
    "export default {",
    "  development: {",
    "    username: process.env.DBUSER,",
    "    password: process.env.DBPASSWORD || \"dev-password\"",
    "  }",
    "};",
    ""
  ].join("\n"));

  const result = scanProject(rootDir);

  assert.deepEqual(sort(result.used), ["DBPASSWORD", "DBUSER"]);
  assert.deepEqual(sort(result.grouped.development), ["DBPASSWORD", "DBUSER"]);
  assert.equal(result.defaults.DBPASSWORD, "dev-password");
});

test("scanProject records parse errors while continuing to scan valid files", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/valid.js", "process.env.OK_VAR;\n");
  writeFile(rootDir, "src/invalid.js", "const broken = ;\n");

  const result = scanProject(rootDir);

  assert.deepEqual(result.used, ["OK_VAR"]);
  assert.deepEqual(result.missing, ["OK_VAR"]);
  assert.equal(result.parseErrors.length, 1);
  assert.equal(result.parseErrors[0].file, path.join("src", "invalid.js"));
  assert.match(result.parseErrors[0].message, /Unexpected token|Unexpected/);
});
