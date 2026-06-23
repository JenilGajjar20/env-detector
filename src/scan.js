const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { parseEnv } = require("./writer");

function scanProject(rootDir) {
  const usedEnvVars = new Set();
  const defaultValues = new Map();
  const groupedEnv = {};
  const locations = {};
  const parseErrors = [];

  function recordUsage(key, filePath, node) {
    if (!key) return;

    usedEnvVars.add(key);

    if (!locations[key]) {
      locations[key] = [];
    }

    locations[key].push({
      file: path.relative(rootDir, filePath),
      line: node.loc?.start?.line || null
    });
  }

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
                  recordUsage(key, fullPath, prop.value);
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
                    recordUsage(key, fullPath, left);

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

                recordUsage(key, fullPath, node);
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
                      recordUsage(prop.key.name, fullPath, prop);
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

                recordUsage(key, fullPath, left);

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

        } catch (err) {
          parseErrors.push({
            file: path.relative(rootDir, fullPath),
            message: err.message
          });
        }
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
    const parsed = parseEnv(envContent);

    parsed.vars.forEach((entry, key) => {
      envFileVars.add(key);

      if (!entry.value || entry.value.trim() === "") {
        emptyVars.add(key);
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
    grouped: groupedEnv,
    locations,
    parseErrors
  };
}


// security scan
function scanSecurity(rootDir) {

  const issues = [];
  const ignoredEnvPatterns = getIgnoredEnvPatterns(rootDir);

  function scan(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {

      if (
        file === "node_modules" ||
        file === ".git" ||
        file === "dist" ||
        file === "build" ||
        (file.startsWith(".") && file !== ".env")
      ) continue;

      const full = path.join(dir, file);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        scan(full);
      } else if (/\.(js|ts|env)$/.test(file)) {
        const content = fs.readFileSync(full, "utf8");
        const isEnvFile = file === ".env" || file.endsWith(".env");

        const lines = content.split("\n");
        lines.forEach((line, index) => {
          if (isEnvFile && isIgnoredEnvFile(file, ignoredEnvPatterns)) {
            return;
          }

          const issue = detectSecret(line, isEnvFile);
          if (issue) {
            issues.push({
              file: full,
              line: index + 1,
              snippet: line.trim(),
              type: issue.type,
              message: issue.message
            });
          }
        });
      }
    }
  }

  scan(rootDir);
  return issues;
}

function getIgnoredEnvPatterns(rootDir) {
  const gitignorePath = path.join(rootDir, ".gitignore");
  const patterns = [];

  if (!fs.existsSync(gitignorePath)) {
    return patterns;
  }

  const content = fs.readFileSync(gitignorePath, "utf8");

  content.split(/\r?\n/).forEach(line => {
    const pattern = line.trim();
    if (!pattern || pattern.startsWith("#") || pattern.startsWith("!")) return;

    const normalized = pattern.replace(/^\//, "");

    if (
      normalized === ".env" ||
      normalized === ".env*" ||
      normalized === ".env.*"
    ) {
      patterns.push(normalized);
    }
  });

  return patterns;
}

function isIgnoredEnvFile(file, patterns) {
  return patterns.some(pattern => {
    if (pattern === ".env") return file === ".env";
    if (pattern === ".env*" || pattern === ".env.*") return file.startsWith(".env");
    return false;
  });
}

function detectSecret(line, isEnvFile) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  return isEnvFile
    ? detectEnvSecret(trimmed)
    : detectSourceSecret(trimmed);
}

function detectEnvSecret(line) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY)[A-Za-z0-9_]*)\s*=\s*(.+)\s*$/i);

  if (!match) return null;

  const value = match[2].trim();
  if (!isSuspiciousEnvSecretValue(value)) return null;

  return {
    type: "env-file-secret",
    message: "Sensitive value found in .env. Make sure this file is not committed."
  };
}

function detectSourceSecret(line) {
  const match = line.match(
    /(?:^|[,{(]\s*|(?:const|let|var|private|public|protected|static|readonly)\s+)([A-Za-z_][A-Za-z0-9_]*(?:password|secret|token|apikey|api_key|private_key)[A-Za-z0-9_]*)\s*[:=]\s*(["'`])([^"'`]+)\2/i
  );

  if (!match) return null;

  const value = match[3].trim();
  if (!isSuspiciousSourceSecretValue(value)) return null;

  return {
    type: "hardcoded-secret",
    message: "Hardcoded secret-looking value found. Move this value to an environment variable."
  };
}

function isSuspiciousEnvSecretValue(value) {
  const normalized = value.toLowerCase().replace(/^["']|["']$/g, "");

  if (!normalized || normalized.length < 8) return false;
  if (isSafePlaceholder(normalized)) return false;
  if (normalized.startsWith("/") || /^https?:\/\//i.test(normalized)) return false;

  return true;
}

function isSuspiciousSourceSecretValue(value) {
  const normalized = value.toLowerCase();

  if (isSafePlaceholder(normalized)) return false;
  if (value.length < 8) return false;
  if (value.startsWith("/") || /^https?:\/\//i.test(value)) return false;
  if (/^process\.env\./i.test(value)) return false;
  if (/^[A-Za-z_$][A-Za-z0-9_$.]*(\(.*\))?$/.test(value)) return false;

  return true;
}

function isSafePlaceholder(value) {
  const safeValues = new Set([
    "string",
    "varchar",
    "text",
    "number",
    "boolean",
    "uuid",
    "auto_increment",
    "primary_key",
    "null",
    "undefined",
    "true",
    "false",
    "name",
    "id",
    "type",
    "label",
    "department",
    "category",
    "field",
    "header",
    "consumption",
    "duration"
  ]);

  return safeValues.has(value);
}

module.exports = {
  scanProject,
  scanSecurity
};
