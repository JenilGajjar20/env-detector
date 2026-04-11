#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline-sync");
const { scanProject, scanSecurity } = require("../src/scan");

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");

const args = process.argv.slice(2);

const askMode = args.includes("--ask");
const compareMode = args.includes("--compare");
const checkMode = args.includes("--check");
const fixMode = args.includes("--fix");
const securityMode = args.includes("--security");
const strictMode = args.includes("--strict");
const versionMode = args.includes("--version") || args.includes("--v")

let result = scanProject(cwd);

if (versionMode) {
  const pkg = require("../package.json");
  console.log(`env-detector v${pkg.version}`);
  process.exit(0);
}

// security
if (securityMode) {
  const issues = scanSecurity(cwd);

  if (!issues.length) {
    console.log("✔ No security issues\n");
    process.exit(0);
  }

  console.log("\nSecurity issues:\n");
  issues.forEach(i => console.log(" -", i.file));
  console.log("");

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


// create env
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, "");
}


// grouped generation
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
  result.unused.forEach(key => delete envMap[key]);
}


const newContent = Object.entries(envMap)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");

fs.writeFileSync(envPath, newContent + "\n");


// strict
if (strictMode) {
  if (
    result.missing.length ||
    result.empty.length ||
    result.unused.length
  ) {
    console.log("✖ strict mode failed\n");
    process.exit(1);
  }

  console.log("✔ strict mode passed\n");
  process.exit(0);
}


console.log("✔ env scan complete\n");