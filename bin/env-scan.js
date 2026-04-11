#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline-sync");
const { scanProject, scanSecurity } = require("../src/scan");

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");

const args = process.argv.slice(2);

const askMode = args.includes("--ask") || args.includes("-a");
const compareMode = args.includes("--compare") || args.includes("-c");
const checkMode = args.includes("--check") || args.includes("-k");
const fixMode = args.includes("--fix") || args.includes("-f");
const securityMode = args.includes("--security") || args.includes("-s");
const strictMode = args.includes("--strict") || args.includes("-t");
const versionMode = args.includes("--version") || args.includes("-v")
const helpMode = args.includes("--help") || args.includes("-h");

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
  console.log(`
Usage: env-detector [options]

Options:
  -a, --ask        Interactive mode to fill missing or empty values
  -c, --compare    Show detailed comparison of used, missing, empty, and unused variables
  -k, --check      Exit with error if variables are missing or empty
  -f, --fix        Remove unused variables from .env
  -s, --security   Scan for hardcoded secrets in source files and .env
  -t, --strict     Fail if any issues (missing, empty, or unused) are found
  -v, --version    Show version information
  -h, --help       Show this help message
  `);
  process.exit(unknownFlag ? 1 : 0);
}

if (versionMode) {
  const pkg = require("../package.json");
  console.log(`env-detector v${pkg.version}`);
  process.exit(0);
}

let result = scanProject(cwd);

// interactive fix
const varsToDelete = new Set();

if (fixMode && result.unused.length) {
  console.log("\nReview unused variables:");
  result.unused.forEach(key => {
    if (readline.keyInYN(`Delete unused variable "${key}"?`)) {
      varsToDelete.add(key);
    }
  });
  console.log("");

  // update result to reflect choices
  const originalUnused = [...result.unused];
  result.unused = originalUnused.filter(k => varsToDelete.has(k));
  // if we chose NOT to delete it, it's effectively "used" for this run's purposes
  const kept = originalUnused.filter(k => !varsToDelete.has(k));
  result.used.push(...kept);

  // In-place fix to preserve formatting
  if (varsToDelete.size > 0 && fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split("\n");
    const newContent = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return true;
      const [key] = trimmed.split("=");
      return !varsToDelete.has(key.trim());
    }).join("\n");
    
    fs.writeFileSync(envPath, newContent);
    console.log(`✔ Removed ${varsToDelete.size} unused variables while preserving file structure.\n`);
    process.exit(0);
  }
} else if (fixMode) {
  console.log("✔ No unused variables found\n");
}

// security
if (securityMode) {
  const issues = scanSecurity(cwd);

  if (!issues.length) {
    console.log("✔ No security issues\n");
    process.exit(0);
  }

  console.log("\nSecurity issues found:\n");
  issues.forEach(i => {
    console.log(` - ${i.file}:${i.line}`);
    console.log(`   ${i.snippet}\n`);
  });

  process.exit(0);
}


// compare
if (compareMode) {

  console.log("\nUsed:");
  result.used.forEach(v => console.log(" -", v));

  console.log("\nMissing:");
  result.missing.forEach(v => console.log(" -", v));

  console.log("\nEmpty:");
  result.empty.forEach(v => console.log(" -", v));

  console.log("\nUnused:");
  result.unused.forEach(v => console.log(" -", v));

  console.log("");
  process.exit(0);
}


// check
if (checkMode) {

  if (result.missing.length || result.empty.length) {

    console.log("\nENV check failed");

    result.missing.forEach(v => console.log("Missing:", v));
    result.empty.forEach(v => console.log("Empty:", v));

    console.log("");
    process.exit(1);
  }

  console.log("✔ ENV check passed\n");
  process.exit(0);
}


if (strictMode) {
  let failed = false;

  if (result.missing.length) {
    failed = true;
    console.log("\nMissing variables:");
    result.missing.forEach(v => console.log(`  - ${v}`));
  }

  if (result.empty.length) {
    failed = true;
    console.log("\nEmpty variables:");
    result.empty.forEach(v => console.log(`  - ${v}`));
  }

  if (result.unused.length) {
    failed = true;
    console.log("\nUnused variables:");
    result.unused.forEach(v => console.log(`  - ${v}`));
  }

  if (failed) {
    console.log("\n✖ strict mode failed\n");
    process.exit(1);
  }

  console.log("✔ strict mode passed\n");
  process.exit(0);
}


// create env
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, "");
}


// grouped generation
if (Object.keys(result.grouped).length && !askMode) {

  let output = "";

  const groupedKeys = new Set();

  Object.values(result.grouped).forEach(keys => {
    keys.forEach(k => groupedKeys.add(k));
  });

  const globalKeys = result.used.filter(k => !groupedKeys.has(k));

  if (globalKeys.length) {
    output += "# global\n";

    globalKeys.forEach(key => {
      const value = result.defaults?.[key] ?? "";
      output += `${key}=${value}\n`;
    });

    output += "\n";
  }

  Object.entries(result.grouped).forEach(([env, keys]) => {

    output += `# ${env}\n`;

    keys.forEach(key => {
      const value = result.defaults?.[key] ?? "";
      output += `${key}=${value}\n`;
    });

    output += "\n";
  });

  fs.writeFileSync(envPath, output.trim() + "\n");

  console.log("✔ Generated grouped env file\n");
  process.exit(0);
}


// parse env to map
let content = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8")
  : "";

const envMap = {};

content.split("\n").forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const [k, ...rest] = line.split("=");
  if (!k) return;
  envMap[k.trim()] = rest.join("=");
});


// ask mode
const askList = [...new Set([...result.missing, ...result.empty])];

if (askMode && askList.length) {

  askList.forEach(key => {
    const value = readline.question(`${key} = `);
    envMap[key] = value;
  });

  const newContent = Object.entries(envMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  fs.writeFileSync(envPath, newContent + "\n");

  console.log("✔ .env updated\n");
  process.exit(0);
}


// add missing
result.missing.forEach(key => {
  const value = result.defaults?.[key] ?? "";
  if (!envMap[key]) {
    envMap[key] = value;
  }
});


// fix unused
if (fixMode) {
  varsToDelete.forEach(key => delete envMap[key]);
}


const newContent = Object.entries(envMap)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");

fs.writeFileSync(envPath, newContent + "\n");


console.log("✔ env scan complete\n");