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

| Command | Description |
|---------|-------------|
| `env-detector` | Generate `.env` |
| `env-detector --compare` | Compare env usage |
| `env-detector --check` | Check missing variables |
| `env-detector --fix` | Fix unused variables |
| `env-detector --security` | Security scan |
| `env-detector --strict` | Strict mode (CI) |
| `env-detector --ask` | Interactive fill |
| `env-detector --version` or `env-detector --v` | Show version |

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