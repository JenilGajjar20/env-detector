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
    value: splitEnvValueComment(match[2]).value
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
  const lineEnding = detectLineEnding(content);
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
    chunks.push(formatSection(null, globalKeys, defaults, lineEnding));
  }

  const writtenKeys = new Set();

  Object.entries(grouped).forEach(([group, keysForGroup]) => {
    const sectionKeys = unique(keysForGroup).filter(key =>
      missingKeys.includes(key) && !writtenKeys.has(key)
    );

    sectionKeys.forEach(key => writtenKeys.add(key));

    if (sectionKeys.length) {
      chunks.push(formatSection(group, sectionKeys, defaults, lineEnding));
    }
  });

  let output = content;
  if (output && !output.endsWith("\n")) {
    output += lineEnding;
  }
  if (output.trim() && chunks.length) {
    output += lineEnding;
  }
  output += chunks.join(`${lineEnding}${lineEnding}`) + lineEnding;

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
    const hasBackupValue = !isEmptyEnvValue(backupValue);

    if (existing && !isEmptyEnvValue(existing.value)) {
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
  const lineEnding = detectLineEnding(content);
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

  fs.writeFileSync(envPath, normalizeTrailingNewline(lines.join(lineEnding), lineEnding));
  return { added, updated };
}

function removeEnvVars(envPath, keys) {
  if (!fs.existsSync(envPath)) {
    return { removed: [] };
  }

  const removeSet = new Set(keys);
  const content = readEnvFile(envPath);
  const lineEnding = detectLineEnding(content);
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

  fs.writeFileSync(envPath, normalizeTrailingNewline(keptLines.join(lineEnding), lineEnding));
  return { removed: Array.from(removed) };
}

function replaceEnvLineValue(line, value) {
  const match = line.match(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)(.*)$/);
  if (!match) return line;

  const { comment } = splitEnvValueComment(match[2]);
  return `${match[1]}${value}${comment}`;
}

function formatSection(name, keys, defaults, lineEnding = "\n") {
  const lines = [];

  if (name) {
    lines.push(`# ${name}`);
  }

  keys.forEach(key => {
    lines.push(`${key}=${defaults[key] ?? ""}`);
  });

  return lines.join(lineEnding);
}

function normalizeTrailingNewline(content, lineEnding = "\n") {
  return content.endsWith("\n") ? content : `${content}${lineEnding}`;
}

function detectLineEnding(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function unique(values) {
  return Array.from(new Set(values));
}

function countEmptyUsedValues(envPath, keys) {
  const vars = readEnvVars(envPath);

  return unique(keys).filter(key => {
    const entry = vars.get(key);
    return !entry || isEmptyEnvValue(entry.value);
  }).length;
}

function normalizeEnvValue(value) {
  const trimmed = String(value ?? "").trim();
  const quote = trimmed[0];

  if (
    (quote === "\"" || quote === "'") &&
    trimmed.endsWith(quote) &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function isEmptyEnvValue(value) {
  return normalizeEnvValue(value) === "";
}

function splitEnvValueComment(value) {
  const input = String(value ?? "");
  const commentIndex = findInlineCommentIndex(input);

  if (commentIndex === -1) {
    return { value: input, comment: "" };
  }

  return {
    value: input.slice(0, commentIndex).trimEnd(),
    comment: input.slice(commentIndex)
  };
}

function findInlineCommentIndex(value) {
  let quote = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];

    if ((char === "\"" || char === "'") && previous !== "\\") {
      if (quote === char) {
        quote = null;
      } else if (!quote) {
        quote = char;
      }
      continue;
    }

    if (
      char === "#" &&
      !quote &&
      (index === 0 || /\s/.test(previous))
    ) {
      let commentStart = index;

      while (commentStart > 0 && /\s/.test(value[commentStart - 1])) {
        commentStart -= 1;
      }

      return commentStart;
    }
  }

  return -1;
}

module.exports = {
  appendMissingVars,
  importFromBackup,
  isEmptyEnvValue,
  normalizeEnvValue,
  parseEnv,
  parseEnvLine,
  readEnvVars,
  removeEnvVars,
  updateEnvValues
};
