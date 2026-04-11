const fs = require("fs");
const path = require("path");

function updateEnv(vars) {
  const envPath = path.join(process.cwd(), ".env");

  let existing = "";

  if (fs.existsSync(envPath)) {
    existing = fs.readFileSync(envPath, "utf8");
  }

  let output = existing;

  vars.forEach(key => {
    if (!existing.includes(key + "=")) {
      output += `\n${key}=`;
    }
  });

  fs.writeFileSync(envPath, output);
}

module.exports = { updateEnv };