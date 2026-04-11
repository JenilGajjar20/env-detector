# env-detector

Smart environment variable analyzer and `.env` generator.

Automatically detects `process.env` usage, generates `.env`, groups environments, detects missing variables, and audits configuration.

npx env-detector
```

---

## Usage

```bash
env-detector
```

---

## Commands

| Command | Shorthand | Description |
|---------|-----------|-------------|
| `env-detector` | | Generate `.env` |
| `env-detector --ask` | `-a` | Interactive mode to fill missing or empty values |
| `env-detector --compare` | `-c` | Show detailed comparison of used, missing, empty, and unused variables |
| `env-detector --check` | `-k` | Exit with error if variables are missing or empty |
| `env-detector --fix` | `-f` | **Interactive** cleanup of unused variables |
| `env-detector --security` | `-s` | Scan for hardcoded secrets in source files and `.env` |
| `env-detector --strict` | `-t` | Strict mode (CI) with detailed failure reporting |
| `env-detector --help` | `-h` | Show help message |
| `env-detector --version` | `-v` | Show version |

---

## Features

### 🛠 Interactive Fix
When running with `--fix` or `-f`, the tool doesn't just delete variables. It lists every unused key it finds and asks for your confirmation (`y/n`) before removing it.

### 🔍 Detailed Strict Mode
Ideal for CI/CD pipelines. If `strict` mode fails, it will provide a categorized list of exactly what triggered the failure:
- **Missing**: Variables used in code but not in `.env`.
- **Empty**: Variables in `.env` without values.
- **Unused**: Variables in `.env` not found in code.

---

## Example

**Code:**

```javascript
process.env.DB_HOST
process.env.PORT
```

**Generated `.env`:**

```
DB_HOST=
PORT=
```

---

## Grouped Config Support

If config file contains:

```javascript
development: {
  username: process.env.DBUSERNAME
}
```

Generated:

```
# development
DBUSERNAME=