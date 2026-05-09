# GitHub Actions CI Workflow

## Overview

Add a CI workflow that runs on every pull request and every push to `main`. Two jobs run in parallel: `lint` and `test`. Each reports as a separate status check on PRs.

## Trigger

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

## Job: lint

Runs on `ubuntu-latest`. Uses native Node/pnpm (no Docker needed).

Steps:
1. Checkout repo
2. Setup pnpm `9.12.0` (matches `packageManager` in root `package.json`)
3. Setup Node.js `24` with pnpm cache enabled
4. `pnpm install --frozen-lockfile`
5. `pnpm lint` — ESLint across all packages
6. `pnpm build` — type-check via `tsc --noEmit` (api, shared) and `tsc -b && vite build` (web)

## Job: test

Runs on `ubuntu-latest`. Docker is pre-installed on GitHub-hosted runners.

Steps:
1. Checkout repo
2. Run `bin/test`

`bin/test` invokes `docker compose -f docker-compose.test.yml`, which:
- Starts `db-test` (postgres:18-alpine, tmpfs at `/var/lib/postgresql`)
- Starts `test-runner` (node:24-alpine), mounts repo at `/app`
- Runs `pnpm install --frozen-lockfile && pnpm -r test`

No Node/pnpm setup on the runner — everything runs inside Docker, mirroring local dev exactly.

## File to create

`.github/workflows/ci.yml`
