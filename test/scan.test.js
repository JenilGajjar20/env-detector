const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { scanProject, scanSecurity } = require("../src/scan");

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

test("scanProject treats quoted blank env values as empty", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", [
    "process.env.EMPTY_DOUBLE;",
    "process.env.EMPTY_SINGLE;",
    "process.env.EMPTY_SPACES;",
    "process.env.NON_EMPTY;",
    ""
  ].join("\n"));

  writeFile(rootDir, ".env", [
    'EMPTY_DOUBLE=""',
    "EMPTY_SINGLE=''",
    "EMPTY_SPACES='   '",
    'NON_EMPTY="actual"',
    ""
  ].join("\n"));

  const result = scanProject(rootDir);

  assert.deepEqual(sort(result.empty), ["EMPTY_DOUBLE", "EMPTY_SINGLE", "EMPTY_SPACES"]);
  assert.equal(result.empty.includes("NON_EMPTY"), false);
});

test("scanProject handles inline .env comments when detecting empty values", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/app.js", [
    "process.env.EMPTY_WITH_COMMENT;",
    "process.env.VALUE_WITH_COMMENT;",
    "process.env.QUOTED_HASH;",
    ""
  ].join("\n"));

  writeFile(rootDir, ".env", [
    "EMPTY_WITH_COMMENT= # fill this later",
    "VALUE_WITH_COMMENT=present # comment",
    "QUOTED_HASH=\"value # inside quotes\" # comment",
    ""
  ].join("\n"));

  const result = scanProject(rootDir);

  assert.deepEqual(result.empty, ["EMPTY_WITH_COMMENT"]);
  assert.equal(result.missing.length, 0);
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

test("scanProject records defaults only for fallback logical operators", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "src/fallbacks.js", [
    "const port = process.env.PORT || 3000;",
    "const host = process.env.HOST ?? \"localhost\";",
    "const enabled = process.env.FEATURE_ENABLED && true;",
    ""
  ].join("\n"));

  const result = scanProject(rootDir);

  assert.deepEqual(sort(result.used), ["FEATURE_ENABLED", "HOST", "PORT"]);
  assert.equal(result.defaults.PORT, 3000);
  assert.equal(result.defaults.HOST, "localhost");
  assert.equal(Object.prototype.hasOwnProperty.call(result.defaults, "FEATURE_ENABLED"), false);
});

test("scanProject records grouped defaults only for fallback logical operators", () => {
  const rootDir = createFixture();

  writeFile(rootDir, "config/app.js", [
    "module.exports = {",
    "  development: {",
    "    port: process.env.PORT || 3000,",
    "    enabled: process.env.FEATURE_ENABLED && true",
    "  }",
    "};",
    ""
  ].join("\n"));

  const result = scanProject(rootDir);

  assert.deepEqual(sort(result.grouped.development), ["FEATURE_ENABLED", "PORT"]);
  assert.equal(result.defaults.PORT, 3000);
  assert.equal(Object.prototype.hasOwnProperty.call(result.defaults, "FEATURE_ENABLED"), false);
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

test("scanSecurity scans common JavaScript and TypeScript source extensions", () => {
  const rootDir = createFixture();
  const extensions = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];

  extensions.forEach(extension => {
    writeFile(
      rootDir,
      path.join("src", `secret.${extension}`),
      `const apiToken = "hardcoded-token-${extension}";\n`
    );
  });

  const issues = scanSecurity(rootDir);
  const issueFiles = issues.map(issue => path.basename(issue.file)).sort();

  assert.deepEqual(
    issueFiles,
    extensions.map(extension => `secret.${extension}`).sort()
  );
});

test("scanSecurity respects gitignore patterns for env files", () => {
  const rootDir = createFixture();

  writeFile(rootDir, ".gitignore", [
    ".env.local",
    "config/.env",
    "*.secret.env",
    ""
  ].join("\n"));

  writeFile(rootDir, ".env.local", "SMTP_PASSWORD=local-password\n");
  writeFile(rootDir, path.join("config", ".env"), "JWT_SECRET=config-secret\n");
  writeFile(rootDir, "production.secret.env", "API_KEY=production-secret\n");
  writeFile(rootDir, ".env", "DB_PASSWORD=root-password\n");

  const issues = scanSecurity(rootDir);

  assert.deepEqual(
    issues.map(issue => path.basename(issue.file)),
    [".env"]
  );
});

test("scanSecurity reports representative env and source secrets", () => {
  const rootDir = createFixture();

  writeFile(rootDir, ".env", [
    "JWT_SECRET=prod-jwt-secret-value",
    "API_KEY=prod-api-key-value",
    ""
  ].join("\n"));

  writeFile(rootDir, "src/secrets.js", [
    "const dbPassword = \"prod-db-password-value\";",
    "const privateToken = `prod-private-token-value`;",
    "const config = { apiKey: \"prod-source-api-key\" };",
    ""
  ].join("\n"));

  const issues = scanSecurity(rootDir);
  const issueTypes = issues.map(issue => issue.type).sort();

  assert.deepEqual(issueTypes, [
    "env-file-secret",
    "env-file-secret",
    "hardcoded-secret",
    "hardcoded-secret",
    "hardcoded-secret"
  ]);
});

test("scanSecurity ignores common placeholders and non-secret values", () => {
  const rootDir = createFixture();

  writeFile(rootDir, ".env", [
    "JWT_SECRET=secret",
    "API_KEY=placeholder",
    "SMTP_PASSWORD=short # comment should not make this suspicious",
    "TOKEN_URL=https://example.com/token",
    "CERT_PRIVATE_KEY=/etc/certs/private.key",
    ""
  ].join("\n"));

  writeFile(rootDir, "src/placeholders.js", [
    "const password = \"password\";",
    "const jwtSecret = \"process.env.JWT_SECRET\";",
    "const secretPath = \"/etc/secrets/app\";",
    "const tokenUrl = \"https://example.com/token\";",
    "const passwordField = \"varchar\";",
    ""
  ].join("\n"));

  const issues = scanSecurity(rootDir);

  assert.deepEqual(issues, []);
});
