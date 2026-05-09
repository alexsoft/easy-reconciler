# GitHub Actions CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI workflow that runs lint + type-check and the full test suite on every PR and push to `main`.

**Architecture:** Two parallel jobs in `.github/workflows/ci.yml`. The `lint` job installs Node/pnpm natively and runs `pnpm lint` + `pnpm build`. The `test` job runs `bin/test`, which uses Docker Compose to start Postgres and the test runner, exactly mirroring local dev.

**Tech Stack:** GitHub Actions, pnpm/action-setup@v4, actions/setup-node@v4, Docker Compose (pre-installed on ubuntu-latest)

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `.github/workflows/ci.yml` | CI workflow — lint and test jobs |

---

### Task 1: Create the workflow file

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm build

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - run: bin/test
```

- [ ] **Step 3: Validate the YAML is well-formed**

```bash
python3 -c "import sys, yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

If `pyyaml` is not available:
```bash
node -e "require('fs').readFileSync('.github/workflows/ci.yml', 'utf8')" && echo "file readable"
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for lint and tests"
```
