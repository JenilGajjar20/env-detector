#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline-sync");
const { scanProject, scanSecurity } = require("../src/scan");
const {
  appendMissingVars,
  removeEnvVars,
  updateEnvValues
} = require("../src/writer");

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");
const args = process.argv.slice(2);

const askMode = hasFlag("--ask", "-a");
const compareMode = hasFlag("--compare", "-c");
const checkMode = hasFlag("--check", "-k");
const fixMode = hasFlag("--fix", "-f");
const securityMode = hasFlag("--security", "-s");
const strictMode = hasFlag("--strict", "-t");
const versionMode = hasFlag("--version", "-v");
const helpMode = hasFlag("--help", "-h");
const envBackupFiles = findEnvBackupFiles(cwd);

const validFlags = [
  "--ask", "-a",
  "--compare", "-c",
  "--check", "-k",
  "--fix", "-f",
  "--security", "-s",
  "--strict", "-t",
  "--version", "-v",
  "--help", "-h"
];

const unknownFlag = args.find(arg => arg.startsWith("-") && !validFlags.includes(arg));

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

  console.log("\nSecurity issues found:");
  issues.forEach(issue => {
    console.log(`- ${path.relative(cwd, issue.file)}:${issue.line}`);
    console.log(`  ${issue.snippet}`);
    console.log(`  ${issue.message}`);
  });
  console.log(`\nSummary: ${issues.length} potential issue(s) found`);
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

function printCompare(result) {
  console.log("");
  printCategory("Used", result.used, result);
  printCategory("Missing", result.missing, result);
  printCategory("Empty", result.empty, result);
  printCategory("Unused", result.unused, result);

  if (result.parseErrors.length) {
    console.log(`\nSkipped files: ${result.parseErrors.length}`);
    result.parseErrors.forEach(err => console.log(`- ${err.file}: ${err.message}`));
  }

  console.log("\nSummary:");
  printSummary(result);
}

function printCheck(result) {
  if (!result.missing.length && !result.empty.length) {
    console.log("OK: ENV check passed");
    printSummary(result);
    return;
  }

  console.log("ERROR: ENV check failed");
  printCategory("Missing", result.missing, result);
  printCategory("Empty", result.empty, result);
  console.log("\nUnused variables are reported by --compare and enforced by --strict.");
}

function printStrict(result) {
  if (!result.missing.length && !result.empty.length && !result.unused.length) {
    console.log("OK: strict mode passed");
    printSummary(result);
    return;
  }

  console.log("ERROR: strict mode failed");
  printCategory("Missing", result.missing, result);
  printCategory("Empty", result.empty, result);
  printCategory("Unused", result.unused, result);
  console.log("\nSummary:");
  printSummary(result);
}

function printCategory(label, values, result) {
  console.log(`\n${label} (${values.length}):`);

  if (!values.length) {
    console.log("  none");
    return;
  }

  sorted(values).forEach(key => {
    const defaultValue = Object.prototype.hasOwnProperty.call(result.defaults, key)
      ? ` default=${result.defaults[key]}`
      : "";
    const locations = result.locations[key]?.length
      ? ` (${formatLocations(result.locations[key])})`
      : "";

    console.log(`  - ${key}${defaultValue}${locations}`);
  });
}

function printSummary(result) {
  console.log(`Used: ${result.used.length}`);
  console.log(`Missing: ${result.missing.length}`);
  console.log(`Empty: ${result.empty.length}`);
  console.log(`Unused: ${result.unused.length}`);
}

function formatLocations(locations) {
  return locations
    .slice(0, 3)
    .map(location => location.line ? `${location.file}:${location.line}` : location.file)
    .join(", ");
}

function isLikelySecret(key) {
  return /(PASSWORD|SECRET|TOKEN|API_?KEY|JWT)/i.test(key);
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function unique(values) {
  return Array.from(new Set(values));
}

function hasFlag(longFlag, shortFlag) {
  return args.includes(longFlag) || args.includes(shortFlag);
}

function findEnvBackupFiles(rootDir) {
  const exactNames = new Set([
    ".env.backup",
    ".env.bak",
    ".env_backup",
    "env-backup",
    "env.backup",
    "env.bak",
    "env_backup"
  ]);

  return fs.readdirSync(rootDir)
    .filter(file => exactNames.has(file.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function printEnvBackupNotice(files) {
  if (!files.length) return;

  console.log("");
  console.log(`Notice: Found env backup file(s): ${files.join(", ")}`);
  console.log("Values were not copied automatically. Review them manually before moving secrets into .env.");
}

function printHelp() {
  console.log(`
Usage: env-detector [options]

Read-only options:
  -c, --compare    Show used, missing, empty, and unused variables
  -k, --check      Fail if variables are missing or empty
  -s, --security   Scan for hardcoded secrets in source files and .env
  -t, --strict     Fail if variables are missing, empty, or unused
  -v, --version    Show version information
  -h, --help       Show this help message

Write options:
  env-detector     Add missing variables to .env
  -a, --ask        Prompt for missing or empty values
  -f, --fix        Interactively remove unused variables from .env

Examples:
  env-detector --compare
  env-detector --check
  env-detector --strict
  env-detector --ask
  env-detector --fix
  env-detector --security
  `);
}
