const fs = require("fs");

function parseEnv(content) {
  const lines = content.split(/\r?\n/);
  const vars = new Map();

  lines.forEach((line, index) => {
    const parsed = parseEnvLine(line);
    if (!parsed) return;

    vars.set(parsed.key, {
      value: parsed.value,
      line: index
    });
  });

  return { lines, vars };
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!match) return null;

  return {
    key: match[1],
    value: match[2]
  };
}

function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return "";
  }

  return fs.readFileSync(envPath, "utf8");
}

function readEnvVars(envPath) {
  const content = readEnvFile(envPath);
  return parseEnv(content).vars;
}

function appendMissingVars(envPath, keys, defaults = {}, grouped = {}) {
  const content = readEnvFile(envPath);
  const { vars } = parseEnv(content);
  const missingKeys = unique(keys).filter(key => !vars.has(key));

  if (!missingKeys.length) {
    return { added: [] };
  }

  const groupedKeys = new Set();
  Object.values(grouped).forEach(keysForGroup => {
    keysForGroup.forEach(key => groupedKeys.add(key));
  });

  const chunks = [];
  const globalKeys = missingKeys.filter(key => !groupedKeys.has(key));

  if (globalKeys.length) {
    chunks.push(formatSection(null, globalKeys, defaults));
  }

  Object.entries(grouped).forEach(([group, keysForGroup]) => {
    const sectionKeys = keysForGroup.filter(key => missingKeys.includes(key));
    if (sectionKeys.length) {
      chunks.push(formatSection(group, sectionKeys, defaults));
    }
  });

  let output = content;
  if (output && !output.endsWith("\n")) {
    output += "\n";
  }
  if (output.trim() && chunks.length) {
    output += "\n";
  }
  output += chunks.join("\n\n") + "\n";

  fs.writeFileSync(envPath, output);
  return { added: missingKeys };
}

function importFromBackup(envPath, backupPath, keys, defaults = {}, grouped = {}) {
  const envContent = readEnvFile(envPath);
  const backupContent = readEnvFile(backupPath);
  const envVars = parseEnv(envContent).vars;
  const backupVars = parseEnv(backupContent).vars;
  const usedKeys = unique(keys);
  const appendValues = {};
  const updateValues = {};
  const filledKeys = new Set();

  usedKeys.forEach(key => {
    const existing = envVars.get(key);
    const backup = backupVars.get(key);
    const backupValue = backup?.value ?? "";
    const hasBackupValue = backupValue.trim() !== "";

    if (existing && existing.value.trim() !== "") {
      return;
    }

    if (hasBackupValue) {
      filledKeys.add(key);
    }

    if (existing) {
      if (hasBackupValue) {
        updateValues[key] = backupValue;
      }
      return;
    }

    appendValues[key] = hasBackupValue
      ? backupValue
      : defaults[key] ?? "";
  });

  const appendResult = appendMissingVars(envPath, Object.keys(appendValues), appendValues, grouped);
  const updateResult = updateEnvValues(envPath, updateValues);
  const skippedBackupOnly = Array.from(backupVars.keys()).filter(key => !usedKeys.includes(key));
  const leftEmpty = countEmptyUsedValues(envPath, usedKeys);

  return {
    added: appendResult.added,
    updated: updateResult.updated,
    filledFromBackup: Array.from(filledKeys),
    leftEmpty,
    skippedBackupOnly
  };
}

function updateEnvValues(envPath, values) {
  const content = readEnvFile(envPath);
  const parsed = parseEnv(content);
  const lines = content ? parsed.lines : [];
  const vars = parsed.vars;
  const added = [];
  const updated = [];

  Object.entries(values).forEach(([key, value]) => {
    const normalizedValue = value ?? "";

    if (vars.has(key)) {
      const lineIndex = vars.get(key).line;
      lines[lineIndex] = replaceEnvLineValue(lines[lineIndex], normalizedValue);
      updated.push(key);
    } else {
      lines.push(`${key}=${normalizedValue}`);
      added.push(key);
    }
  });

  fs.writeFileSync(envPath, normalizeTrailingNewline(lines.join("\n")));
  return { added, updated };
}

function removeEnvVars(envPath, keys) {
  if (!fs.existsSync(envPath)) {
    return { removed: [] };
  }

  const removeSet = new Set(keys);
  const content = readEnvFile(envPath);
  const lines = content.split(/\r?\n/);
  const removed = new Set();

  const keptLines = lines.filter(line => {
    const parsed = parseEnvLine(line);
    if (!parsed || !removeSet.has(parsed.key)) {
      return true;
    }

    removed.add(parsed.key);
    return false;
  });

  fs.writeFileSync(envPath, normalizeTrailingNewline(keptLines.join("\n")));
  return { removed: Array.from(removed) };
}

function replaceEnvLineValue(line, value) {
  return line.replace(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=).*$/, `$1${value}`);
}

function formatSection(name, keys, defaults) {
  const lines = [];

  if (name) {
    lines.push(`# ${name}`);
  }

  keys.forEach(key => {
    lines.push(`${key}=${defaults[key] ?? ""}`);
  });

  return lines.join("\n");
}

function normalizeTrailingNewline(content) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function unique(values) {
  return Array.from(new Set(values));
}

function countEmptyUsedValues(envPath, keys) {
  const vars = readEnvVars(envPath);

  return unique(keys).filter(key => {
    const entry = vars.get(key);
    return !entry || entry.value.trim() === "";
  }).length;
}

module.exports = {
  appendMissingVars,
  importFromBackup,
  parseEnv,
  readEnvVars,
  removeEnvVars,
  updateEnvValues
};
