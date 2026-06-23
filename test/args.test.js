const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs } = require("../src/args");

test("parseArgs maps long and short flags to named options", () => {
  const { options, unknownFlag } = parseArgs(["--compare", "-k", "--strict", "-v"]);

  assert.equal(unknownFlag, undefined);
  assert.equal(options.compare, true);
  assert.equal(options.check, true);
  assert.equal(options.strict, true);
  assert.equal(options.version, true);
  assert.equal(options.ask, false);
});

test("parseArgs reads --from-backup value from next argument", () => {
  const { options, unknownFlag } = parseArgs(["--from-backup", "env-backup"]);

  assert.equal(unknownFlag, undefined);
  assert.equal(options.fromBackup, true);
  assert.equal(options.fromBackupValue, "env-backup");
});

test("parseArgs reads --from-backup value from equals syntax", () => {
  const { options, unknownFlag } = parseArgs(["--from-backup=.env.backup"]);

  assert.equal(unknownFlag, undefined);
  assert.equal(options.fromBackup, true);
  assert.equal(options.fromBackupValue, ".env.backup");
});

test("parseArgs reports unknown flags", () => {
  const { unknownFlag } = parseArgs(["--unknown"]);

  assert.equal(unknownFlag, "--unknown");
});

test("parseArgs does not treat a value after --from-backup as an unknown flag", () => {
  const { options, unknownFlag } = parseArgs(["--from-backup", "env-backup", "--check"]);

  assert.equal(unknownFlag, undefined);
  assert.equal(options.fromBackupValue, "env-backup");
  assert.equal(options.check, true);
});
