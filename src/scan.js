const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

function scanProject(rootDir) {
  const usedEnvVars = new Set();
  const defaultValues = new Map();
  const groupedEnv = {};

  function scanDir(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      if (
        file === "node_modules" ||
        file === ".git" ||
        file === "dist" ||
        file === "build" ||
        file.startsWith(".")
      ) continue;

      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(js|ts|jsx|tsx)$/.test(file)) {
        const content = fs.readFileSync(fullPath, "utf8");

        try {
          const ast = parser.parse(content, {
            sourceType: "module",
            plugins: ["typescript", "jsx"],
          });

          traverse(ast, {

            // detect grouped config (development/staging/etc)
            ObjectProperty(path) {

              const envName = path.node.key.name;

              if (!path.node.value || path.node.value.type !== "ObjectExpression")
                return;

              const vars = new Set();

              path.node.value.properties.forEach(prop => {

                if (!prop.value) return;

                // process.env.KEY
                if (
                  prop.value.type === "MemberExpression" &&
                  prop.value.object?.object?.name === "process" &&
                  prop.value.object?.property?.name === "env"
                ) {
                  const key =
                    prop.value.property.name ||
                    prop.value.property.value;

                  vars.add(key);
                  usedEnvVars.add(key);
                }

                // process.env.KEY || value
                if (prop.value.type === "LogicalExpression") {

                  const left = prop.value.left;
                  const right = prop.value.right;

                  if (
                    left.type === "MemberExpression" &&
                    left.object?.object?.name === "process"
                  ) {
                    const key =
                      left.property.name || left.property.value;

                    vars.add(key);
                    usedEnvVars.add(key);

                    if (
                      right.type === "StringLiteral" ||
                      right.type === "NumericLiteral" ||
                      right.type === "BooleanLiteral"
                    ) {
                      defaultValues.set(key, right.value);
                    }
                  }
                }

              });

              if (vars.size) {
                groupedEnv[envName] = Array.from(vars);
              }
            },

            // standalone process.env.KEY
            MemberExpression(path) {
              const node = path.node;

              if (
                node.object &&
                node.object.type === "MemberExpression" &&
                node.object.object?.name === "process" &&
                node.object.property?.name === "env"
              ) {
                const key =
                  node.property.name || node.property.value;

                usedEnvVars.add(key);
              }
            },

            // destructuring
            VariableDeclarator(path) {
              if (
                path.node.init &&
                path.node.init.type === "MemberExpression" &&
                path.node.init.object.name === "process" &&
                path.node.init.property.name === "env"
              ) {
                if (path.node.id.type === "ObjectPattern") {
                  path.node.id.properties.forEach(prop => {
                    if (prop.key?.name) {
                      usedEnvVars.add(prop.key.name);
                    }
                  });
                }
              }
            },

            // fallback detection
            LogicalExpression(path) {
              const left = path.node.left;
              const right = path.node.right;

              if (
                left.type === "MemberExpression" &&
                left.object?.object?.name === "process" &&
                left.object?.property?.name === "env"
              ) {
                const key =
                  left.property.name || left.property.value;

                usedEnvVars.add(key);

                if (
                  right.type === "StringLiteral" ||
                  right.type === "NumericLiteral" ||
                  right.type === "BooleanLiteral"
                ) {
                  defaultValues.set(key, right.value);
                }
              }
            },

          });

        } catch (err) {}
      }
    }
  }

  scanDir(rootDir);

  // read existing env
  const envPath = path.join(rootDir, ".env");
  const envFileVars = new Set();
  const emptyVars = new Set();

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");

    envContent.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const [key, value] = trimmed.split("=");

      if (key) {
        envFileVars.add(key.trim());

        if (!value || value.trim() === "") {
          emptyVars.add(key.trim());
        }
      }
    });
  }

  const missing = [...usedEnvVars].filter(
    key => !envFileVars.has(key)
  );

  const unused = [...envFileVars].filter(
    key => !usedEnvVars.has(key)
  );

  return {
    used: Array.from(usedEnvVars),
    missing,
    unused,
    empty: Array.from(emptyVars),
    defaults: Object.fromEntries(defaultValues),
    grouped: groupedEnv
  };
}


// security scan
function scanSecurity(rootDir) {

  const issues = [];

  const regex =
    /(password|secret|token|apikey|key)\s*[:=]\s*['"][^'"]+['"]/gi;

  function scan(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {

      if (file === "node_modules" || file === ".git") continue;

      const full = path.join(dir, file);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        scan(full);
      } else if (/\.(js|ts|env)$/.test(file)) {
        const content = fs.readFileSync(full, "utf8");

        if (regex.test(content)) {
          issues.push({ file: full });
        }
      }
    }
  }

  scan(rootDir);
  return issues;
}

module.exports = {
  scanProject,
  scanSecurity
};