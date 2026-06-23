#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline-sync");
const { createArgParser } = require("../src/args");
const { findEnvBackupFiles, resolveBackupPath } = require("../src/backup");
const {
  printCheck,
  printCompare,
  printEnvBackupNotice,
  printHelp,
  printSecurityIssues,
  printStrict,
  printSummary,
  sorted
} = require("../src/output");
const { scanProject, scanSecurity } = require("../src/scan");
const {
  appendMissingVars,
  importFromBackup,
  removeEnvVars,
  updateEnvValues
} = require("../src/writer");

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");
const args = process.argv.slice(2);
const validFlags = [
  "--ask", "-a",
  "--compare", "-c",
  "--check", "-k",
  "--fix", "-f",
  "--from-backup",
  "--security", "-s",
  "--strict", "-t",
  "--version", "-v",
  "--help", "-h"
];
const { findUnknownFlag, getFlagValue, hasFlag } = createArgParser(args, validFlags);
const askMode = hasFlag("--ask", "-a");
const compareMode = hasFlag("--compare", "-c");
const checkMode = hasFlag("--check", "-k");
const fixMode = hasFlag("--fix", "-f");
const fromBackupMode = hasFlag("--from-backup");
const securityMode = hasFlag("--security", "-s");
const strictMode = hasFlag("--strict", "-t");
const versionMode = hasFlag("--version", "-v");
const helpMode = hasFlag("--help", "-h");
const envBackupFiles = findEnvBackupFiles(cwd);

const unknownFlag = findUnknownFlag();

if (unknownFlag && !helpMode) {
  console.log(`\nError: Unknown flag "${unknownFlag}"`);
}

if (helpMode || (unknownFlag && !helpMode)) {
  printHelp();
  process.exit(unknownFlag ? 1 : 0);
}

if (versionMode) {
  const pkg = require("../package.json");
  console.log(`env-detector v${pkg.version}`);
  process.exit(0);
}

let result;

try {
  result = scanProject(cwd);
} catch (err) {
  console.error(`ERROR: Failed to scan project: ${err.message}`);
  process.exit(2);
}

if (securityMode) {
  const issues = scanSecurity(cwd);

  if (!issues.length) {
    console.log("OK: No security issues found");
    process.exit(0);
  }

  printSecurityIssues(issues, cwd);
  process.exit(0);
}

if (compareMode) {
  printCompare(result);
  process.exit(0);
}

if (checkMode) {
  printCheck(result);
  process.exit(result.missing.length || result.empty.length ? 1 : 0);
}

if (strictMode) {
  printStrict(result);
  process.exit(result.missing.length || result.empty.length || result.unused.length ? 1 : 0);
}

if (fixMode) {
  runFix(result);
  process.exit(0);
}

if (askMode) {
  runAsk(result);
  process.exit(0);
}

if (fromBackupMode) {
  runFromBackup(result);
  process.exit(0);
}

if (!result.missing.length) {
  console.log("OK: env scan complete");
  if (!result.used.length) {
    console.log("No environment variables detected in source files.");
  }
  console.log("No changes made.");
  printSummary(result);
  process.exit(0);
}

const writeResult = appendMissingVars(envPath, result.missing, result.defaults, result.grouped);

console.log("OK: env scan complete");
console.log(`Used: ${result.used.length}`);
console.log(`Added: ${writeResult.added.length}`);
console.log(`Empty: ${result.empty.length}`);
console.log(`Unused: ${result.unused.length}`);

if (writeResult.added.length) {
  console.log(`Updated: ${path.relative(cwd, envPath)}`);
  printEnvBackupNotice(envBackupFiles);
}

function runAsk(result) {
  const askList = unique([...result.missing, ...result.empty]).sort();

  if (!askList.length) {
    console.log("OK: No missing or empty variables found");
    return;
  }

  const values = {};

  askList.forEach(key => {
    const defaultHint = Object.prototype.hasOwnProperty.call(result.defaults, key)
      ? ` (detected default: ${result.defaults[key]})`
      : "";
    const prompt = `${key}${defaultHint} = `;

    values[key] = isLikelySecret(key)
      ? readline.questionNewPassword(prompt, { mask: "*" })
      : readline.question(prompt);
  });

  const updateResult = updateEnvValues(envPath, values);

  console.log("OK: .env updated");
  console.log(`Added: ${updateResult.added.length}`);
  console.log(`Updated: ${updateResult.updated.length}`);
}

function runFix(result) {
  if (!result.unused.length) {
    console.log("OK: No unused variables found");
    return;
  }

  console.log("\nUnused variables:");
  sorted(result.unused).forEach(key => console.log(`- ${key}`));
  console.log("");

  const varsToDelete = new Set();

  sorted(result.unused).forEach(key => {
    if (readline.keyInYN(`Delete unused variable "${key}"?`)) {
      varsToDelete.add(key);
    }
  });

  if (!varsToDelete.size) {
    console.log("OK: No changes made");
    return;
  }

  const removeResult = removeEnvVars(envPath, varsToDelete);

  console.log(`OK: Removed ${removeResult.removed.length} unused variable(s)`);
  console.log(`Updated: ${path.relative(cwd, envPath)}`);
}

function runFromBackup(result) {
  const explicitPath = getFlagValue("--from-backup");
  const resolvedBackup = resolveBackupPath(cwd, envBackupFiles, explicitPath);

  if (resolvedBackup.error) {
    console.error(`ERROR: ${resolvedBackup.error}`);
    if (resolvedBackup.hint) {
      console.error(resolvedBackup.hint);
    }
    process.exit(1);
  }

  const backupPath = resolvedBackup.path;

  if (explicitPath) {
    fs.copyFileSync(backupPath, envPath);
    console.log("OK: .env copied from backup");
    console.log(`Backup: ${path.relative(cwd, backupPath)}`);
    console.log(`Updated: ${path.relative(cwd, envPath)}`);
    return;
  }

  if (!result.used.length) {
    console.log("OK: env scan complete");
    console.log("No environment variables detected in source files.");
    console.log("No changes made.");
    return;
  }

  const importResult = importFromBackup(envPath, backupPath, result.used, result.defaults, result.grouped);

  console.log("OK: env scan complete");
  console.log(`Backup: ${path.relative(cwd, backupPath)}`);
  console.log(`Used: ${result.used.length}`);
  console.log(`Added: ${importResult.added.length}`);
  console.log(`Filled from backup: ${importResult.filledFromBackup.length}`);
  console.log(`Left empty: ${importResult.leftEmpty}`);
  console.log(`Skipped backup-only keys: ${importResult.skippedBackupOnly.length}`);
  console.log(`Updated: ${path.relative(cwd, envPath)}`);
}

function isLikelySecret(key) {
  return /(PASSWORD|SECRET|TOKEN|API_?KEY|JWT)/i.test(key);
}

function unique(values) {
  return Array.from(new Set(values));
}
