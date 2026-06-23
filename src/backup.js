const fs = require("fs");
const path = require("path");

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

function resolveBackupPath(rootDir, backupFiles, explicitPath = null) {
  if (explicitPath) {
    const fullPath = path.resolve(rootDir, explicitPath);
    if (!fs.existsSync(fullPath)) {
      return {
        error: `Backup file not found: ${explicitPath}`
      };
    }

    return { path: fullPath };
  }

  if (!backupFiles.length) {
    return {
      error: "No env backup file found. Pass a path with --from-backup <path>."
    };
  }

  if (backupFiles.length > 1) {
    return {
      error: `Multiple env backup files found: ${backupFiles.join(", ")}`,
      hint: "Pass one explicitly with --from-backup <path>."
    };
  }

  return {
    path: path.join(rootDir, backupFiles[0])
  };
}

module.exports = {
  findEnvBackupFiles,
  resolveBackupPath
};
