# env-detector

Smart environment variable analyzer and `.env` generator for Node.js projects.

`env-detector` scans JavaScript and TypeScript source files for `process.env` usage, compares those variables with `.env`, and helps you generate, audit, or clean environment configuration safely.

## Installation

Run without installing:

```bash
npx env-detector
```

Install globally:

```bash
npm install -g env-detector
```

Then run inside any project:

```bash
env-detector
```

## Default Behavior

```bash
env-detector
```

The default command scans the current project and appends missing environment variables to `.env`.

If no `process.env` variables are detected, it does not create an empty `.env` file.

Example source:

```js
process.env.DB_HOST;
process.env.PORT || 3000;
```

Generated `.env`:

```env
DB_HOST=
PORT=3000
```

Existing `.env` formatting is preserved as much as possible. Missing variables are appended instead of rebuilding the entire file.

## Commands

### Read-Only Commands

These commands inspect the project but do not create or modify `.env`.

| Command | Shorthand | Description |
| --- | --- | --- |
| `env-detector --compare` | `-c` | Show used, missing, empty, and unused variables |
| `env-detector --check` | `-k` | Fail if variables are missing or empty |
| `env-detector --strict` | `-t` | Fail if variables are missing, empty, or unused |
| `env-detector --security` | `-s` | Scan for hardcoded secrets in source files and `.env` |
| `env-detector --help` | `-h` | Show help |
| `env-detector --version` | `-v` | Show version |

### Write Commands

These commands can update `.env`.

| Command | Shorthand | Description |
| --- | --- | --- |
| `env-detector` | | Append missing variables to `.env` |
| `env-detector --ask` | `-a` | Prompt for missing or empty values |
| `env-detector --fix` | `-f` | Interactively remove unused variables from `.env` |
| `env-detector --from-backup` | | Import values from an auto-detected env backup file |
| `env-detector --from-backup <path>` | | Copy the given backup file to `.env` |

## Flag Details

### `--compare`

Prints a categorized report:

- used variables
- missing variables
- empty variables
- unused variables
- detected defaults
- source locations when available

This command is intended for human inspection and exits successfully.

### `--check`

Useful for CI pipelines.

Fails when:

- a variable is used in code but missing from `.env`
- a variable exists in `.env` but has no value

Unused variables are not treated as failures in `--check`.

### `--strict`

The strongest validation mode.

Fails when:

- variables are missing
- variables are empty
- variables are unused

This is best suited for `.env.example` style files or tightly controlled projects.

### `--ask`

Prompts for missing or empty variables and updates `.env`.

Likely secret values such as `PASSWORD`, `SECRET`, `TOKEN`, `API_KEY`, and `JWT_SECRET` are entered with hidden input.

### `--fix`

Lists unused variables and asks for confirmation before removing each one.

This command preserves comments and unrelated lines while removing selected variables.

### `--from-backup`

Imports values from an existing env backup file into `.env`.

```bash
env-detector --from-backup
env-detector --from-backup env-backup
```

When no path is provided, it looks for one common backup file in the project root and imports values only for variables detected in source code:

- `env-backup`
- `.env.backup`
- `.env.bak`
- `.env_backup`
- `env.backup`
- `env.bak`
- `env_backup`

Without an explicit path, this command:

- scans source code for used environment variables
- creates or updates `.env`
- copies values only for variables detected in source code
- skips backup-only keys that are not used in source
- does not overwrite existing non-empty `.env` values
- does not print secret values in the terminal

If multiple backup files exist, pass the intended file explicitly.

When a path is provided, the backup file is copied directly to `.env`:

```bash
env-detector --from-backup env-backup
```

In this mode, `.env` becomes a full copy of the specified backup file.

### `--security`

Scans source files for hardcoded secret-looking values.

It flags source code patterns like:

```js
const JWT_SECRET = "actual-secret-value";
const apiToken = "hardcoded-token-value";
```

It does not flag normal runtime usage such as:

```js
process.env.JWT_SECRET;
req.headers.authorization;
```

If `.env` is not ignored by `.gitignore`, `--security` also warns about sensitive-looking values inside `.env`.

If `.env` is already ignored with common patterns such as `.env`, `/.env`, `.env*`, or `.env.*`, those `.env` values are skipped to avoid noisy warnings.

This command is read-only and reports potential issues with file and line numbers.

## Grouped Config Support

If a config file contains grouped environment sections:

```js
module.exports = {
  development: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD
  },
  production: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD
  }
};
```

Missing variables are appended under detected group headers when possible:

```env
# development
DB_USERNAME=
DB_PASSWORD=
```

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed successfully |
| `1` | Validation failed |
| `2` | Scanner or internal error |

## Notes

- The scanner skips `node_modules`, `.git`, `dist`, `build`, and dot-prefixed files/folders during source scanning.
- `.env` is parsed separately for variable comparison.
- `--security` warns about `.env` values only when `.env` is not ignored by `.gitignore`.
- The tool currently detects direct `process.env.KEY`, bracket access, destructuring from `process.env`, and simple fallback defaults such as `process.env.PORT || 3000`.
