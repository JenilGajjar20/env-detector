const path = require("path");

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

function printSecurityIssues(issues, cwd) {
  console.log("\nSecurity issues found:");
  issues.forEach(issue => {
    console.log(`- ${path.relative(cwd, issue.file)}:${issue.line}`);
    console.log(`  ${issue.snippet}`);
    console.log(`  ${issue.message}`);
  });
  console.log(`\nSummary: ${issues.length} potential issue(s) found`);
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
  --from-backup    Import values from an auto-detected env backup file
  --from-backup <path>
                   Copy the given backup file to .env

Examples:
  env-detector --compare
  env-detector --check
  env-detector --strict
  env-detector --ask
  env-detector --fix
  env-detector --from-backup
  env-detector --from-backup env-backup
  env-detector --security
  `);
}

function formatLocations(locations) {
  return locations
    .slice(0, 3)
    .map(location => location.line ? `${location.file}:${location.line}` : location.file)
    .join(", ");
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

module.exports = {
  printCheck,
  printCompare,
  printEnvBackupNotice,
  printHelp,
  printSecurityIssues,
  printStrict,
  printSummary,
  sorted
};
