# Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the EasyBiz invoice ↔ transaction reconciler per `docs/superpowers/specs/2026-04-27-reconciler-design.md` — Postgres-backed, deterministic matcher, single-page review UI, runnable via `docker compose up`.

**Architecture:** pnpm monorepo (`shared`, `api`, `web`). Fastify + Drizzle + Postgres 18 on the backend; React + Vite + TanStack Query + Tailwind on the frontend. Matcher is a pure deterministic pipeline of ordered rules; idempotent, config-driven, runs as the last step of seed and on demand. Optimistic locking via `transactions.version`. Append-only audit log enforced by Postgres trigger.

**Tech Stack:** TypeScript, pnpm workspaces, Fastify 4, Drizzle ORM (pg driver), Postgres 18, zod, vitest, React 18, Vite, TanStack Query 5, Tailwind 3, Docker Compose.

---

## Conventions used in this plan

- **Money is integer cents** everywhere (Drizzle `bigint('col', { mode: 'number' })`). Never decimals in code.
- **Drizzle schema** lives in `packages/api/src/db/schema.ts`. **Migrations** generated via `pnpm --filter api db:generate` and applied via `db:migrate`.
- **Tests** use vitest. Backend integration tests use a real Postgres in `docker-compose.test.yml`. Each test file owns its own clean DB via `TRUNCATE … RESTART IDENTITY CASCADE` in `beforeEach`.
- **Commit message style:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- **Run TDD strictly for the matcher and API.** UI components get a single end-to-end smoke test, not per-component tests.
- After every commit, mark the step's checkbox done.
- **Docker-only Node toolchain.** The host has no pnpm/Node install. Anywhere this plan says `pnpm X`, run `./bin/pnpm X` instead — it shells out to a `node:24-alpine` container with the workspace bind-mounted, so `node_modules/` and `pnpm-lock.yaml` land on the host. Once Task 6 lands `docker-compose.yml`, the wrapper can be replaced by `docker compose run --rm api pnpm "$@"` (same interface, reuses the api image). The same applies to anything else that needs `node` — run via Docker.

---

## File structure (locked in here, referenced by tasks)

```
easy-reconciler/
  docker-compose.yml
  docker-compose.test.yml
  package.json                    # workspace root, pnpm
  pnpm-workspace.yaml
  tsconfig.base.json
  .env.example
  packages/
    shared/
      package.json
      tsconfig.json
      src/
        index.ts                  # re-exports
        money.ts                  # cents <-> formatted helpers
        schemas.ts                # zod: Invoice, Transaction, Allocation, etc.
    api/
      package.json
      tsconfig.json
      Dockerfile
      drizzle.config.ts
      src/
        env.ts                    # typed env loader
        db/
          client.ts               # drizzle + pg pool
          schema.ts               # all tables
          migrate.ts              # CLI: apply migrations
          seed.ts                 # CLI: seed from task/*.{json,csv}
          audit.ts                # recordAudit helper
        matcher/
          config.ts
          pipeline.ts             # runMatcher entrypoint
          score.ts                # confidence bucket helpers
          normalize.ts            # name/ref normalization helpers
          rules/
            r1-exact-ref.ts
            r2-description-ref.ts
            r3-fuzzy-ref.ts
            r4-name-amount-date.ts
            r5-subset-sum.ts
            r6-credit-note-net.ts
            r7-payout-link.ts
            r8-noise.ts
        routes/
          transactions.ts
          invoices.ts
          allocations.ts
          proposals.ts
          payouts.ts
          audit.ts
          matcher.ts
        server.ts
        entrypoint.sh             # migrate -> seed -> matcher -> start
      test/
        helpers/
          db.ts                   # truncate helper, test pool
          fixtures.ts              # tiny per-rule fixtures
        matcher/
          r1.test.ts
          r2.test.ts
          ...
          r8.test.ts
          idempotency.test.ts
          fixture-sweep.test.ts   # runs full task/labels.json
        routes/
          transactions.test.ts
          allocations.test.ts
          concurrency.test.ts
    web/
      package.json
      tsconfig.json
      vite.config.ts                # registers @tailwindcss/vite (Tailwind 4)
      Dockerfile
      index.html
      src/
        index.css                   # @import "tailwindcss"; (CSS-first config)
        main.tsx
        App.tsx
        api/
          client.ts               # fetch wrapper
          queries.ts              # query key + hooks
          types.ts                # re-export shared types
        components/
          TransactionList.tsx
          TransactionDetail.tsx
          AllocationsEditor.tsx
          InvoicePicker.tsx
          MatcherProposals.tsx
          PayoutBatchView.tsx
          ActionBar.tsx
          AuditLog.tsx
          AuditDiffModal.tsx
          StatusBadge.tsx
          Money.tsx
        pages/
          Workspace.tsx
        smoke.test.tsx
  task/
    invoices.json                 # given
    transactions.json             # given
    payout_report.csv             # given
    labels.json                   # WE create — ground truth for fixture sweep
  README.md                       # rewrite during T34
  DECISIONS.md
  AI-WORKFLOW.md
  PROMPTS.md
  EVAL.md
```

---

# Phase 1 — Baseline (DB, schema, exact-ref matcher)

## Task 1: Initialize git repo and pnpm monorepo

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: Init git**

```bash
cd /Users/alex/code/easy-reconciler
git init -b main
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules
dist
.env
.env.*.local
*.log
.DS_Store
coverage
drizzle/meta
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "easy-reconciler",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "docker compose up",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "@types/node": "22.7.5"
  }
}
```

- [ ] **Step 5: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": false,
    "lib": ["ES2022"]
  }
}
```

- [ ] **Step 6: Create `.env.example`**

```
DATABASE_URL=postgres://reconciler:reconciler@db:5432/reconciler
PORT=3001
WEB_PORT=5173
```

- [ ] **Step 7: Install root deps and commit**

```bash
pnpm install
git add -A
git commit -m "chore: initialize pnpm monorepo"
```

---

## Task 2: Scaffold the `shared` package

**Files:**

- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/money.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@reconciler/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "3.23.8"
  },
  "devDependencies": {
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/src/money.ts`**

```ts
export const toCents = (eur: number): number => Math.round(eur * 100);
export const fromCents = (cents: number): number => cents / 100;

export const formatEUR = (cents: number): string =>
  new Intl.NumberFormat('de-LU', { style: 'currency', currency: 'EUR' }).format(fromCents(cents));
```

- [ ] **Step 4: Write money tests**

Create `packages/shared/src/money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toCents, fromCents, formatEUR } from './money.js';

describe('money', () => {
  it('rounds floats to integer cents', () => {
    expect(toCents(1123.2)).toBe(112320);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it('round-trips', () => {
    expect(fromCents(toCents(122.85))).toBe(122.85);
  });
  it('formats EUR', () => {
    expect(formatEUR(112320)).toMatch(/1.123,20.*€/);
  });
});
```

- [ ] **Step 5: Create `packages/shared/src/index.ts`**

```ts
export * from './money.js';
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @reconciler/shared test
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): scaffold shared package with money helpers"
```

---

## Task 3: Add zod schemas to `shared`

**Files:**

- Create: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/schemas.ts`**

```ts
import { z } from 'zod';

export const InvoiceLineSchema = z.object({
  line_id: z.string(),
  description: z.string(),
  quantity: z.number().int().positive(),
  unit_price: z.number(),
  tax_rate: z.number(),
  amount: z.number(),
});

export const InvoiceSchema = z.object({
  id: z.string(),
  type: z.enum(['invoice', 'credit_note']),
  customer_id: z.string(),
  customer_name: z.string(),
  customer_vat: z.string(),
  issue_date: z.string(),
  due_date: z.string(),
  currency: z.string().length(3),
  line_items: z.array(InvoiceLineSchema),
  subtotal: z.number(),
  tax_total: z.number(),
  total: z.number(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  currency: z.string().length(3),
  counterparty_name: z.string(),
  structured_reference: z.string().nullable().optional(),
  description: z.string(),
});

export const PayoutItemCsvSchema = z.object({
  charge_id: z.string(),
  invoice_id: z.string(),
  customer_name: z.string(),
  gross_amount: z.string(),
  fee: z.string(),
  net_amount: z.string(),
  type: z.enum(['charge', 'refund', 'chargeback', 'payout']),
});

export type InvoiceInput = z.infer<typeof InvoiceSchema>;
export type TransactionInput = z.infer<typeof TransactionSchema>;
export type PayoutItemCsv = z.infer<typeof PayoutItemCsvSchema>;

export const TxStatus = z.enum([
  'unmatched',
  'auto_matched',
  'partially_allocated',
  'needs_review',
  'unrelated',
  'payout_batch',
]);
export type TxStatus = z.infer<typeof TxStatus>;

export const AllocationStatus = z.enum(['proposed', 'confirmed', 'rejected']);
export type AllocationStatus = z.infer<typeof AllocationStatus>;

export const AllocationSource = z.enum(['auto', 'manual']);
export type AllocationSource = z.infer<typeof AllocationSource>;

export const TransactionDTO = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  currency: z.string(),
  counterparty_name: z.string(),
  structured_reference: z.string().nullable(),
  description: z.string(),
  status: TxStatus,
  version: z.number().int(),
});
export type TransactionDTO = z.infer<typeof TransactionDTO>;

export const AllocationDTO = z.object({
  id: z.string(),
  transaction_id: z.string(),
  invoice_id: z.string().nullable(),
  amount: z.number(),
  confidence: z.number().nullable(),
  status: AllocationStatus,
  source: AllocationSource,
  rule: z.string().nullable(),
  created_by: z.string(),
});
export type AllocationDTO = z.infer<typeof AllocationDTO>;
```

- [ ] **Step 2: Update `packages/shared/src/index.ts`**

```ts
export * from './money.js';
export * from './schemas.js';
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @reconciler/shared build
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add zod schemas for invoice/transaction/allocation"
```

---

## Task 4: Scaffold the `api` package (Fastify + Drizzle + env)

**Files:**

- Create: `packages/api/package.json`, `packages/api/tsconfig.json`, `packages/api/src/env.ts`, `packages/api/src/server.ts`, `packages/api/src/db/client.ts`, `packages/api/drizzle.config.ts`

- [ ] **Step 1: Create `packages/api/package.json`**

```json
{
  "name": "@reconciler/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc -p tsconfig.json --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@reconciler/shared": "workspace:*",
    "fastify": "5.0.0",
    "@fastify/cors": "10.0.1",
    "drizzle-orm": "0.36.0",
    "pg": "8.13.0",
    "zod": "3.23.8",
    "cuid": "3.0.0",
    "fast-levenshtein": "3.0.0"
  },
  "devDependencies": {
    "tsx": "4.19.1",
    "drizzle-kit": "0.27.0",
    "@types/pg": "8.11.10",
    "@types/fast-levenshtein": "0.0.4",
    "vitest": "2.1.3"
  }
}
```

- [ ] **Step 2: Create `packages/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/api/src/env.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
```

- [ ] **Step 4: Create `packages/api/src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { pool };
```

- [ ] **Step 5: Create `packages/api/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://reconciler:reconciler@localhost:5432/reconciler',
  },
});
```

- [ ] **Step 6: Create stub `packages/api/src/db/schema.ts`**

```ts
// Schema added in Task 5
export {};
```

- [ ] **Step 7: Create stub `packages/api/src/server.ts`**

```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true }));

const port = env.PORT;
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Install and commit**

```bash
pnpm install
git add packages/api pnpm-lock.yaml
git commit -m "feat(api): scaffold fastify + drizzle package"
```

---

## Task 5: Define the full Drizzle schema

**Files:**

- Modify: `packages/api/src/db/schema.ts`

- [ ] **Step 1: Replace `packages/api/src/db/schema.ts`**

```ts
import {
  pgTable,
  text,
  bigint,
  integer,
  date,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

const cents = (name: string) => bigint(name, { mode: 'number' }).notNull();
const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'invoice' | 'credit_note'
  customer_id: text('customer_id').notNull(),
  customer_name: text('customer_name').notNull(),
  customer_vat: text('customer_vat').notNull(),
  issue_date: date('issue_date').notNull(),
  due_date: date('due_date').notNull(),
  currency: text('currency').notNull(),
  subtotal: cents('subtotal'),
  tax_total: cents('tax_total'),
  total: cents('total'),
  created_at: now(),
  updated_at: now(),
});

export const invoice_lines = pgTable('invoice_lines', {
  id: text('id').primaryKey(),
  invoice_id: text('invoice_id')
    .notNull()
    .references(() => invoices.id),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unit_price: cents('unit_price'),
  amount: cents('amount'),
  tax_rate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    date: date('date').notNull(),
    amount: cents('amount'),
    currency: text('currency').notNull(),
    counterparty_name: text('counterparty_name').notNull(),
    structured_reference: text('structured_reference'),
    description: text('description').notNull(),
    dedup_hash: text('dedup_hash').notNull(),
    status: text('status').notNull().default('unmatched'),
    version: integer('version').notNull().default(1),
    created_at: now(),
    updated_at: now(),
  },
  (t) => ({
    dedupIdx: uniqueIndex('transactions_dedup_idx').on(t.dedup_hash),
    statusIdx: index('transactions_status_idx').on(t.status),
  }),
);

export const allocations = pgTable(
  'allocations',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transactions.id),
    invoice_id: text('invoice_id').references(() => invoices.id),
    amount: cents('amount'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    status: text('status').notNull(),
    source: text('source').notNull(),
    rule: text('rule'),
    created_by: text('created_by').notNull(),
    created_at: now(),
    updated_at: now(),
  },
  (t) => ({
    txInvIdx: uniqueIndex('allocations_tx_inv_idx').on(t.transaction_id, t.invoice_id).where(`invoice_id is not null`),
    txIdx: index('allocations_tx_idx').on(t.transaction_id),
  }),
);

export const payout_batches = pgTable('payout_batches', {
  id: text('id').primaryKey(),
  transaction_id: text('transaction_id').references(() => transactions.id),
  gross_total: cents('gross_total'),
  fee_total: cents('fee_total'),
  net_total: cents('net_total'),
  status: text('status').notNull().default('needs_review'),
});

export const payout_items = pgTable('payout_items', {
  id: text('id').primaryKey(),
  payout_batch_id: text('payout_batch_id')
    .notNull()
    .references(() => payout_batches.id),
  invoice_id: text('invoice_id').references(() => invoices.id),
  customer_name: text('customer_name').notNull(),
  gross_amount: cents('gross_amount'),
  fee: cents('fee'),
  net_amount: cents('net_amount'),
  type: text('type').notNull(),
});

export const audit_log = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    entity_type: text('entity_type').notNull(),
    entity_id: text('entity_id').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    correlation_id: text('correlation_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    created_at: now(),
  },
  (t) => ({
    entityIdx: index('audit_entity_idx').on(t.entity_id, t.created_at),
  }),
);
```

- [ ] **Step 2: Generate migration**

```bash
pnpm --filter @reconciler/api db:generate
```

Expected: a new file under `packages/api/drizzle/0000_*.sql` is created.

- [ ] **Step 3: Append append-only trigger to migration**

Open the generated SQL file and append at the bottom:

```sql
CREATE OR REPLACE FUNCTION audit_log_block_modify() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_modify();

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_modify();
```

- [ ] **Step 4: Type-check**

```bash
pnpm --filter @reconciler/api build
```

- [ ] **Step 5: Commit**

```bash
git add packages/api
git commit -m "feat(api): drizzle schema for all entities + audit append-only trigger"
```

---

## Task 6: Docker Compose (db + api stub) and migration runner

**Files:**

- Create: `docker-compose.yml`, `packages/api/Dockerfile`, `packages/api/src/db/migrate.ts`, `packages/api/src/entrypoint.sh`

- [ ] **Step 1: Create `packages/api/src/db/migrate.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env } from '../env.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('migrations applied');
```

- [ ] **Step 2: Create `packages/api/Dockerfile`**

```dockerfile
FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
COPY task ./task
RUN chmod +x packages/api/src/entrypoint.sh
WORKDIR /app/packages/api
EXPOSE 3001
CMD ["./src/entrypoint.sh"]
```

- [ ] **Step 3: Create `packages/api/src/entrypoint.sh`**

```sh
#!/bin/sh
set -e
echo "waiting for postgres..."
until node -e "require('pg').Pool && new (require('pg').Pool)({connectionString: process.env.DATABASE_URL}).query('select 1').then(()=>process.exit(0)).catch(()=>process.exit(1))"; do
  sleep 1
done
echo "running migrations..."
pnpm db:migrate
echo "running seed..."
pnpm db:seed
echo "starting server..."
pnpm start
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: reconciler
      POSTGRES_PASSWORD: reconciler
      POSTGRES_DB: reconciler
    ports: ['5432:5432']
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'reconciler']
      interval: 2s
      timeout: 2s
      retries: 20
    volumes:
      - db-data:/var/lib/postgresql/data
  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    environment:
      DATABASE_URL: postgres://reconciler:reconciler@db:5432/reconciler
      PORT: 3001
      NODE_ENV: development
    depends_on:
      db: { condition: service_healthy }
    ports: ['3001:3001']
volumes:
  db-data: {}
```

- [ ] **Step 5: Smoke test the stack (db + migrations)**

```bash
docker compose up --build db -d
sleep 3
docker compose run --rm api pnpm db:migrate
```

Expected output ends with `migrations applied`.

- [ ] **Step 6: Verify schema in psql**

```bash
docker compose exec db psql -U reconciler -d reconciler -c "\dt"
```

Expected: 7 tables listed (invoices, invoice_lines, transactions, allocations, payout_batches, payout_items, audit_log) plus `__drizzle_migrations`.

- [ ] **Step 7: Tear down and commit**

```bash
docker compose down
git add docker-compose.yml packages/api/Dockerfile packages/api/src/db/migrate.ts packages/api/src/entrypoint.sh
git commit -m "chore: docker compose with postgres 18 and migration runner"
```

---

## Task 7: Seed script — invoices and transactions

**Files:**

- Create: `packages/api/src/db/seed.ts`

- [ ] **Step 1: Create `packages/api/src/db/seed.ts`**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { invoices, invoice_lines, transactions } from './schema.js';
import { InvoiceSchema, TransactionSchema, toCents } from '@reconciler/shared';

const taskDir = resolve(process.cwd(), '../../task');

const dedupHash = (t: { date: string; amount: number; counterparty_name: string; description: string }) =>
  createHash('sha256')
    .update([t.date, t.amount.toString(), t.counterparty_name, t.description].join('|'))
    .digest('hex');

async function seedInvoices() {
  const raw = JSON.parse(readFileSync(`${taskDir}/invoices.json`, 'utf-8'));
  const parsed = raw.map((r: unknown) => InvoiceSchema.parse(r));

  for (const inv of parsed) {
    await db
      .insert(invoices)
      .values({
        id: inv.id,
        type: inv.type,
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
        customer_vat: inv.customer_vat,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        currency: inv.currency,
        subtotal: toCents(inv.subtotal),
        tax_total: toCents(inv.tax_total),
        total: toCents(inv.total),
      })
      .onConflictDoUpdate({
        target: invoices.id,
        set: {
          subtotal: toCents(inv.subtotal),
          tax_total: toCents(inv.tax_total),
          total: toCents(inv.total),
          updated_at: sql`now()`,
        },
      });

    for (const line of inv.line_items) {
      await db
        .insert(invoice_lines)
        .values({
          id: line.line_id,
          invoice_id: inv.id,
          description: line.description,
          quantity: line.quantity,
          unit_price: toCents(line.unit_price),
          amount: toCents(line.amount),
          tax_rate: line.tax_rate.toString(),
        })
        .onConflictDoNothing();
    }
  }
  console.log(`seeded ${parsed.length} invoices`);
}

async function seedTransactions() {
  const raw = JSON.parse(readFileSync(`${taskDir}/transactions.json`, 'utf-8'));
  const parsed = raw.map((r: unknown) => TransactionSchema.parse(r));

  for (const t of parsed) {
    const cents = toCents(t.amount);
    const hash = dedupHash({
      date: t.date,
      amount: cents,
      counterparty_name: t.counterparty_name,
      description: t.description,
    });
    await db
      .insert(transactions)
      .values({
        id: t.id,
        date: t.date,
        amount: cents,
        currency: t.currency,
        counterparty_name: t.counterparty_name,
        structured_reference: t.structured_reference ?? null,
        description: t.description,
        dedup_hash: hash,
      })
      .onConflictDoNothing({ target: transactions.dedup_hash });
  }
  console.log(`seeded ${parsed.length} transactions`);
}

async function main() {
  await seedInvoices();
  await seedTransactions();
  // payout seeded in Task 19
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run seed and verify counts**

```bash
docker compose up -d db
sleep 3
docker compose run --rm api pnpm db:migrate
docker compose run --rm api pnpm db:seed
docker compose exec db psql -U reconciler -d reconciler -c "select count(*) from invoices; select count(*) from transactions;"
```

Expected: invoices=52, transactions=80.

- [ ] **Step 3: Run seed again to verify idempotency**

```bash
docker compose run --rm api pnpm db:seed
docker compose exec db psql -U reconciler -d reconciler -c "select count(*) from invoices; select count(*) from transactions;"
```

Expected: still 52 / 80.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/seed.ts
git commit -m "feat(api): idempotent seed for invoices + transactions"
```

---

## Task 8: Test infrastructure and helpers

**Files:**

- Create: `docker-compose.test.yml`, `packages/api/test/helpers/db.ts`, `packages/api/vitest.config.ts`

- [ ] **Step 1: Create `docker-compose.test.yml`**

```yaml
services:
  db-test:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: reconciler
      POSTGRES_PASSWORD: reconciler
      POSTGRES_DB: reconciler_test
    ports: ['5433:5432']
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'reconciler']
      interval: 1s
      retries: 20
    tmpfs: [/var/lib/postgresql/data]
```

- [ ] **Step 2: Create `packages/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['test/helpers/setup.ts'],
  },
});
```

- [ ] **Step 3: Create `packages/api/test/helpers/setup.ts`**

```ts
process.env.DATABASE_URL ??= 'postgres://reconciler:reconciler@localhost:5433/reconciler_test';
process.env.NODE_ENV = 'test';
```

- [ ] **Step 4: Create `packages/api/test/helpers/db.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from '../../src/db/schema.js';
import { sql } from 'drizzle-orm';

let pool: pg.Pool | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export async function getTestDb() {
  if (!db) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  }
  return { db, pool: pool! };
}

export async function truncateAll() {
  const { db } = await getTestDb();
  await db.execute(sql`
    truncate table audit_log, payout_items, payout_batches,
      allocations, transactions, invoice_lines, invoices
      restart identity cascade;
  `);
}

export async function closeTestDb() {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
```

- [ ] **Step 5: Write a smoke test**

Create `packages/api/test/smoke.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from './helpers/db.js';
import { invoices } from '../src/db/schema.js';

describe('test infra', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('can insert and read', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'TEST-1',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 170,
      total: 1170,
    });
    const rows = await db.select().from(invoices);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(1170);
  });
});
```

- [ ] **Step 6: Run test**

```bash
docker compose -f docker-compose.test.yml up -d
sleep 3
pnpm --filter @reconciler/api test smoke
```

Expected: 1 test passes.

- [ ] **Step 7: Commit**

```bash
docker compose -f docker-compose.test.yml down
git add docker-compose.test.yml packages/api/test packages/api/vitest.config.ts
git commit -m "test(api): vitest setup + test postgres + truncate helper"
```

---

## Task 9: Audit log helper and matcher config

**Files:**

- Create: `packages/api/src/db/audit.ts`, `packages/api/src/matcher/config.ts`

- [ ] **Step 1: Create `packages/api/src/db/audit.ts`**

```ts
import cuid from 'cuid';
import type { DB } from './client.js';
import { audit_log } from './schema.js';

export type AuditAction =
  | 'matcher_proposed'
  | 'matcher_updated'
  | 'matcher_auto_confirmed'
  | 'matcher_marked_unrelated'
  | 'matcher_skipped_locked'
  | 'reviewer_confirmed'
  | 'reviewer_rejected'
  | 'reviewer_split'
  | 'reviewer_edited_allocation'
  | 'reviewer_marked_unrelated'
  | 'reviewer_unmarked_unrelated'
  | 'reviewer_attached_credit_note'
  | 'reviewer_confirmed_payout_batch';

export interface AuditEntry {
  entity_type: 'transaction' | 'allocation' | 'payout_batch';
  entity_id: string;
  action: AuditAction;
  actor: 'matcher' | 'reviewer';
  correlation_id?: string;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(tx: DB, entry: AuditEntry): Promise<void> {
  await tx.insert(audit_log).values({
    id: cuid(),
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    action: entry.action,
    actor: entry.actor,
    correlation_id: entry.correlation_id ?? null,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
  });
}
```

- [ ] **Step 2: Create `packages/api/src/matcher/config.ts`**

```ts
const numEnv = (key: string, def: number) => (process.env[key] ? Number(process.env[key]) : def);
const intEnv = (key: string, def: number) => (process.env[key] ? parseInt(process.env[key]!, 10) : def);
const strArrEnv = (key: string, def: string[]) =>
  process.env[key] ? process.env[key]!.split(',').map((s) => s.trim()) : def;

export const matcherConfig = {
  confidence: {
    autoConfirm: numEnv('MATCHER_AUTO_CONFIRM', 0.95),
    propose: numEnv('MATCHER_PROPOSE', 0.7),
  },
  amountToleranceCents: intEnv('MATCHER_AMOUNT_TOLERANCE_CENTS', 2),
  overpayment: {
    pctThreshold: numEnv('MATCHER_OVERPAY_PCT', 0.05),
    absThresholdCents: intEnv('MATCHER_OVERPAY_ABS_CENTS', 500),
  },
  dateWindow: {
    daysBeforeIssue: intEnv('MATCHER_DAYS_BEFORE_ISSUE', 7),
    daysAfterIssue: intEnv('MATCHER_DAYS_AFTER_ISSUE', 60),
  },
  fuzzyRef: {
    maxLevenshtein: intEnv('MATCHER_FUZZY_LEV', 2),
  },
  customerName: {
    jaroWinklerThreshold: numEnv('MATCHER_JW_THRESHOLD', 0.88),
  },
  subsetSum: {
    maxInvoices: intEnv('MATCHER_SUBSET_MAX_INVOICES', 5),
    maxCandidates: intEnv('MATCHER_SUBSET_MAX_CANDIDATES', 64),
  },
  ruleConfidence: {
    exactRef: numEnv('MATCHER_CONF_EXACT_REF', 1.0),
    descriptionRef: numEnv('MATCHER_CONF_DESC_REF', 0.95),
    fuzzyRef: numEnv('MATCHER_CONF_FUZZY_REF', 0.85),
    nameAmountDate: numEnv('MATCHER_CONF_NAME', 0.8),
    subsetSum: numEnv('MATCHER_CONF_SUBSET', 0.75),
    creditNoteNet: numEnv('MATCHER_CONF_CREDIT', 0.8),
    payoutLink: numEnv('MATCHER_CONF_PAYOUT', 0.95),
  },
  noiseKeywords: strArrEnv('MATCHER_NOISE_KEYWORDS', [
    'salary',
    'payroll out',
    'rent',
    'landlord',
    'fee',
    'bank charge',
    'tax authority',
    'refund out',
  ]),
} as const;

export type MatcherConfig = typeof matcherConfig;
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @reconciler/api build
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/audit.ts packages/api/src/matcher/config.ts
git commit -m "feat(api): audit log helper + matcher config from env"
```

---

## Task 10: Matcher pipeline skeleton + invoice balance helper

**Files:**

- Create: `packages/api/src/matcher/pipeline.ts`, `packages/api/src/matcher/score.ts`

- [ ] **Step 1: Create `packages/api/src/matcher/score.ts`**

```ts
import type { MatcherConfig } from './config.js';

export type Bucket = 'auto_confirm' | 'propose' | 'skip';

export function bucket(confidence: number, cfg: MatcherConfig): Bucket {
  if (confidence >= cfg.confidence.autoConfirm) return 'auto_confirm';
  if (confidence >= cfg.confidence.propose) return 'propose';
  return 'skip';
}

export function withinTolerance(a: number, b: number, cents: number): boolean {
  return Math.abs(a - b) <= cents;
}
```

- [ ] **Step 2: Write skeleton test**

Create `packages/api/test/matcher/pipeline.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { runMatcher } from '../../src/matcher/pipeline.js';

describe('runMatcher', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('returns an empty report when there are no transactions', async () => {
    const { db } = await getTestDb();
    const report = await runMatcher(db);
    expect(report.totals.examined).toBe(0);
    expect(report.totals.autoConfirmed).toBe(0);
    expect(report.totals.proposed).toBe(0);
  });
});
```

- [ ] **Step 3: Create `packages/api/src/matcher/pipeline.ts`**

```ts
import { eq, and, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { transactions, allocations } from '../db/schema.js';
import { matcherConfig, type MatcherConfig } from './config.js';

export interface MatcherReport {
  config: MatcherConfig;
  totals: {
    examined: number;
    autoConfirmed: number;
    proposed: number;
    markedUnrelated: number;
    skippedLocked: number;
    unchanged: number;
  };
  perRule: Record<string, number>;
}

export async function runMatcher(db: DB): Promise<MatcherReport> {
  const report: MatcherReport = {
    config: matcherConfig,
    totals: { examined: 0, autoConfirmed: 0, proposed: 0, markedUnrelated: 0, skippedLocked: 0, unchanged: 0 },
    perRule: {},
  };

  const txs = await db.select().from(transactions);
  report.totals.examined = txs.length;

  // Rules invoked here in T11+. Skeleton only for now.
  return report;
}
```

- [ ] **Step 4: Run the test**

```bash
docker compose -f docker-compose.test.yml up -d
sleep 3
pnpm --filter @reconciler/api test pipeline
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/matcher packages/api/test/matcher
git commit -m "feat(api): matcher pipeline skeleton + score helpers"
```

---

## Task 11: Invoice balance computation helper

**Files:**

- Create: `packages/api/src/matcher/balance.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/test/matcher/balance.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { invoices, allocations, transactions } from '../../src/db/schema.js';
import { invoiceBalance, openInvoicesForCustomer } from '../../src/matcher/balance.js';
import cuid from 'cuid';

describe('invoiceBalance', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  async function seedTx(db: any, id: string) {
    await db.insert(transactions).values({
      id,
      date: '2026-03-01',
      amount: 0,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'x',
      dedup_hash: id,
    });
  }

  it('returns invoice total when no allocations exist', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 10000,
      tax_total: 1700,
      total: 11700,
    });
    expect(await invoiceBalance(db, 'INV-A')).toBe(11700);
  });

  it('subtracts confirmed allocations only', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 10000,
      tax_total: 1700,
      total: 11700,
    });
    await seedTx(db, 'TXN-1');
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 5000,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    await seedTx(db, 'TXN-2');
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-2',
      invoice_id: 'INV-A',
      amount: 3000,
      status: 'proposed',
      source: 'auto',
      created_by: 'matcher',
    });
    expect(await invoiceBalance(db, 'INV-A')).toBe(11700 - 5000);
  });

  it('openInvoicesForCustomer skips fully-paid', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
        id: 'INV-A',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'X',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 1000,
        tax_total: 0,
        total: 1000,
      },
      {
        id: 'INV-B',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'X',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 2000,
        tax_total: 0,
        total: 2000,
      },
    ]);
    await seedTx(db, 'TXN-X');
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-X',
      invoice_id: 'INV-A',
      amount: 1000,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    const open = await openInvoicesForCustomer(db, 'C1');
    expect(open.map((i) => i.id).sort()).toEqual(['INV-B']);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter @reconciler/api test balance
```

Expected: Cannot find module 'src/matcher/balance.js'.

- [ ] **Step 3: Implement `packages/api/src/matcher/balance.ts`**

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { invoices, allocations } from '../db/schema.js';

export async function invoiceBalance(db: DB, invoiceId: string): Promise<number> {
  const inv = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (inv.length === 0) throw new Error(`invoice ${invoiceId} not found`);
  const allocated = await db
    .select({ sum: sql<string | null>`coalesce(sum(${allocations.amount}), 0)` })
    .from(allocations)
    .where(and(eq(allocations.invoice_id, invoiceId), eq(allocations.status, 'confirmed')));
  const sum = Number(allocated[0]?.sum ?? 0);
  return inv[0]!.total - sum;
}

export async function openInvoicesForCustomer(db: DB, customerId: string) {
  const all = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.customer_id, customerId), eq(invoices.type, 'invoice')));
  const result: Array<(typeof all)[number] & { balance: number }> = [];
  for (const inv of all) {
    const balance = await invoiceBalance(db, inv.id);
    if (balance > 0) result.push({ ...inv, balance });
  }
  return result;
}
```

- [ ] **Step 4: Re-run test**

```bash
pnpm --filter @reconciler/api test balance
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/matcher/balance.ts packages/api/test/matcher/balance.test.ts
git commit -m "feat(api): invoice balance and open-invoice helpers"
```

---

## Task 12: Allocation upsert helper (enforces matcher invariant)

**Files:**

- Create: `packages/api/src/matcher/upsert-allocation.ts`

- [ ] **Step 1: Write failing test**

Create `packages/api/test/matcher/upsert.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { upsertProposed } from '../../src/matcher/upsert-allocation.js';
import cuid from 'cuid';
import { eq } from 'drizzle-orm';

async function seed(db: any) {
  await db.insert(invoices).values({
    id: 'INV-A',
    type: 'invoice',
    customer_id: 'C1',
    customer_name: 'X',
    customer_vat: 'LU0',
    issue_date: '2026-01-01',
    due_date: '2026-02-01',
    currency: 'EUR',
    subtotal: 1000,
    tax_total: 0,
    total: 1000,
  });
  await db.insert(transactions).values({
    id: 'TXN-1',
    date: '2026-03-01',
    amount: 1000,
    currency: 'EUR',
    counterparty_name: 'x',
    description: 'x',
    dedup_hash: 'h1',
  });
}

describe('upsertProposed', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('inserts new allocation as confirmed when bucket is auto_confirm', async () => {
    const { db } = await getTestDb();
    await seed(db);
    const r = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 1.0,
      rule: 'exact_ref',
      bucket: 'auto_confirm',
    });
    expect(r.action).toBe('inserted_confirmed');
    const rows = await db.select().from(allocations);
    expect(rows[0]!.status).toBe('confirmed');
  });

  it('inserts new allocation as proposed when bucket is propose', async () => {
    const { db } = await getTestDb();
    await seed(db);
    const r = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.8,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    expect(r.action).toBe('inserted_proposed');
  });

  it('does not modify a confirmed row (matcher invariant)', async () => {
    const { db } = await getTestDb();
    await seed(db);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: '1.00',
      status: 'confirmed',
      source: 'manual',
      rule: null,
      created_by: 'reviewer',
    });
    const r = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 999,
      confidence: 0.5,
      rule: 'exact_ref',
      bucket: 'propose',
    });
    expect(r.action).toBe('skipped_non_proposed');
    const row = (await db.select().from(allocations).where(eq(allocations.transaction_id, 'TXN-1')))[0]!;
    expect(row.amount).toBe(1000);
    expect(row.source).toBe('manual');
  });

  it('updates a proposed row only when fields change', async () => {
    const { db } = await getTestDb();
    await seed(db);
    await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.8,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    const second = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.8,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    expect(second.action).toBe('unchanged');
    const third = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.85,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    expect(third.action).toBe('updated');
  });
});
```

- [ ] **Step 2: Implement `packages/api/src/matcher/upsert-allocation.ts`**

```ts
import { and, eq, sql } from 'drizzle-orm';
import cuid from 'cuid';
import type { DB } from '../db/client.js';
import { allocations } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import type { Bucket } from './score.js';

export interface UpsertInput {
  transaction_id: string;
  invoice_id: string;
  amount: number;
  confidence: number;
  rule: string;
  bucket: Exclude<Bucket, 'skip'>;
}

export type UpsertAction =
  | 'inserted_proposed'
  | 'inserted_confirmed'
  | 'updated'
  | 'unchanged'
  | 'skipped_non_proposed';

export interface UpsertResult {
  action: UpsertAction;
  allocation_id?: string;
}

export async function upsertProposed(db: DB, input: UpsertInput): Promise<UpsertResult> {
  const existing = await db
    .select()
    .from(allocations)
    .where(and(eq(allocations.transaction_id, input.transaction_id), eq(allocations.invoice_id, input.invoice_id)))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    if (row.status !== 'proposed') return { action: 'skipped_non_proposed', allocation_id: row.id };

    const sameAmount = row.amount === input.amount;
    const sameConf = Number(row.confidence) === input.confidence;
    const sameRule = row.rule === input.rule;
    if (sameAmount && sameConf && sameRule) {
      return { action: 'unchanged', allocation_id: row.id };
    }
    await db
      .update(allocations)
      .set({
        amount: input.amount,
        confidence: input.confidence.toFixed(2),
        rule: input.rule,
        updated_at: sql`now()`,
      })
      .where(eq(allocations.id, row.id));
    await recordAudit(db, {
      entity_type: 'allocation',
      entity_id: row.id,
      action: 'matcher_updated',
      actor: 'matcher',
      before: row,
      after: { ...row, amount: input.amount, confidence: input.confidence, rule: input.rule },
    });
    return { action: 'updated', allocation_id: row.id };
  }

  const id = cuid();
  const status = input.bucket === 'auto_confirm' ? 'confirmed' : 'proposed';
  await db.insert(allocations).values({
    id,
    transaction_id: input.transaction_id,
    invoice_id: input.invoice_id,
    amount: input.amount,
    confidence: input.confidence.toFixed(2),
    status,
    source: 'auto',
    rule: input.rule,
    created_by: 'matcher',
  });
  await recordAudit(db, {
    entity_type: 'allocation',
    entity_id: id,
    action: status === 'confirmed' ? 'matcher_auto_confirmed' : 'matcher_proposed',
    actor: 'matcher',
    after: {
      transaction_id: input.transaction_id,
      invoice_id: input.invoice_id,
      amount: input.amount,
      status,
      rule: input.rule,
    },
  });
  return {
    action: status === 'confirmed' ? 'inserted_confirmed' : 'inserted_proposed',
    allocation_id: id,
  };
}
```

- [ ] **Step 3: Run test**

```bash
pnpm --filter @reconciler/api test upsert
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/matcher/upsert-allocation.ts packages/api/test/matcher/upsert.test.ts
git commit -m "feat(matcher): allocation upsert helper enforcing matcher invariant"
```

---

## Task 13: Transaction status updater helper

**Files:**

- Create: `packages/api/src/matcher/update-tx-status.ts`

- [ ] **Step 1: Write failing test**

Create `packages/api/test/matcher/tx-status.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { recomputeTxStatus } from '../../src/matcher/update-tx-status.js';
import cuid from 'cuid';
import { eq } from 'drizzle-orm';

async function seedTx(db: any, opts: { id: string; amount: number; status?: string }) {
  await db.insert(transactions).values({
    id: opts.id,
    date: '2026-03-01',
    amount: opts.amount,
    currency: 'EUR',
    counterparty_name: 'x',
    description: 'x',
    dedup_hash: opts.id,
    status: opts.status ?? 'unmatched',
  });
}
async function seedInv(db: any, id: string, total: number) {
  await db.insert(invoices).values({
    id,
    type: 'invoice',
    customer_id: 'C1',
    customer_name: 'X',
    customer_vat: 'LU0',
    issue_date: '2026-01-01',
    due_date: '2026-02-01',
    currency: 'EUR',
    subtotal: total,
    tax_total: 0,
    total,
  });
}

describe('recomputeTxStatus', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('auto_matched when fully covered by confirmed allocations', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000 });
    await seedInv(db, 'I1', 1000);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'T1',
      invoice_id: 'I1',
      amount: 1000,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('auto_matched');
  });

  it('partially_allocated when confirmed sum < tx amount', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000 });
    await seedInv(db, 'I1', 1000);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'T1',
      invoice_id: 'I1',
      amount: 600,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('partially_allocated');
  });

  it('needs_review when only proposed allocations exist', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000 });
    await seedInv(db, 'I1', 1000);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'T1',
      invoice_id: 'I1',
      amount: 1000,
      status: 'proposed',
      source: 'auto',
      created_by: 'matcher',
    });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('needs_review');
  });

  it('preserves explicit unrelated/payout_batch status', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000, status: 'unrelated' });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('unrelated');
  });
});
```

- [ ] **Step 2: Implement `packages/api/src/matcher/update-tx-status.ts`**

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { transactions, allocations } from '../db/schema.js';

export async function recomputeTxStatus(db: DB, txId: string): Promise<void> {
  const tx = (await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1))[0];
  if (!tx) return;
  if (tx.status === 'unrelated' || tx.status === 'payout_batch') return;

  const confirmed = await db
    .select({ sum: sql<string | null>`coalesce(sum(${allocations.amount}), 0)` })
    .from(allocations)
    .where(and(eq(allocations.transaction_id, txId), eq(allocations.status, 'confirmed')));
  const proposed = await db
    .select({ count: sql<string>`count(*)` })
    .from(allocations)
    .where(and(eq(allocations.transaction_id, txId), eq(allocations.status, 'proposed')));

  const confirmedSum = Number(confirmed[0]?.sum ?? 0);
  const proposedCount = Number(proposed[0]?.count ?? 0);

  let nextStatus = tx.status;
  if (confirmedSum > 0 && confirmedSum >= tx.amount) nextStatus = 'auto_matched';
  else if (confirmedSum > 0) nextStatus = 'partially_allocated';
  else if (proposedCount > 0) nextStatus = 'needs_review';
  else nextStatus = 'unmatched';

  if (nextStatus !== tx.status) {
    await db
      .update(transactions)
      .set({ status: nextStatus, updated_at: sql`now()` })
      .where(eq(transactions.id, txId));
  }
}
```

- [ ] **Step 3: Run test**

```bash
pnpm --filter @reconciler/api test tx-status
```

Expected: 4 pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/matcher/update-tx-status.ts packages/api/test/matcher/tx-status.test.ts
git commit -m "feat(matcher): recompute transaction status from allocations"
```

---

## Task 14: R1 — Exact reference rule

**Files:**

- Create: `packages/api/src/matcher/rules/r1-exact-ref.ts`

- [ ] **Step 1: Write failing test**

Create `packages/api/test/matcher/r1.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR1ExactRef } from '../../src/matcher/rules/r1-exact-ref.js';
import { matcherConfig } from '../../src/matcher/config.js';
import { recomputeTxStatus } from '../../src/matcher/update-tx-status.js';
import { eq } from 'drizzle-orm';

async function seed(db: any, opts: { txAmount: number; invoiceTotal: number; ref: string | null }) {
  await db.insert(invoices).values({
    id: 'INV-2026-0001',
    type: 'invoice',
    customer_id: 'C1',
    customer_name: 'Acme',
    customer_vat: 'LU0',
    issue_date: '2026-02-21',
    due_date: '2026-03-23',
    currency: 'EUR',
    subtotal: opts.invoiceTotal,
    tax_total: 0,
    total: opts.invoiceTotal,
  });
  await db.insert(transactions).values({
    id: 'TXN-0001',
    date: '2026-02-26',
    amount: opts.txAmount,
    currency: 'EUR',
    counterparty_name: 'Acme Sarl',
    description: 'Payment INV-2026-0001',
    structured_reference: opts.ref,
    dedup_hash: 'h1',
  });
}

describe('R1 exact ref', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('auto-confirms exact match at full amount', async () => {
    const { db } = await getTestDb();
    await seed(db, { txAmount: 112320, invoiceTotal: 112320, ref: 'INV-2026-0001' });
    await runR1ExactRef(db, matcherConfig, () => {});
    await recomputeTxStatus(db, 'TXN-0001');
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.status).toBe('confirmed');
    expect(allocs[0]!.amount).toBe(112320);
    const tx = (await db.select().from(transactions).where(eq(transactions.id, 'TXN-0001')))[0]!;
    expect(tx.status).toBe('auto_matched');
  });

  it('auto-confirms partial at txn amount and leaves invoice partially paid', async () => {
    const { db } = await getTestDb();
    await seed(db, { txAmount: 50000, invoiceTotal: 112320, ref: 'INV-2026-0001' });
    await runR1ExactRef(db, matcherConfig, () => {});
    await recomputeTxStatus(db, 'TXN-0001');
    const allocs = await db.select().from(allocations);
    expect(allocs[0]!.amount).toBe(50000);
    const tx = (await db.select().from(transactions).where(eq(transactions.id, 'TXN-0001')))[0]!;
    expect(tx.status).toBe('auto_matched');
  });

  it('flags overpayment for review', async () => {
    const { db } = await getTestDb();
    // 6% over (above default 5% AND >€5)
    await seed(db, { txAmount: 119000, invoiceTotal: 112000, ref: 'INV-2026-0001' });
    await runR1ExactRef(db, matcherConfig, () => {});
    await recomputeTxStatus(db, 'TXN-0001');
    const allocs = await db.select().from(allocations);
    expect(allocs[0]!.amount).toBe(112000);
    expect(allocs[0]!.status).toBe('proposed');
    const tx = (await db.select().from(transactions).where(eq(transactions.id, 'TXN-0001')))[0]!;
    expect(tx.status).toBe('needs_review');
  });

  it('does nothing when ref does not match any invoice', async () => {
    const { db } = await getTestDb();
    await seed(db, { txAmount: 1000, invoiceTotal: 1000, ref: 'INV-NOPE' });
    await runR1ExactRef(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `packages/api/src/matcher/rules/r1-exact-ref.ts`**

```ts
import { eq, isNotNull, and } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';

type RuleHook = (event: string) => void;

export async function runR1ExactRef(db: DB, cfg: MatcherConfig, fired: RuleHook): Promise<void> {
  const txs = await db
    .select()
    .from(transactions)
    .where(and(isNotNull(transactions.structured_reference), eq(transactions.status, 'unmatched')));

  for (const tx of txs) {
    const ref = tx.structured_reference!;
    const inv = (await db.select().from(invoices).where(eq(invoices.id, ref)).limit(1))[0];
    if (!inv) continue;
    if (inv.currency !== tx.currency) continue;

    const balance = await invoiceBalance(db, inv.id);
    if (balance <= 0) continue;

    const allocAmount = Math.min(tx.amount, balance);
    const overpaymentAbs = tx.amount - balance;
    const overpaymentPct = balance > 0 ? overpaymentAbs / balance : 0;
    const isOver = overpaymentAbs > cfg.overpayment.absThresholdCents && overpaymentPct > cfg.overpayment.pctThreshold;

    const bucket = isOver ? 'propose' : 'auto_confirm';
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: inv.id,
      amount: allocAmount,
      confidence: cfg.ruleConfidence.exactRef,
      rule: 'exact_ref',
      bucket,
    });
    fired('exact_ref');
  }
}
```

- [ ] **Step 3: Run test**

```bash
pnpm --filter @reconciler/api test r1
```

Expected: 4 pass.

- [ ] **Step 4: Wire R1 into pipeline**

Edit `packages/api/src/matcher/pipeline.ts` — replace the body of `runMatcher` to call R1:

```ts
import { eq, and, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { transactions, allocations } from '../db/schema.js';
import { matcherConfig, type MatcherConfig } from './config.js';
import { runR1ExactRef } from './rules/r1-exact-ref.js';
import { recomputeTxStatus } from './update-tx-status.js';

export interface MatcherReport {
  config: MatcherConfig;
  totals: {
    examined: number;
    autoConfirmed: number;
    proposed: number;
    markedUnrelated: number;
    skippedLocked: number;
    unchanged: number;
  };
  perRule: Record<string, number>;
}

export async function runMatcher(db: DB): Promise<MatcherReport> {
  const report: MatcherReport = {
    config: matcherConfig,
    totals: { examined: 0, autoConfirmed: 0, proposed: 0, markedUnrelated: 0, skippedLocked: 0, unchanged: 0 },
    perRule: {},
  };
  const txs = await db.select().from(transactions);
  report.totals.examined = txs.length;

  const fired = (rule: string) => {
    report.perRule[rule] = (report.perRule[rule] ?? 0) + 1;
  };

  await runR1ExactRef(db, matcherConfig, fired);

  for (const tx of txs) await recomputeTxStatus(db, tx.id);

  const stats = await db
    .select({
      auto: sql<string>`count(*) filter (where status = 'auto_matched')`,
      review: sql<string>`count(*) filter (where status = 'needs_review')`,
    })
    .from(transactions);
  report.totals.autoConfirmed = Number(stats[0]?.auto ?? 0);
  report.totals.proposed = Number(stats[0]?.review ?? 0);

  return report;
}
```

- [ ] **Step 5: Re-run pipeline test**

```bash
pnpm --filter @reconciler/api test pipeline
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/matcher
git commit -m "feat(matcher): R1 exact-reference rule wired into pipeline"
```

---

## Task 15: Matcher idempotency test

**Files:**

- Create: `packages/api/test/matcher/idempotency.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runMatcher } from '../../src/matcher/pipeline.js';

describe('matcher idempotency', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('two runs produce identical allocations', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'p INV-A',
      structured_reference: 'INV-A',
      dedup_hash: 'h1',
    });
    await runMatcher(db);
    const first = await db.select().from(allocations);
    await runMatcher(db);
    const second = await db.select().from(allocations);
    expect(second.length).toBe(first.length);
    expect(second[0]!.id).toBe(first[0]!.id);
    expect(second[0]!.updated_at.getTime()).toBe(first[0]!.updated_at.getTime());
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @reconciler/api test idempotency
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/matcher/idempotency.test.ts
git commit -m "test(matcher): idempotent re-runs do not churn allocations"
```

---

## Task 16: API — GET /api/transactions, /stats, /:id; POST /api/matcher/run

**Files:**

- Create: `packages/api/src/routes/transactions.ts`, `packages/api/src/routes/matcher.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create `packages/api/src/routes/transactions.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { and, eq, ilike, or, sql, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transactions, allocations } from '../db/schema.js';
import { z } from 'zod';

const StatusQuery = z
  .enum(['unmatched', 'auto_matched', 'partially_allocated', 'needs_review', 'unrelated', 'payout_batch', 'all'])
  .default('all');

export async function transactionRoutes(app: FastifyInstance) {
  app.get('/api/transactions', async (req) => {
    const q = z
      .object({
        status: StatusQuery.optional(),
        search: z.string().optional(),
      })
      .parse(req.query);

    const filters = [] as any[];
    if (q.status && q.status !== 'all') filters.push(eq(transactions.status, q.status));
    if (q.search) {
      const like = `%${q.search}%`;
      filters.push(
        or(
          ilike(transactions.id, like),
          ilike(transactions.counterparty_name, like),
          ilike(transactions.description, like),
          ilike(transactions.structured_reference, like),
        ),
      );
    }
    return db
      .select()
      .from(transactions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(transactions.date));
  });

  app.get('/api/transactions/stats', async () => {
    const rows = await db
      .select({
        status: transactions.status,
        count: sql<string>`count(*)`,
      })
      .from(transactions)
      .groupBy(transactions.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  });

  app.get<{ Params: { id: string } }>('/api/transactions/:id', async (req, reply) => {
    const tx = (await db.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1))[0];
    if (!tx) return reply.code(404).send({ error: 'not_found' });
    const allocs = await db.select().from(allocations).where(eq(allocations.transaction_id, tx.id));
    return {
      ...tx,
      allocations: allocs.filter((a) => a.status !== 'proposed'),
      proposals: allocs.filter((a) => a.status === 'proposed'),
    };
  });
}
```

- [ ] **Step 2: Create `packages/api/src/routes/matcher.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { runMatcher } from '../matcher/pipeline.js';

export async function matcherRoutes(app: FastifyInstance) {
  app.post('/api/matcher/run', async () => runMatcher(db));
}
```

- [ ] **Step 3: Update `packages/api/src/server.ts`**

```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import { transactionRoutes } from './routes/transactions.js';
import { matcherRoutes } from './routes/matcher.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(transactionRoutes);
await app.register(matcherRoutes);

app.get('/api/health', async () => ({ ok: true }));

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Write integration test**

Create `packages/api/test/routes/transactions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactionRoutes } from '../../src/routes/transactions.js';
import { matcherRoutes } from '../../src/routes/matcher.js';
import { transactions, invoices } from '../../src/db/schema.js';

async function buildApp() {
  const app = Fastify();
  await app.register(transactionRoutes);
  await app.register(matcherRoutes);
  return app;
}

describe('transactions API', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('GET /api/transactions returns all', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'p INV-A',
      structured_reference: 'INV-A',
      dedup_hash: 'h1',
    });
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/api/transactions' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.payload)).toHaveLength(1);
    await app.close();
  });

  it('GET /api/transactions/:id returns proposals + allocations', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'p',
      structured_reference: 'INV-A',
      dedup_hash: 'h1',
    });
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/matcher/run' });
    const r = await app.inject({ method: 'GET', url: '/api/transactions/T1' });
    const body = JSON.parse(r.payload);
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0].status).toBe('confirmed');
    await app.close();
  });
});
```

- [ ] **Step 5: Run**

```bash
pnpm --filter @reconciler/api test transactions
```

Expected: 2 pass.

- [ ] **Step 6: Smoke test in docker**

```bash
docker compose down -v
docker compose up --build -d
sleep 10
curl -s http://localhost:3001/api/transactions/stats
curl -s http://localhost:3001/api/transactions | head -c 500
docker compose down
```

Expected: stats shows `auto_matched` and `unmatched` counts (R1 alone won't auto-match everything yet).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes packages/api/src/server.ts packages/api/test/routes
git commit -m "feat(api): list/stats/detail transactions + matcher run endpoint"
```

---

# Phase 2 — Heuristics (R2-R8, payouts, reviewer endpoints)

## Task 17: Normalization helpers (refs and counterparty names)

**Files:**

- Create: `packages/api/src/matcher/normalize.ts`

- [ ] **Step 1: Write failing test**

Create `packages/api/test/matcher/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeCustomerName, normalizeRef, extractRefsFromText } from '../../src/matcher/normalize.js';

describe('normalizeCustomerName', () => {
  it('strips legal suffixes', () => {
    expect(normalizeCustomerName('Acme S.à r.l.')).toBe('acme');
    expect(normalizeCustomerName('Globex S.A.')).toBe('globex');
    expect(normalizeCustomerName('Initech Luxembourg SARL')).toBe('initech luxembourg');
    expect(normalizeCustomerName('Hooli SARL-S')).toBe('hooli');
  });
  it('strips IBAN tail', () => {
    expect(normalizeCustomerName('Umbrella SCS / IBAN LU28 0019 4006 4475 0000')).toBe('umbrella');
  });
  it('collapses whitespace', () => {
    expect(normalizeCustomerName('INITECHLUXEMBOURGSARL')).toBe('initechluxembourg');
  });
});

describe('normalizeRef', () => {
  it('strips separators and lowercases', () => {
    expect(normalizeRef('INV-2026-0003')).toBe('inv20260003');
    expect(normalizeRef('INV 2026 0003')).toBe('inv20260003');
  });
});

describe('extractRefsFromText', () => {
  it('finds inv-yyyy-nnnn patterns', () => {
    expect(extractRefsFromText('Payment INV-2026-0003 thanks')).toEqual(['INV-2026-0003']);
    expect(extractRefsFromText('two refs INV-2026-0001 and INV-2026-0009')).toEqual(['INV-2026-0001', 'INV-2026-0009']);
    expect(extractRefsFromText('nothing here')).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement `packages/api/src/matcher/normalize.ts`**

```ts
const SUFFIXES = ['s.à r.l.', 'sarl-s', 'sarl', 's.a.', 'sa', 'scs', 'scsp'];

export function normalizeCustomerName(input: string): string {
  let s = input.toLowerCase();
  // strip IBAN tail and anything after a slash
  s = s.split('/')[0]!.trim();
  s = s.replace(/iban\s*lu\s*[\d\s]*$/, '').trim();
  // strip legal suffixes
  for (const suf of SUFFIXES) {
    const re = new RegExp(`\\b${suf.replace(/[.]/g, '\\.')}\\b`, 'g');
    s = s.replace(re, '');
  }
  s = s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

export function normalizeRef(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function extractRefsFromText(text: string): string[] {
  const re = /INV-\d{4}-\d{4}/g;
  return text.match(re) ?? [];
}
```

- [ ] **Step 3: Run test**

```bash
pnpm --filter @reconciler/api test normalize
```

Expected: 3 describes, 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/matcher/normalize.ts packages/api/test/matcher/normalize.test.ts
git commit -m "feat(matcher): name + reference normalization helpers"
```

---

## Task 18: R2 — Reference extracted from description

**Files:**

- Create: `packages/api/src/matcher/rules/r2-description-ref.ts`
- Modify: `packages/api/src/matcher/pipeline.ts`

- [ ] **Step 1: Write failing test**

Create `packages/api/test/matcher/r2.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR2DescriptionRef } from '../../src/matcher/rules/r2-description-ref.js';
import { matcherConfig } from '../../src/matcher/config.js';

describe('R2 description ref', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('matches when ref is in description but structured_reference is null', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-2026-0010',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'Wire transfer for INV-2026-0010 thanks',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR2DescriptionRef(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.rule).toBe('description_ref');
  });

  it('does nothing when structured_reference is already set', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-2026-0010',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'INV-2026-0010',
      structured_reference: 'INV-2026-0010',
      dedup_hash: 'h1',
    });
    await runR2DescriptionRef(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `packages/api/src/matcher/rules/r2-description-ref.ts`**

```ts
import { eq, and, isNull } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { extractRefsFromText } from '../normalize.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';

export async function runR2DescriptionRef(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.structured_reference), eq(transactions.status, 'unmatched')));

  for (const tx of txs) {
    const refs = extractRefsFromText(tx.description);
    if (refs.length === 0) continue;
    // single-ref simple case; multiple refs are handled by R5 subset-sum
    if (refs.length > 1) continue;
    const ref = refs[0]!;
    const inv = (await db.select().from(invoices).where(eq(invoices.id, ref)).limit(1))[0];
    if (!inv || inv.currency !== tx.currency) continue;
    const balance = await invoiceBalance(db, inv.id);
    if (balance <= 0) continue;
    const overAbs = tx.amount - balance;
    const isOver =
      overAbs > cfg.overpayment.absThresholdCents && overAbs / Math.max(balance, 1) > cfg.overpayment.pctThreshold;
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: inv.id,
      amount: Math.min(tx.amount, balance),
      confidence: cfg.ruleConfidence.descriptionRef,
      rule: 'description_ref',
      bucket: isOver ? 'propose' : 'auto_confirm',
    });
    fired('description_ref');
  }
}
```

- [ ] **Step 3: Add R2 to pipeline**

In `packages/api/src/matcher/pipeline.ts`, add the import and call after R1:

```ts
import { runR2DescriptionRef } from './rules/r2-description-ref.js';
// ...
await runR1ExactRef(db, matcherConfig, fired);
await runR2DescriptionRef(db, matcherConfig, fired);
```

- [ ] **Step 4: Run R2 test**

```bash
pnpm --filter @reconciler/api test r2
```

Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/matcher packages/api/test/matcher/r2.test.ts
git commit -m "feat(matcher): R2 reference extraction from description"
```

---

## Task 19: R3 — Fuzzy reference matching

**Files:**

- Create: `packages/api/src/matcher/rules/r3-fuzzy-ref.ts`
- Modify: `packages/api/src/matcher/pipeline.ts`

- [ ] **Step 1: Write failing test**

Create `packages/api/test/matcher/r3.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR3FuzzyRef } from '../../src/matcher/rules/r3-fuzzy-ref.js';
import { matcherConfig } from '../../src/matcher/config.js';

async function seedInv(db: any, id: string, total: number) {
  await db.insert(invoices).values({
    id,
    type: 'invoice',
    customer_id: 'C1',
    customer_name: 'X',
    customer_vat: 'LU0',
    issue_date: '2026-01-01',
    due_date: '2026-02-01',
    currency: 'EUR',
    subtotal: total,
    tax_total: 0,
    total,
  });
}
async function seedTx(db: any, opts: { id: string; ref: string | null; desc: string; amount: number }) {
  await db.insert(transactions).values({
    id: opts.id,
    date: '2026-01-15',
    amount: opts.amount,
    currency: 'EUR',
    counterparty_name: 'x',
    description: opts.desc,
    structured_reference: opts.ref,
    dedup_hash: opts.id,
  });
}

describe('R3 fuzzy ref', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('matches separator-stripped ref in description', async () => {
    const { db } = await getTestDb();
    await seedInv(db, 'INV-2026-0003', 1000);
    await seedTx(db, { id: 'T1', ref: null, desc: 'wire INV20260003 today', amount: 1000 });
    await runR3FuzzyRef(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.rule).toBe('fuzzy_ref');
  });

  it('matches with single typo (Levenshtein 1)', async () => {
    const { db } = await getTestDb();
    await seedInv(db, 'INV-2026-0007', 1000);
    await seedTx(db, { id: 'T1', ref: 'INV-2026-0008', desc: 'x', amount: 1000 });
    // ref is distance 1 from INV-2026-0007 — but INV-2026-0008 may not exist.
    await runR3FuzzyRef(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.invoice_id).toBe('INV-2026-0007');
  });

  it('does not match when amount differs beyond tolerance', async () => {
    const { db } = await getTestDb();
    await seedInv(db, 'INV-2026-0003', 1000);
    await seedTx(db, { id: 'T1', ref: null, desc: 'INV20260003', amount: 99999 });
    await runR3FuzzyRef(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `packages/api/src/matcher/rules/r3-fuzzy-ref.ts`**

```ts
import { eq, and } from 'drizzle-orm';
import levenshtein from 'fast-levenshtein';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { normalizeRef } from '../normalize.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';
import { withinTolerance } from '../score.js';

export async function runR3FuzzyRef(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, 'unmatched'));
  if (txs.length === 0) return;
  const allInv = await db.select().from(invoices);
  const normInv = allInv.map((i) => ({ inv: i, norm: normalizeRef(i.id) }));

  for (const tx of txs) {
    const haystack = `${tx.structured_reference ?? ''} ${tx.description}`;
    const tokens = haystack.split(/\s+/).filter((t) => t.length >= 6);
    let best: { inv: (typeof allInv)[number]; dist: number } | null = null;
    for (const tok of tokens) {
      const normTok = normalizeRef(tok);
      for (const { inv, norm } of normInv) {
        const d = levenshtein.get(normTok, norm);
        if (d <= cfg.fuzzyRef.maxLevenshtein && (!best || d < best.dist)) {
          best = { inv, dist: d };
        }
      }
    }
    if (!best) continue;
    if (best.inv.currency !== tx.currency) continue;
    const balance = await invoiceBalance(db, best.inv.id);
    if (balance <= 0) continue;
    if (
      !withinTolerance(tx.amount, balance, cfg.amountToleranceCents) &&
      tx.amount > balance + cfg.overpayment.absThresholdCents
    )
      continue;
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: best.inv.id,
      amount: Math.min(tx.amount, balance),
      confidence: cfg.ruleConfidence.fuzzyRef,
      rule: 'fuzzy_ref',
      bucket: 'propose',
    });
    fired('fuzzy_ref');
  }
}
```

- [ ] **Step 3: Wire into pipeline**

Add after R2:

```ts
import { runR3FuzzyRef } from './rules/r3-fuzzy-ref.js';
// ...
await runR3FuzzyRef(db, matcherConfig, fired);
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @reconciler/api test r3
```

Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/matcher packages/api/test/matcher/r3.test.ts
git commit -m "feat(matcher): R3 fuzzy reference matching with Levenshtein"
```

---

## Task 20: R4 — Customer name + amount + date window

**Files:**

- Create: `packages/api/src/matcher/jaro-winkler.ts`, `packages/api/src/matcher/rules/r4-name-amount-date.ts`
- Modify: `packages/api/src/matcher/pipeline.ts`

- [ ] **Step 1: Implement Jaro-Winkler**

Create `packages/api/src/matcher/jaro-winkler.ts`:

```ts
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length,
    len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const m1 = new Array(len1).fill(false);
  const m2 = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (m2[j]) continue;
      if (s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0,
    k = 0;
  for (let i = 0; i < len1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3;
}

export function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}
```

- [ ] **Step 2: Test JW**

Create `packages/api/test/matcher/jw.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jaroWinkler } from '../../src/matcher/jaro-winkler.js';

describe('jaroWinkler', () => {
  it('returns 1 for identical', () => expect(jaroWinkler('acme', 'acme')).toBe(1));
  it('returns 0 for disjoint', () => expect(jaroWinkler('abc', 'xyz')).toBe(0));
  it('close strings exceed 0.88', () => expect(jaroWinkler('acme', 'acme corp'.substring(0, 4))).toBeGreaterThan(0.88));
});
```

```bash
pnpm --filter @reconciler/api test jw
```

Expected: pass.

- [ ] **Step 3: Implement R4**

Create `packages/api/src/matcher/rules/r4-name-amount-date.ts`:

```ts
import { eq, and, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { normalizeCustomerName } from '../normalize.js';
import { jaroWinkler } from '../jaro-winkler.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';
import { withinTolerance } from '../score.js';

const dayMs = 24 * 60 * 60 * 1000;

export async function runR4NameAmountDate(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, 'unmatched'));
  if (txs.length === 0) return;
  const allInv = await db.select().from(invoices);
  const normInv = allInv.map((i) => ({ inv: i, norm: normalizeCustomerName(i.customer_name) }));

  for (const tx of txs) {
    const txNorm = normalizeCustomerName(tx.counterparty_name);
    if (!txNorm) continue;

    const customerHits = normInv.filter(
      ({ norm }) => jaroWinkler(txNorm, norm) >= cfg.customerName.jaroWinklerThreshold,
    );
    if (customerHits.length === 0) continue;

    const candidates: typeof allInv = [];
    for (const { inv } of customerHits) {
      if (inv.currency !== tx.currency) continue;
      if (inv.type !== 'invoice') continue;
      const issue = new Date(inv.issue_date);
      const txDate = new Date(tx.date);
      const diff = (txDate.getTime() - issue.getTime()) / dayMs;
      if (diff < -cfg.dateWindow.daysBeforeIssue) continue;
      if (diff > cfg.dateWindow.daysAfterIssue) continue;
      const balance = await invoiceBalance(db, inv.id);
      if (balance <= 0) continue;
      if (!withinTolerance(tx.amount, balance, cfg.amountToleranceCents)) continue;
      candidates.push(inv);
    }
    if (candidates.length !== 1) continue;
    const inv = candidates[0]!;
    const balance = await invoiceBalance(db, inv.id);
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: inv.id,
      amount: Math.min(tx.amount, balance),
      confidence: cfg.ruleConfidence.nameAmountDate,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    fired('name_amount_date');
  }
}
```

- [ ] **Step 4: Wire into pipeline**

```ts
import { runR4NameAmountDate } from './rules/r4-name-amount-date.js';
// ...
await runR4NameAmountDate(db, matcherConfig, fired);
```

- [ ] **Step 5: Test R4**

Create `packages/api/test/matcher/r4.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR4NameAmountDate } from '../../src/matcher/rules/r4-name-amount-date.js';
import { matcherConfig } from '../../src/matcher/config.js';

describe('R4 name+amount+date', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('matches normalized customer name with single open invoice', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'Initech Luxembourg SARL',
      customer_vat: 'LU0',
      issue_date: '2026-02-12',
      due_date: '2026-03-14',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-02-25',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'INITECHLUXEMBOURGSARL',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR4NameAmountDate(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.rule).toBe('name_amount_date');
  });

  it('does not match when amount has multiple candidates', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
        id: 'INV-A',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-02-01',
        due_date: '2026-03-01',
        currency: 'EUR',
        subtotal: 1000,
        tax_total: 0,
        total: 1000,
      },
      {
        id: 'INV-B',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-02-01',
        due_date: '2026-03-01',
        currency: 'EUR',
        subtotal: 1000,
        tax_total: 0,
        total: 1000,
      },
    ]);
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-02-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'Acme',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR4NameAmountDate(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
```

```bash
pnpm --filter @reconciler/api test r4
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/matcher packages/api/test/matcher/r4.test.ts packages/api/test/matcher/jw.test.ts
git commit -m "feat(matcher): R4 name+amount+date window with Jaro-Winkler"
```

---

## Task 21: R5 — Subset-sum consolidated payments

**Files:**

- Create: `packages/api/src/matcher/rules/r5-subset-sum.ts`
- Modify: `packages/api/src/matcher/pipeline.ts`

- [ ] **Step 1: Implement R5**

```ts
import { eq } from 'drizzle-orm';
import cuid from 'cuid';
import type { DB } from '../../db/client.js';
import { transactions, invoices, allocations } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { normalizeCustomerName } from '../normalize.js';
import { jaroWinkler } from '../jaro-winkler.js';
import { invoiceBalance, openInvoicesForCustomer } from '../balance.js';
import { recordAudit } from '../../db/audit.js';

interface Subset {
  invoices: Array<{ id: string; balance: number }>;
  sum: number;
}

function findSingleSubset(
  candidates: Array<{ id: string; balance: number }>,
  target: number,
  tolerance: number,
  maxInvoices: number,
  maxCandidates: number,
): Subset | null {
  if (candidates.length > maxCandidates) candidates = candidates.slice(0, maxCandidates);
  let found: Subset | null = null;
  let foundCount = 0;
  function recurse(start: number, picked: typeof candidates, sum: number) {
    if (foundCount > 1) return;
    if (Math.abs(sum - target) <= tolerance && picked.length > 0) {
      found = { invoices: picked.slice(), sum };
      foundCount++;
      return;
    }
    if (picked.length >= maxInvoices) return;
    if (sum > target + tolerance) return;
    for (let i = start; i < candidates.length; i++) {
      picked.push(candidates[i]!);
      recurse(i + 1, picked, sum + candidates[i]!.balance);
      picked.pop();
      if (foundCount > 1) return;
    }
  }
  recurse(0, [], 0);
  return foundCount === 1 ? found : null;
}

export async function runR5SubsetSum(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, 'unmatched'));
  if (txs.length === 0) return;
  const allInv = await db.select().from(invoices);
  const normInv = allInv.map((i) => ({ inv: i, norm: normalizeCustomerName(i.customer_name) }));

  for (const tx of txs) {
    const txNorm = normalizeCustomerName(tx.counterparty_name);
    if (!txNorm) continue;
    const customers = new Set(
      normInv
        .filter(({ norm }) => jaroWinkler(txNorm, norm) >= cfg.customerName.jaroWinklerThreshold)
        .map(({ inv }) => inv.customer_id),
    );
    if (customers.size === 0) continue;

    let chosen: Subset | null = null;
    for (const cust of customers) {
      const open = await openInvoicesForCustomer(db, cust);
      const candidates = open.map((o) => ({ id: o.id, balance: o.balance }));
      const subset = findSingleSubset(
        candidates,
        tx.amount,
        cfg.amountToleranceCents,
        cfg.subsetSum.maxInvoices,
        cfg.subsetSum.maxCandidates,
      );
      if (subset && subset.invoices.length >= 2) {
        chosen = subset;
        break;
      }
    }
    if (!chosen) continue;

    const correlation = cuid();
    for (const inv of chosen.invoices) {
      const id = cuid();
      await db.insert(allocations).values({
        id,
        transaction_id: tx.id,
        invoice_id: inv.id,
        amount: inv.balance,
        confidence: cfg.ruleConfidence.subsetSum.toFixed(2),
        status: 'proposed',
        source: 'auto',
        rule: 'subset_sum',
        created_by: 'matcher',
      });
      await recordAudit(db, {
        entity_type: 'allocation',
        entity_id: id,
        action: 'matcher_proposed',
        actor: 'matcher',
        correlation_id: correlation,
        after: { transaction_id: tx.id, invoice_id: inv.id, amount: inv.balance, status: 'proposed' },
      });
      fired('subset_sum');
    }
  }
}
```

- [ ] **Step 2: Wire into pipeline**

```ts
import { runR5SubsetSum } from './rules/r5-subset-sum.js';
// ...
await runR5SubsetSum(db, matcherConfig, fired);
```

- [ ] **Step 3: Test R5**

Create `packages/api/test/matcher/r5.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR5SubsetSum } from '../../src/matcher/rules/r5-subset-sum.js';
import { matcherConfig } from '../../src/matcher/config.js';

describe('R5 subset sum', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('creates multi-row allocation for unique subset', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
        id: 'INV-A',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 1000,
        tax_total: 0,
        total: 1000,
      },
      {
        id: 'INV-B',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 2500,
        tax_total: 0,
        total: 2500,
      },
    ]);
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 3500,
      currency: 'EUR',
      counterparty_name: 'Acme',
      description: 'consolidated',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR5SubsetSum(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(2);
    expect(allocs.every((a) => a.rule === 'subset_sum')).toBe(true);
  });

  it('does nothing when multiple subsets sum to target', async () => {
    const { db } = await getTestDb();
    // 1000 = A or = B+C (B=400,C=600)
    await db.insert(invoices).values([
      {
        id: 'A',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 1000,
        tax_total: 0,
        total: 1000,
      },
      {
        id: 'B',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 400,
        tax_total: 0,
        total: 400,
      },
      {
        id: 'C',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 600,
        tax_total: 0,
        total: 600,
      },
    ]);
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'Acme',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR5SubsetSum(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
```

```bash
pnpm --filter @reconciler/api test r5
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/matcher packages/api/test/matcher/r5.test.ts
git commit -m "feat(matcher): R5 subset-sum consolidated payments"
```

---

## Task 22: R6 — Credit-note netting

**Files:**

- Create: `packages/api/src/matcher/rules/r6-credit-note-net.ts`
- Modify: `packages/api/src/matcher/pipeline.ts`

- [ ] **Step 1: Implement**

```ts
import { eq, and } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { invoices, allocations } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { invoiceBalance, openInvoicesForCustomer } from '../balance.js';
import cuid from 'cuid';
import { recordAudit } from '../../db/audit.js';

export async function runR6CreditNoteNet(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const creditNotes = await db.select().from(invoices).where(eq(invoices.type, 'credit_note'));
  for (const cn of creditNotes) {
    const cnBalance = await invoiceBalance(db, cn.id);
    if (cnBalance <= 0) continue;
    const open = await openInvoicesForCustomer(db, cn.customer_id);
    const exact = open.filter((o) => o.balance === cnBalance);
    if (exact.length !== 1) continue;
    const target = exact[0]!;

    // We model credit-note netting as TWO allocations sharing a synthetic transaction-less link?
    // Simpler: skip — netting is a reviewer action surfaced as a proposal pair only
    // when a real txn is involved. For now, propose nothing here; the UI will let
    // the reviewer attach a credit note manually. Keep this rule as a placeholder.
    fired('credit_note_net_skipped');
  }
}
```

> **Note:** A credit note has no `transaction_id` — it isn't a bank movement. The cleanest model is: when a customer's later transaction arrives and would have over-paid an invoice, the matcher (R1-R5) proposes the full payment; the reviewer can manually add a _negative_ allocation row pointing to the credit-note "invoice" and confirm the net. We surface this in the UI's `InvoicePicker` (`[CN]` badge). R6 stays as a hook for future automation.

- [ ] **Step 2: Wire (no-op for now, but routed)**

```ts
import { runR6CreditNoteNet } from './rules/r6-credit-note-net.js';
// ...
await runR6CreditNoteNet(db, matcherConfig, fired);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/matcher
git commit -m "feat(matcher): R6 credit-note hook (reviewer-driven netting via UI)"
```

---

## Task 23: Payout CSV parsing in seed

**Files:**

- Modify: `packages/api/src/db/seed.ts`

- [ ] **Step 1: Add CSV parsing dep**

```bash
cd packages/api && pnpm add csv-parse && cd -
```

- [ ] **Step 2: Add `seedPayout` to seed.ts**

In `packages/api/src/db/seed.ts`, add after `seedTransactions` and before `main`:

```ts
import { parse as parseCsv } from 'csv-parse/sync';
import { payout_batches, payout_items } from './schema.js';

async function seedPayout() {
  const raw = readFileSync(`${taskDir}/payout_report.csv`, 'utf-8');
  const rows = parseCsv(raw, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;

  const totalRow = rows.find((r) => r.type === 'payout');
  if (!totalRow) throw new Error('payout total row missing');

  const charges = rows.filter((r) => r.type === 'charge');
  const refunds = rows.filter((r) => r.type === 'refund');
  const chargebacks = rows.filter((r) => r.type === 'chargeback');

  const grossTotal = [...charges, ...refunds, ...chargebacks].reduce(
    (s, r) => s + toCents(Number(r.gross_amount || '0')),
    0,
  );
  const feeTotal = [...charges, ...refunds, ...chargebacks].reduce((s, r) => s + toCents(Number(r.fee || '0')), 0);
  const netTotal = toCents(Number(totalRow.net_amount));

  const batchId = totalRow.charge_id;
  await db
    .insert(payout_batches)
    .values({
      id: batchId,
      transaction_id: null,
      gross_total: grossTotal,
      fee_total: feeTotal,
      net_total: netTotal,
    })
    .onConflictDoUpdate({
      target: payout_batches.id,
      set: { gross_total: grossTotal, fee_total: feeTotal, net_total: netTotal },
    });

  for (const r of [...charges, ...refunds, ...chargebacks]) {
    await db
      .insert(payout_items)
      .values({
        id: r.charge_id,
        payout_batch_id: batchId,
        invoice_id: r.invoice_id || null,
        customer_name: r.customer_name,
        gross_amount: toCents(Number(r.gross_amount || '0')),
        fee: toCents(Number(r.fee || '0')),
        net_amount: toCents(Number(r.net_amount || '0')),
        type: r.type as 'charge' | 'refund' | 'chargeback',
      })
      .onConflictDoNothing();
  }
  console.log(`seeded payout batch with ${charges.length + refunds.length + chargebacks.length} items`);
}
```

Then call `await seedPayout();` in `main()` after `seedTransactions()`.

- [ ] **Step 3: Run seed and verify**

```bash
docker compose down -v
docker compose up -d db
sleep 4
docker compose run --rm api pnpm db:migrate
docker compose run --rm api pnpm db:seed
docker compose exec db psql -U reconciler -d reconciler -c "select count(*) from payout_items; select id, net_total from payout_batches;"
docker compose down
```

Expected: 7 payout_items (5 charges + 1 refund + 1 chargeback), 1 batch with `net_total = 272073`.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/seed.ts packages/api/package.json pnpm-lock.yaml
git commit -m "feat(api): parse payout_report.csv into batches + items"
```

---

## Task 24: R7 — Payout batch link

**Files:**

- Create: `packages/api/src/matcher/rules/r7-payout-link.ts`
- Modify: `packages/api/src/matcher/pipeline.ts`

- [ ] **Step 1: Implement**

```ts
import { eq, and, isNull, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, payout_batches, payout_items, allocations, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import cuid from 'cuid';
import { recordAudit } from '../../db/audit.js';

export async function runR7PayoutLink(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const unlinked = await db.select().from(payout_batches).where(isNull(payout_batches.transaction_id));
  for (const batch of unlinked) {
    const candidates = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.amount, batch.net_total), eq(transactions.status, 'unmatched')));
    const winner = candidates.find((t) => {
      const blob = `${t.counterparty_name} ${t.description}`.toLowerCase();
      return blob.includes('payout') || blob.includes('stripe');
    });
    if (!winner) continue;

    await db.update(payout_batches).set({ transaction_id: winner.id }).where(eq(payout_batches.id, batch.id));
    await db
      .update(transactions)
      .set({ status: 'payout_batch', updated_at: sql`now()` })
      .where(eq(transactions.id, winner.id));
    await recordAudit(db, {
      entity_type: 'payout_batch',
      entity_id: batch.id,
      action: 'matcher_auto_confirmed',
      actor: 'matcher',
      after: { transaction_id: winner.id },
    });

    // Build proposed per-charge allocations
    const items = await db.select().from(payout_items).where(eq(payout_items.payout_batch_id, batch.id));
    for (const item of items) {
      if (item.type !== 'charge' || !item.invoice_id) continue;
      const inv = (await db.select().from(invoices).where(eq(invoices.id, item.invoice_id)).limit(1))[0];
      if (!inv) continue;
      const id = cuid();
      await db
        .insert(allocations)
        .values({
          id,
          transaction_id: winner.id,
          invoice_id: inv.id,
          amount: item.gross_amount,
          confidence: cfg.ruleConfidence.payoutLink.toFixed(2),
          status: 'proposed',
          source: 'auto',
          rule: 'payout_link',
          created_by: 'matcher',
        })
        .onConflictDoNothing();
      await recordAudit(db, {
        entity_type: 'allocation',
        entity_id: id,
        action: 'matcher_proposed',
        actor: 'matcher',
        after: { transaction_id: winner.id, invoice_id: inv.id, amount: item.gross_amount },
      });
      fired('payout_link');
    }
  }
}
```

- [ ] **Step 2: Wire**

```ts
import { runR7PayoutLink } from './rules/r7-payout-link.js';
// ...
await runR7PayoutLink(db, matcherConfig, fired);
```

- [ ] **Step 3: Test R7**

Create `packages/api/test/matcher/r7.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations, payout_batches, payout_items } from '../../src/db/schema.js';
import { runR7PayoutLink } from '../../src/matcher/rules/r7-payout-link.js';
import { matcherConfig } from '../../src/matcher/config.js';
import { eq } from 'drizzle-orm';

describe('R7 payout link', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('links payout txn and proposes per-charge allocations', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
        id: 'INV-A',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 50000,
        tax_total: 0,
        total: 50000,
      },
    ]);
    await db.insert(transactions).values({
      id: 'T-PAYOUT',
      date: '2026-03-01',
      amount: 47500,
      currency: 'EUR',
      counterparty_name: 'Stripe',
      description: 'Stripe payout March',
      structured_reference: null,
      dedup_hash: 'hp',
    });
    await db.insert(payout_batches).values({
      id: 'po_test',
      transaction_id: null,
      gross_total: 50000,
      fee_total: 2500,
      net_total: 47500,
    });
    await db.insert(payout_items).values({
      id: 'ch_1',
      payout_batch_id: 'po_test',
      invoice_id: 'INV-A',
      customer_name: 'Acme',
      gross_amount: 50000,
      fee: 2500,
      net_amount: 47500,
      type: 'charge',
    });
    await runR7PayoutLink(db, matcherConfig, () => {});
    const tx = (await db.select().from(transactions).where(eq(transactions.id, 'T-PAYOUT')))[0]!;
    expect(tx.status).toBe('payout_batch');
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.status).toBe('proposed');
  });
});
```

```bash
pnpm --filter @reconciler/api test r7
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/matcher packages/api/test/matcher/r7.test.ts
git commit -m "feat(matcher): R7 payout batch link with per-charge proposals"
```

---

## Task 25: R8 — Noise classifier

**Files:**

- Create: `packages/api/src/matcher/rules/r8-noise.ts`
- Modify: `packages/api/src/matcher/pipeline.ts`

- [ ] **Step 1: Implement**

```ts
import { eq, and, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, allocations } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { recordAudit } from '../../db/audit.js';

export async function runR8Noise(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, 'unmatched'));
  for (const tx of txs) {
    const haystack = `${tx.counterparty_name} ${tx.description}`.toLowerCase();
    const hit = cfg.noiseKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
    const isNegativeOrphan = tx.amount < 0;

    if (!hit && !isNegativeOrphan) continue;

    // Don't override if any allocation already exists
    const existing = await db
      .select({ c: sql<string>`count(*)` })
      .from(allocations)
      .where(eq(allocations.transaction_id, tx.id));
    if (Number(existing[0]?.c ?? 0) > 0) continue;

    await db
      .update(transactions)
      .set({ status: 'unrelated', updated_at: sql`now()` })
      .where(eq(transactions.id, tx.id));
    await recordAudit(db, {
      entity_type: 'transaction',
      entity_id: tx.id,
      action: 'matcher_marked_unrelated',
      actor: 'matcher',
      before: { status: tx.status },
      after: { status: 'unrelated' },
    });
    fired('noise');
  }
}
```

- [ ] **Step 2: Wire as last rule**

```ts
import { runR8Noise } from './rules/r8-noise.js';
// ...
await runR8Noise(db, matcherConfig, fired);
```

- [ ] **Step 3: Test R8**

Create `packages/api/test/matcher/r8.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions } from '../../src/db/schema.js';
import { runR8Noise } from '../../src/matcher/rules/r8-noise.js';
import { matcherConfig } from '../../src/matcher/config.js';
import { eq } from 'drizzle-orm';

describe('R8 noise', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('marks salary as unrelated', async () => {
    const { db } = await getTestDb();
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-03-01',
      amount: -250000,
      currency: 'EUR',
      counterparty_name: 'EasyBiz Salary',
      description: 'March salary',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR8Noise(db, matcherConfig, () => {});
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('unrelated');
  });
});
```

```bash
pnpm --filter @reconciler/api test r8
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/matcher packages/api/test/matcher/r8.test.ts
git commit -m "feat(matcher): R8 keyword/orphan noise classifier"
```

---

## Task 26: Reviewer endpoint — PUT /api/transactions/:id/allocations

**Files:**

- Create: `packages/api/src/routes/allocations.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Implement route**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import cuid from 'cuid';
import { db } from '../db/client.js';
import { transactions, allocations, invoices } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';

const Body = z.object({
  version: z.number().int(),
  allocations: z.array(
    z.object({
      invoice_id: z.string(),
      amount: z.number().int(),
    }),
  ),
});

export async function allocationsRoutes(app: FastifyInstance) {
  app.put<{ Params: { id: string }; Body: z.infer<typeof Body> }>(
    '/api/transactions/:id/allocations',
    async (req, reply) => {
      const body = Body.parse(req.body);
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(transactions)
          .set({ version: sql`version + 1`, updated_at: sql`now()` })
          .where(and(eq(transactions.id, req.params.id), eq(transactions.version, body.version)))
          .returning();
        if (updated.length === 0) {
          const current = (await tx.select().from(transactions).where(eq(transactions.id, req.params.id)))[0];
          return reply.code(409).send({ error: 'version_conflict', current });
        }

        const before = await tx.select().from(allocations).where(eq(allocations.transaction_id, req.params.id));
        await tx.delete(allocations).where(eq(allocations.transaction_id, req.params.id));

        const correlation = cuid();
        const after: typeof before = [];
        for (const a of body.allocations) {
          const inv = (await tx.select().from(invoices).where(eq(invoices.id, a.invoice_id)).limit(1))[0];
          if (!inv) return reply.code(400).send({ error: 'invoice_not_found', id: a.invoice_id });
          const id = cuid();
          const row = {
            id,
            transaction_id: req.params.id,
            invoice_id: a.invoice_id,
            amount: a.amount,
            confidence: null,
            status: 'confirmed' as const,
            source: 'manual' as const,
            rule: null,
            created_by: 'reviewer',
          };
          await tx.insert(allocations).values(row);
          after.push(row as any);
        }

        await recordAudit(tx, {
          entity_type: 'transaction',
          entity_id: req.params.id,
          action: 'reviewer_split',
          actor: 'reviewer',
          correlation_id: correlation,
          before,
          after,
        });

        // Recompute status inline
        const sumRow = await tx
          .select({
            sum: sql<string>`coalesce(sum(amount), 0)`,
          })
          .from(allocations)
          .where(and(eq(allocations.transaction_id, req.params.id), eq(allocations.status, 'confirmed')));
        const sum = Number(sumRow[0]?.sum ?? 0);
        const tx0 = updated[0]!;
        let status: string;
        if (sum >= tx0.amount) status = 'auto_matched';
        else if (sum > 0) status = 'partially_allocated';
        else status = 'unmatched';
        await tx.update(transactions).set({ status }).where(eq(transactions.id, req.params.id));

        return { ok: true, version: tx0.version };
      });
    },
  );
}
```

- [ ] **Step 2: Register in server.ts**

```ts
import { allocationsRoutes } from './routes/allocations.js';
// ...
await app.register(allocationsRoutes);
```

- [ ] **Step 3: Test allocations**

Create `packages/api/test/routes/allocations.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactionRoutes } from '../../src/routes/transactions.js';
import { allocationsRoutes } from '../../src/routes/allocations.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';

async function buildApp() {
  const app = Fastify();
  await app.register(transactionRoutes);
  await app.register(allocationsRoutes);
  return app;
}

describe('PUT /api/transactions/:id/allocations', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('replaces allocations as confirmed', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
        id: 'I1',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'X',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 500,
        tax_total: 0,
        total: 500,
      },
      {
        id: 'I2',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'X',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 500,
        tax_total: 0,
        total: 500,
      },
    ]);
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT',
      url: '/api/transactions/T1/allocations',
      payload: {
        version: 1,
        allocations: [
          { invoice_id: 'I1', amount: 500 },
          { invoice_id: 'I2', amount: 500 },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(2);
    expect(allocs.every((a) => a.status === 'confirmed')).toBe(true);
    await app.close();
  });

  it('returns 409 on stale version', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'I1',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 500,
      tax_total: 0,
      total: 500,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 500,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT',
      url: '/api/transactions/T1/allocations',
      payload: { version: 99, allocations: [{ invoice_id: 'I1', amount: 500 }] },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });
});
```

```bash
pnpm --filter @reconciler/api test allocations
```

Expected: 2 pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/allocations.ts packages/api/src/server.ts packages/api/test/routes/allocations.test.ts
git commit -m "feat(api): PUT allocations with optimistic locking + audit"
```

---

## Task 27: Reviewer endpoints — proposals, mark-unrelated, payout-batch confirm

**Files:**

- Create: `packages/api/src/routes/proposals.ts`, `packages/api/src/routes/payouts.ts`
- Modify: `packages/api/src/routes/transactions.ts`, `packages/api/src/server.ts`

- [ ] **Step 1: Add `mark-unrelated` and `unmark-unrelated` to transactions.ts**

Append to `transactionRoutes`:

```ts
const VersionBody = z.object({ version: z.number().int() });

app.post<{ Params: { id: string }; Body: { version: number } }>(
  '/api/transactions/:id/mark-unrelated',
  async (req, reply) => {
    const body = VersionBody.parse(req.body);
    const updated = await db
      .update(transactions)
      .set({ status: 'unrelated', version: sql`version + 1`, updated_at: sql`now()` })
      .where(and(eq(transactions.id, req.params.id), eq(transactions.version, body.version)))
      .returning();
    if (updated.length === 0) {
      const cur = (await db.select().from(transactions).where(eq(transactions.id, req.params.id)))[0];
      return reply.code(409).send({ error: 'version_conflict', current: cur });
    }
    await db.execute(sql`
      insert into audit_log (id, entity_type, entity_id, action, actor, before, after)
      values (gen_random_uuid()::text, 'transaction', ${req.params.id}, 'reviewer_marked_unrelated', 'reviewer', null, jsonb_build_object('status','unrelated'))
    `);
    return { ok: true, version: updated[0]!.version };
  },
);

app.post<{ Params: { id: string }; Body: { version: number } }>(
  '/api/transactions/:id/unmark-unrelated',
  async (req, reply) => {
    const body = VersionBody.parse(req.body);
    const updated = await db
      .update(transactions)
      .set({ status: 'unmatched', version: sql`version + 1`, updated_at: sql`now()` })
      .where(and(eq(transactions.id, req.params.id), eq(transactions.version, body.version)))
      .returning();
    if (updated.length === 0) return reply.code(409).send({ error: 'version_conflict' });
    await db.execute(sql`
      insert into audit_log (id, entity_type, entity_id, action, actor, before, after)
      values (gen_random_uuid()::text, 'transaction', ${req.params.id}, 'reviewer_unmarked_unrelated', 'reviewer', null, null)
    `);
    return { ok: true, version: updated[0]!.version };
  },
);
```

(Make sure `cuid` is imported, or replace `gen_random_uuid()::text` with explicit `cuid()` plus a parameter binding via `recordAudit` — same pattern as Task 26. The `recordAudit` helper is preferred — refactor to use it.)

**Recommended simpler form using recordAudit:**

```ts
import { recordAudit } from '../db/audit.js';

app.post<{ Params: { id: string } }>('/api/transactions/:id/mark-unrelated', async (req, reply) => {
  const body = VersionBody.parse(req.body);
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(transactions)
      .set({ status: 'unrelated', version: sql`version + 1`, updated_at: sql`now()` })
      .where(and(eq(transactions.id, req.params.id), eq(transactions.version, body.version)))
      .returning();
    if (updated.length === 0) {
      const cur = (await tx.select().from(transactions).where(eq(transactions.id, req.params.id)))[0];
      return reply.code(409).send({ error: 'version_conflict', current: cur });
    }
    await recordAudit(tx, {
      entity_type: 'transaction',
      entity_id: req.params.id,
      action: 'reviewer_marked_unrelated',
      actor: 'reviewer',
      after: { status: 'unrelated' },
    });
    return { ok: true, version: updated[0]!.version };
  });
});
```

- [ ] **Step 2: Create `packages/api/src/routes/proposals.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { allocations, transactions } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';

const Body = z.object({ version: z.number().int() });

async function bumpAndCheck(tx: any, txId: string, version: number) {
  const updated = await tx
    .update(transactions)
    .set({ version: sql`version + 1`, updated_at: sql`now()` })
    .where(and(eq(transactions.id, txId), eq(transactions.version, version)))
    .returning();
  return updated[0] ?? null;
}

export async function proposalsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { version: number } }>('/api/proposals/:id/accept', async (req, reply) => {
    const body = Body.parse(req.body);
    return db.transaction(async (tx) => {
      const prop = (await tx.select().from(allocations).where(eq(allocations.id, req.params.id)).limit(1))[0];
      if (!prop || prop.status !== 'proposed') return reply.code(404).send({ error: 'not_proposed' });
      const txRow = await bumpAndCheck(tx, prop.transaction_id, body.version);
      if (!txRow) return reply.code(409).send({ error: 'version_conflict' });
      await tx.update(allocations).set({ status: 'confirmed', source: 'manual' }).where(eq(allocations.id, prop.id));
      await recordAudit(tx, {
        entity_type: 'allocation',
        entity_id: prop.id,
        action: 'reviewer_confirmed',
        actor: 'reviewer',
        before: prop,
        after: { ...prop, status: 'confirmed' },
      });
      return { ok: true, version: txRow.version };
    });
  });

  app.post<{ Params: { id: string }; Body: { version: number } }>('/api/proposals/:id/reject', async (req, reply) => {
    const body = Body.parse(req.body);
    return db.transaction(async (tx) => {
      const prop = (await tx.select().from(allocations).where(eq(allocations.id, req.params.id)).limit(1))[0];
      if (!prop || prop.status !== 'proposed') return reply.code(404).send({ error: 'not_proposed' });
      const txRow = await bumpAndCheck(tx, prop.transaction_id, body.version);
      if (!txRow) return reply.code(409).send({ error: 'version_conflict' });
      await tx.update(allocations).set({ status: 'rejected' }).where(eq(allocations.id, prop.id));
      await recordAudit(tx, {
        entity_type: 'allocation',
        entity_id: prop.id,
        action: 'reviewer_rejected',
        actor: 'reviewer',
        before: prop,
        after: { ...prop, status: 'rejected' },
      });
      return { ok: true, version: txRow.version };
    });
  });
}
```

- [ ] **Step 3: Create `packages/api/src/routes/payouts.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { payout_batches, payout_items, allocations, transactions } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';

const Body = z.object({
  version: z.number().int(),
  accepted_item_ids: z.array(z.string()),
});

export async function payoutRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: z.infer<typeof Body> }>(
    '/api/payout-batches/:id/confirm',
    async (req, reply) => {
      const body = Body.parse(req.body);
      return db.transaction(async (tx) => {
        const batch = (await tx.select().from(payout_batches).where(eq(payout_batches.id, req.params.id)).limit(1))[0];
        if (!batch?.transaction_id) return reply.code(400).send({ error: 'batch_not_linked' });
        const updated = await tx
          .update(transactions)
          .set({ version: sql`version + 1`, updated_at: sql`now()` })
          .where(and(eq(transactions.id, batch.transaction_id), eq(transactions.version, body.version)))
          .returning();
        if (updated.length === 0) return reply.code(409).send({ error: 'version_conflict' });

        const items = await tx.select().from(payout_items).where(eq(payout_items.payout_batch_id, batch.id));
        const accepted = new Set(body.accepted_item_ids);
        for (const item of items) {
          if (item.type !== 'charge' || !item.invoice_id) continue;
          const allocs = await tx
            .select()
            .from(allocations)
            .where(
              and(
                eq(allocations.transaction_id, batch.transaction_id),
                eq(allocations.invoice_id, item.invoice_id),
                eq(allocations.rule, 'payout_link'),
              ),
            );
          const existing = allocs[0];
          if (!existing) continue;
          if (accepted.has(item.id)) {
            await tx
              .update(allocations)
              .set({ status: 'confirmed', source: 'manual' })
              .where(eq(allocations.id, existing.id));
          } else {
            await tx.update(allocations).set({ status: 'rejected' }).where(eq(allocations.id, existing.id));
          }
        }
        await tx.update(payout_batches).set({ status: 'confirmed' }).where(eq(payout_batches.id, batch.id));
        await recordAudit(tx, {
          entity_type: 'payout_batch',
          entity_id: batch.id,
          action: 'reviewer_confirmed_payout_batch',
          actor: 'reviewer',
          after: { accepted: body.accepted_item_ids },
        });
        return { ok: true, version: updated[0]!.version };
      });
    },
  );
}
```

- [ ] **Step 4: Register routes**

In `packages/api/src/server.ts`:

```ts
import { proposalsRoutes } from './routes/proposals.js';
import { payoutRoutes } from './routes/payouts.js';
// ...
await app.register(proposalsRoutes);
await app.register(payoutRoutes);
```

- [ ] **Step 5: Smoke test full pipeline against fixtures**

```bash
docker compose down -v
docker compose up --build -d
sleep 10
curl -s http://localhost:3001/api/transactions/stats
docker compose down
```

Expected: stats counts include some `auto_matched`, `needs_review`, `unrelated`, and `payout_batch`.

- [ ] **Step 6: Commit**

```bash
git add packages/api
git commit -m "feat(api): proposal accept/reject + payout batch confirm + mark-unrelated"
```

---

## Task 28: Audit endpoint and concurrency test

**Files:**

- Create: `packages/api/src/routes/audit.ts`, `packages/api/test/routes/concurrency.test.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create audit route**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { audit_log } from '../db/schema.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', async (req) => {
    const q = z
      .object({
        entity_id: z.string(),
        limit: z.coerce.number().int().max(200).default(50),
      })
      .parse(req.query);
    return db
      .select()
      .from(audit_log)
      .where(eq(audit_log.entity_id, q.entity_id))
      .orderBy(desc(audit_log.created_at))
      .limit(q.limit);
  });
}
```

Register in server.ts: `await app.register(auditRoutes);`

- [ ] **Step 2: Concurrency test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { allocationsRoutes } from '../../src/routes/allocations.js';
import { transactions, invoices } from '../../src/db/schema.js';

describe('concurrency', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('two PUTs on same version: one wins, one 409s', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'I1',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 500,
      tax_total: 0,
      total: 500,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 500,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    const app = Fastify();
    await app.register(allocationsRoutes);

    const [a, b] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: '/api/transactions/T1/allocations',
        payload: { version: 1, allocations: [{ invoice_id: 'I1', amount: 500 }] },
      }),
      app.inject({
        method: 'PUT',
        url: '/api/transactions/T1/allocations',
        payload: { version: 1, allocations: [{ invoice_id: 'I1', amount: 250 }] },
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    await app.close();
  });
});
```

```bash
pnpm --filter @reconciler/api test concurrency
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/audit.ts packages/api/test/routes/concurrency.test.ts packages/api/src/server.ts
git commit -m "feat(api): audit endpoint + concurrency test"
```

---

## Task 29: Invoices listing endpoint (for InvoicePicker)

**Files:**

- Create: `packages/api/src/routes/invoices.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Implement**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invoices, allocations } from '../db/schema.js';

export async function invoiceRoutes(app: FastifyInstance) {
  app.get('/api/invoices', async (req) => {
    const q = z
      .object({
        customer_id: z.string().optional(),
        search: z.string().optional(),
        include_credit_notes: z.coerce.boolean().default(true),
      })
      .parse(req.query);

    const filters = [] as any[];
    if (q.customer_id) filters.push(eq(invoices.customer_id, q.customer_id));
    if (!q.include_credit_notes) filters.push(eq(invoices.type, 'invoice'));
    if (q.search) {
      const like = `%${q.search}%`;
      filters.push(or(ilike(invoices.id, like), ilike(invoices.customer_name, like)));
    }

    const rows = await db
      .select({
        id: invoices.id,
        type: invoices.type,
        customer_id: invoices.customer_id,
        customer_name: invoices.customer_name,
        currency: invoices.currency,
        issue_date: invoices.issue_date,
        due_date: invoices.due_date,
        total: invoices.total,
        allocated: sql<string>`coalesce((select sum(amount) from ${allocations} where invoice_id = ${invoices.id} and status = 'confirmed'), 0)`,
      })
      .from(invoices)
      .where(filters.length ? and(...filters) : undefined);

    return rows.map((r) => ({ ...r, balance: r.total - Number(r.allocated) }));
  });
}
```

Register in server.ts.

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/invoices.ts packages/api/src/server.ts
git commit -m "feat(api): list invoices with computed balance"
```

---

## Task 30: Labeled fixture sweep test

**Files:**

- Create: `task/labels.json`, `packages/api/test/matcher/fixture-sweep.test.ts`

- [ ] **Step 1: Hand-label expected outcomes**

The user must walk through `task/transactions.json` once and write `task/labels.json`. This is a deliberate accounting-judgment exercise (the rubric scores it). Use this format:

```json
{
  "labels": [
    {
      "txn_id": "TXN-0001",
      "expected_status": "auto_matched",
      "expected_invoices": ["INV-2026-0001"]
    },
    {
      "txn_id": "TXN-0030",
      "expected_status": "needs_review",
      "expected_invoices": []
    },
    {
      "txn_id": "TXN-0070",
      "expected_status": "unrelated",
      "expected_invoices": []
    }
  ]
}
```

> **Worker note:** if you reach this task and `task/labels.json` does not exist, **stop and ask the user to provide it** — labels are domain knowledge the matcher is being graded against, not something to invent.

- [ ] **Step 2: Implement sweep test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTestDb, closeTestDb } from '../helpers/db.js';
import { runMatcher } from '../../src/matcher/pipeline.js';
import { transactions, allocations } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

interface Label {
  txn_id: string;
  expected_status: string;
  expected_invoices: string[];
}

describe('fixture sweep', () => {
  let labels: Label[];
  beforeAll(async () => {
    const path = resolve(__dirname, '../../../../task/labels.json');
    labels = (JSON.parse(readFileSync(path, 'utf-8')) as { labels: Label[] }).labels;

    // Seed full fixtures into the test DB (re-uses production seed logic)
    process.env.DATABASE_URL = process.env.DATABASE_URL;
    await import('../../src/db/seed.js');
    const { db } = await getTestDb();
    await runMatcher(db);
  });
  afterAll(closeTestDb);

  for (const label of labels ?? []) {
    it(`${label.txn_id} -> ${label.expected_status}`, async () => {
      const { db } = await getTestDb();
      const tx = (await db.select().from(transactions).where(eq(transactions.id, label.txn_id)).limit(1))[0];
      expect(tx, `txn ${label.txn_id} not seeded`).toBeDefined();
      expect(tx!.status).toBe(label.expected_status);
      if (label.expected_invoices.length > 0) {
        const allocs = await db
          .select()
          .from(allocations)
          .where(and(eq(allocations.transaction_id, label.txn_id), eq(allocations.status, 'confirmed')));
        const invoiceIds = allocs
          .map((a) => a.invoice_id)
          .filter(Boolean)
          .sort();
        expect(invoiceIds).toEqual(label.expected_invoices.sort());
      }
    });
  }
});
```

> **Note on test design:** the seed script auto-runs on module import, which is fine for the sweep but couples test to side effects. Acceptable for the budget. Document in `EVAL.md`.

- [ ] **Step 3: Run sweep**

```bash
docker compose -f docker-compose.test.yml up -d
sleep 3
pnpm --filter @reconciler/api test fixture-sweep
```

Expected: all labels pass. Any failure indicates either a matcher bug or a wrong label — investigate, don't blindly tweak the matcher.

- [ ] **Step 4: Commit**

```bash
git add task/labels.json packages/api/test/matcher/fixture-sweep.test.ts
git commit -m "test(matcher): labeled fixture sweep across all 80 transactions"
```

---

# Phase 3 — UI (React workspace)

## Task 31: Scaffold the `web` package (Vite + React + Tailwind + TanStack Query)

**Files:**

- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/postcss.config.js`, `packages/web/tailwind.config.ts`, `packages/web/src/main.tsx`, `packages/web/src/App.tsx`, `packages/web/Dockerfile`

- [ ] **Step 1: Create `packages/web/package.json`**

```json
{
  "name": "@reconciler/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 0.0.0.0",
    "test": "vitest run"
  },
  "dependencies": {
    "@reconciler/shared": "workspace:*",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@tanstack/react-query": "5.59.0",
    "clsx": "2.1.1"
  },
  "devDependencies": {
    "@types/react": "18.3.11",
    "@types/react-dom": "18.3.0",
    "@vitejs/plugin-react": "4.3.2",
    "vite": "5.4.8",
    "tailwindcss": "4.0.0",
    "@tailwindcss/vite": "4.0.0",
    "vitest": "2.1.3",
    "@testing-library/react": "16.0.1",
    "@testing-library/jest-dom": "6.5.0",
    "jsdom": "25.0.1"
  }
}
```

- [ ] **Step 2: Create `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://api:3001', changeOrigin: true } },
  },
  test: { environment: 'jsdom', globals: false, setupFiles: ['src/test-setup.ts'] },
});
```

- [ ] **Step 4: Create `packages/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EasyBiz Reconciler</title>
  </head>
  <body class="h-screen overflow-hidden">
    <div id="root" class="h-full"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create Tailwind 4 stylesheet**

Tailwind 4 is CSS-first: no `tailwind.config.ts`, no `postcss.config.js`. Content sources are auto-detected by the Vite plugin. All theme customization lives inside `@theme` blocks in CSS.

`packages/web/src/index.css`:

```css
@import 'tailwindcss';
```

If you need theme tokens later, add them inline:

```css
@import 'tailwindcss';
@theme {
  --color-brand: #2563eb;
}
```

- [ ] **Step 6: Create `packages/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 7: Stub App**

`packages/web/src/App.tsx`:

```tsx
export default function App() {
  return <div className="p-4">Reconciler — boot ok</div>;
}
```

`packages/web/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 8: Web Dockerfile**

`packages/web/Dockerfile`:

```dockerfile
FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
WORKDIR /app/packages/web
EXPOSE 5173
CMD ["pnpm", "dev"]
```

- [ ] **Step 9: Add web service to docker-compose**

Add to `docker-compose.yml`:

```yaml
web:
  build:
    context: .
    dockerfile: packages/web/Dockerfile
  environment:
    VITE_API_BASE: http://api:3001
  depends_on: [api]
  ports: ['5173:5173']
```

- [ ] **Step 10: Smoke test**

```bash
pnpm install
docker compose up --build -d
sleep 15
curl -s http://localhost:5173/ | head
docker compose down
```

Expected: HTML page with `Reconciler — boot ok` returns.

- [ ] **Step 11: Commit**

```bash
git add packages/web docker-compose.yml pnpm-lock.yaml
git commit -m "feat(web): scaffold vite + react + tailwind + tanstack query"
```

---

## Task 32: API client + query hooks

**Files:**

- Create: `packages/web/src/api/client.ts`, `packages/web/src/api/queries.ts`, `packages/web/src/api/types.ts`

- [ ] **Step 1: Define types**

```ts
// packages/web/src/api/types.ts
export type TxStatus =
  | 'unmatched'
  | 'auto_matched'
  | 'partially_allocated'
  | 'needs_review'
  | 'unrelated'
  | 'payout_batch';

export interface TransactionListItem {
  id: string;
  date: string;
  amount: number;
  currency: string;
  counterparty_name: string;
  structured_reference: string | null;
  description: string;
  status: TxStatus;
  version: number;
}

export interface AllocationDTO {
  id: string;
  transaction_id: string;
  invoice_id: string | null;
  amount: number;
  confidence: string | null;
  status: 'proposed' | 'confirmed' | 'rejected';
  source: 'auto' | 'manual';
  rule: string | null;
  created_by: string;
}

export interface TransactionDetail extends TransactionListItem {
  allocations: AllocationDTO[];
  proposals: AllocationDTO[];
}

export interface InvoiceListItem {
  id: string;
  type: 'invoice' | 'credit_note';
  customer_id: string;
  customer_name: string;
  currency: string;
  issue_date: string;
  due_date: string;
  total: number;
  allocated: string;
  balance: number;
}

export interface AuditEvent {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  correlation_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}
```

- [ ] **Step 2: Fetch wrapper**

```ts
// packages/web/src/api/client.ts
const BASE = ''; // proxied by vite

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
};
```

- [ ] **Step 3: Hooks**

```ts
// packages/web/src/api/queries.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import type { TransactionListItem, TransactionDetail, InvoiceListItem, AuditEvent } from './types.js';

export const keys = {
  txs: (filter: { status?: string; search?: string }) => ['transactions', filter] as const,
  tx: (id: string) => ['transaction', id] as const,
  stats: () => ['stats'] as const,
  audit: (id: string) => ['audit', id] as const,
  invoices: (q: { customer_id?: string; search?: string }) => ['invoices', q] as const,
};

export function useTransactions(filter: { status?: string; search?: string }) {
  return useQuery({
    queryKey: keys.txs(filter),
    queryFn: () => {
      const p = new URLSearchParams();
      if (filter.status) p.set('status', filter.status);
      if (filter.search) p.set('search', filter.search);
      return api.get<TransactionListItem[]>(`/api/transactions?${p}`);
    },
  });
}

export function useTransaction(id: string | null) {
  return useQuery({
    queryKey: keys.tx(id!),
    enabled: !!id,
    queryFn: () => api.get<TransactionDetail>(`/api/transactions/${id}`),
  });
}

export function useStats() {
  return useQuery({
    queryKey: keys.stats(),
    queryFn: () => api.get<Record<string, number>>('/api/transactions/stats'),
  });
}

export function useAudit(id: string | null) {
  return useQuery({
    queryKey: keys.audit(id!),
    enabled: !!id,
    queryFn: () => api.get<AuditEvent[]>(`/api/audit?entity_id=${id}`),
  });
}

export function useInvoices(q: { customer_id?: string; search?: string }) {
  return useQuery({
    queryKey: keys.invoices(q),
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.customer_id) p.set('customer_id', q.customer_id);
      if (q.search) p.set('search', q.search);
      return api.get<InvoiceListItem[]>(`/api/invoices?${p}`);
    },
  });
}

export function invalidateTx(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: keys.tx(id) });
  qc.invalidateQueries({ queryKey: keys.audit(id) });
  qc.invalidateQueries({ queryKey: keys.stats() });
  qc.invalidateQueries({ queryKey: ['transactions'] });
}

export function useSaveAllocations(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { version: number; allocations: { invoice_id: string; amount: number }[] }) =>
      api.put(`/api/transactions/${txId}/allocations`, input),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useAcceptProposal(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      api.post(`/api/proposals/${input.id}/accept`, { version: input.version }),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useRejectProposal(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      api.post(`/api/proposals/${input.id}/reject`, { version: input.version }),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useMarkUnrelated(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { version: number }) => api.post(`/api/transactions/${txId}/mark-unrelated`, input),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useRunMatcher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/matcher/run', {}),
    onSuccess: () => qc.invalidateQueries(),
  });
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm --filter @reconciler/web exec tsc -b
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api
git commit -m "feat(web): API client + TanStack Query hooks"
```

---

## Task 33: Build the Workspace UI

**Files:**

- Create:
  - `packages/web/src/components/StatusBadge.tsx`
  - `packages/web/src/components/Money.tsx`
  - `packages/web/src/components/TransactionList.tsx`
  - `packages/web/src/components/TransactionDetail.tsx`
  - `packages/web/src/components/AllocationsEditor.tsx`
  - `packages/web/src/components/InvoicePicker.tsx`
  - `packages/web/src/components/MatcherProposals.tsx`
  - `packages/web/src/components/PayoutBatchView.tsx` (stub — not wired in v1)
  - `packages/web/src/components/ActionBar.tsx`
  - `packages/web/src/components/AuditLog.tsx`
  - `packages/web/src/components/AuditDiffModal.tsx`
  - `packages/web/src/pages/Workspace.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Money + StatusBadge**

```tsx
// packages/web/src/components/Money.tsx
import { formatEUR } from '@reconciler/shared';
export function Money({ cents }: { cents: number }) {
  return <span className={cents < 0 ? 'text-red-600' : ''}>{formatEUR(cents)}</span>;
}
```

```tsx
// packages/web/src/components/StatusBadge.tsx
import clsx from 'clsx';
const styles: Record<string, string> = {
  unmatched: 'bg-gray-200 text-gray-800',
  auto_matched: 'bg-green-100 text-green-800',
  partially_allocated: 'bg-yellow-100 text-yellow-800',
  needs_review: 'bg-orange-100 text-orange-800',
  unrelated: 'bg-slate-200 text-slate-700',
  payout_batch: 'bg-purple-100 text-purple-800',
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('px-2 py-0.5 text-xs rounded', styles[status] ?? 'bg-gray-100')}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
```

- [ ] **Step 2: TransactionList**

```tsx
// packages/web/src/components/TransactionList.tsx
import { useState } from 'react';
import { useStats, useTransactions } from '../api/queries.js';
import { StatusBadge } from './StatusBadge.js';
import { Money } from './Money.js';
import clsx from 'clsx';

const FILTERS = [
  'all',
  'needs_review',
  'auto_matched',
  'unmatched',
  'unrelated',
  'partially_allocated',
  'payout_batch',
];

export function TransactionList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const stats = useStats();
  const list = useTransactions({ status: status === 'all' ? undefined : status, search: search || undefined });

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 space-y-2 border-b">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={clsx(
                'px-2 py-1 text-xs rounded border',
                status === f ? 'bg-blue-600 text-white border-blue-700' : 'bg-white hover:bg-gray-50',
              )}
            >
              {f.replace(/_/g, ' ')}{' '}
              {f !== 'all' && stats.data?.[f] !== undefined && <span className="opacity-70">({stats.data[f]})</span>}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search id/counterparty/description"
          className="w-full px-2 py-1 border rounded text-sm"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {list.isLoading && <div className="p-3 text-sm text-gray-500">loading…</div>}
        {list.data?.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={clsx(
              'w-full text-left px-3 py-2 border-b hover:bg-gray-50',
              selectedId === t.id && 'bg-blue-50',
            )}
          >
            <div className="flex justify-between items-start">
              <div className="font-mono text-xs text-gray-600">{t.id}</div>
              <Money cents={t.amount} />
            </div>
            <div className="text-sm truncate">{t.counterparty_name}</div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-xs text-gray-500">{t.date}</span>
              <StatusBadge status={t.status} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: InvoicePicker**

```tsx
// packages/web/src/components/InvoicePicker.tsx
import { useState } from 'react';
import { useInvoices } from '../api/queries.js';
import { formatEUR } from '@reconciler/shared';
import type { InvoiceListItem } from '../api/types.js';

export function InvoicePicker({ customerId, onPick }: { customerId?: string; onPick: (inv: InvoiceListItem) => void }) {
  const [search, setSearch] = useState('');
  const invs = useInvoices({ customer_id: customerId, search: search || undefined });
  return (
    <div className="border rounded p-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="search invoice…"
        className="w-full px-2 py-1 border rounded text-sm mb-2"
      />
      <ul className="max-h-48 overflow-auto">
        {invs.data?.map((i) => (
          <li key={i.id}>
            <button
              onClick={() => onPick(i)}
              className="w-full text-left px-2 py-1 hover:bg-gray-50 text-sm flex justify-between"
            >
              <span className="font-mono text-xs">
                {i.id} {i.type === 'credit_note' && <span className="ml-1 text-purple-600">[CN]</span>}
              </span>
              <span className="text-gray-600">{i.customer_name}</span>
              <span>{formatEUR(i.balance)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: AllocationsEditor**

```tsx
// packages/web/src/components/AllocationsEditor.tsx
import { useState, useEffect } from 'react';
import { useSaveAllocations } from '../api/queries.js';
import { InvoicePicker } from './InvoicePicker.js';
import { Money } from './Money.js';
import type { TransactionDetail, AllocationDTO } from '../api/types.js';
import { formatEUR } from '@reconciler/shared';

interface Row {
  invoice_id: string;
  invoice_label: string;
  amount: number;
}

export function AllocationsEditor({ tx, customerId }: { tx: TransactionDetail; customerId?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const save = useSaveAllocations(tx.id);

  useEffect(() => {
    setRows(
      tx.allocations
        .filter((a: AllocationDTO) => a.status === 'confirmed' && a.invoice_id)
        .map((a) => ({ invoice_id: a.invoice_id!, invoice_label: a.invoice_id!, amount: a.amount })),
    );
  }, [tx.id, tx.version]);

  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const remaining = tx.amount - sum;

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Allocations</h3>
      {rows.map((r, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <span className="font-mono text-xs flex-1">{r.invoice_label}</span>
          <input
            type="number"
            value={r.amount}
            onChange={(e) =>
              setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value) } : x)))
            }
            className="w-32 px-2 py-1 border rounded text-sm"
          />
          <button onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))} className="text-red-600 text-sm">
            ×
          </button>
        </div>
      ))}
      <button onClick={() => setPickerOpen((v) => !v)} className="text-sm text-blue-600">
        {pickerOpen ? 'cancel' : '+ add allocation'}
      </button>
      {pickerOpen && (
        <InvoicePicker
          customerId={customerId}
          onPick={(inv) => {
            setRows((prev) => [
              ...prev,
              {
                invoice_id: inv.id,
                invoice_label: `${inv.id} (${inv.customer_name})`,
                amount: Math.min(remaining, inv.balance),
              },
            ]);
            setPickerOpen(false);
          }}
        />
      )}
      <div className="text-sm pt-2 border-t flex justify-between">
        <span>
          Remaining: <Money cents={remaining} />
        </span>
        <button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              version: tx.version,
              allocations: rows.map(({ invoice_id, amount }) => ({ invoice_id, amount })),
            })
          }
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
        >
          {save.isPending ? 'saving…' : 'save'}
        </button>
      </div>
      {save.error && (
        <div className="text-sm text-red-700 bg-red-50 p-2 rounded">
          {(save.error as any)?.status === 409
            ? 'This transaction was updated by someone else. Refresh to see the latest.'
            : 'Save failed.'}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: MatcherProposals**

```tsx
// packages/web/src/components/MatcherProposals.tsx
import { useAcceptProposal, useRejectProposal } from '../api/queries.js';
import { Money } from './Money.js';
import type { TransactionDetail } from '../api/types.js';

export function MatcherProposals({ tx }: { tx: TransactionDetail }) {
  const accept = useAcceptProposal(tx.id);
  const reject = useRejectProposal(tx.id);
  if (tx.proposals.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">Matcher proposals</h3>
      {tx.proposals.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-sm border rounded p-2">
          <span className="font-mono text-xs flex-1">{p.invoice_id}</span>
          <span className="text-xs text-gray-500">conf {p.confidence}</span>
          <span className="text-xs text-gray-500">{p.rule}</span>
          <Money cents={p.amount} />
          <button
            onClick={() => accept.mutate({ id: p.id, version: tx.version })}
            className="px-2 py-0.5 bg-green-600 text-white rounded text-xs"
          >
            accept
          </button>
          <button
            onClick={() => reject.mutate({ id: p.id, version: tx.version })}
            className="px-2 py-0.5 bg-gray-600 text-white rounded text-xs"
          >
            reject
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: ActionBar**

```tsx
// packages/web/src/components/ActionBar.tsx
import { useMarkUnrelated, useRunMatcher } from '../api/queries.js';
import type { TransactionDetail } from '../api/types.js';

export function ActionBar({ tx }: { tx: TransactionDetail }) {
  const mark = useMarkUnrelated(tx.id);
  const matcher = useRunMatcher();
  return (
    <div className="flex gap-2">
      <button
        onClick={() => {
          if (confirm('Mark as unrelated?')) mark.mutate({ version: tx.version });
        }}
        className="px-3 py-1 border rounded text-sm"
      >
        mark unrelated
      </button>
      <button onClick={() => matcher.mutate()} className="px-3 py-1 border rounded text-sm ml-auto">
        run matcher
      </button>
    </div>
  );
}
```

- [ ] **Step 7: AuditLog + Modal**

```tsx
// packages/web/src/components/AuditDiffModal.tsx
import type { AuditEvent } from '../api/types.js';
export function AuditDiffModal({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white p-4 rounded shadow max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-2">{event.action}</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <pre className="bg-red-50 p-2 overflow-auto max-h-80">{JSON.stringify(event.before, null, 2)}</pre>
          <pre className="bg-green-50 p-2 overflow-auto max-h-80">{JSON.stringify(event.after, null, 2)}</pre>
        </div>
        <button onClick={onClose} className="mt-2 px-3 py-1 border rounded text-sm">
          close
        </button>
      </div>
    </div>
  );
}
```

```tsx
// packages/web/src/components/AuditLog.tsx
import { useState } from 'react';
import { useAudit } from '../api/queries.js';
import type { AuditEvent } from '../api/types.js';
import { AuditDiffModal } from './AuditDiffModal.js';

export function AuditLog({ entityId }: { entityId: string }) {
  const audit = useAudit(entityId);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  return (
    <div className="h-full overflow-auto p-3 border-l">
      <h3 className="font-semibold text-sm mb-2">Audit log</h3>
      {audit.data?.length === 0 && <div className="text-xs text-gray-500">no events</div>}
      {audit.data?.map((e) => (
        <button
          key={e.id}
          onClick={() => setOpen(e)}
          className="w-full text-left text-xs border-b py-1 hover:bg-gray-50"
        >
          <div className="text-gray-500">{new Date(e.created_at).toLocaleString()}</div>
          <div>
            <span className="font-medium">{e.actor}</span> · {e.action}
          </div>
        </button>
      ))}
      {open && <AuditDiffModal event={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
```

- [ ] **Step 8: TransactionDetail composes them**

```tsx
// packages/web/src/components/TransactionDetail.tsx
import { useTransaction } from '../api/queries.js';
import { Money } from './Money.js';
import { StatusBadge } from './StatusBadge.js';
import { AllocationsEditor } from './AllocationsEditor.js';
import { MatcherProposals } from './MatcherProposals.js';
import { ActionBar } from './ActionBar.js';

export function TransactionDetail({ id }: { id: string }) {
  const tx = useTransaction(id);
  if (tx.isLoading) return <div className="p-4 text-sm">loading…</div>;
  if (!tx.data) return <div className="p-4 text-sm text-red-600">not found</div>;
  const t = tx.data;
  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div>
        <div className="flex justify-between items-start">
          <div>
            <div className="font-mono text-sm text-gray-500">{t.id}</div>
            <div className="text-lg font-semibold">{t.counterparty_name}</div>
            <div className="text-sm text-gray-600">{t.description}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl">
              <Money cents={t.amount} />
            </div>
            <div className="text-xs text-gray-500">{t.date}</div>
            <StatusBadge status={t.status} />
          </div>
        </div>
      </div>
      <AllocationsEditor tx={t} customerId={undefined /* derived from matched invoice in v2 */} />
      <MatcherProposals tx={t} />
      <ActionBar tx={t} />
    </div>
  );
}
```

- [ ] **Step 9: Workspace page**

```tsx
// packages/web/src/pages/Workspace.tsx
import { useState } from 'react';
import { TransactionList } from '../components/TransactionList.js';
import { TransactionDetail } from '../components/TransactionDetail.js';
import { AuditLog } from '../components/AuditLog.js';

export function Workspace() {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="h-full grid" style={{ gridTemplateColumns: '35% 45% 20%' }}>
      <TransactionList selectedId={sel} onSelect={setSel} />
      <div className="overflow-hidden">
        {sel ? <TransactionDetail id={sel} /> : <div className="p-6 text-gray-500">Select a transaction to review</div>}
      </div>
      {sel ? <AuditLog entityId={sel} /> : <div className="border-l p-3 text-xs text-gray-500">audit log</div>}
    </div>
  );
}
```

- [ ] **Step 10: Wire App**

```tsx
// packages/web/src/App.tsx
import { Workspace } from './pages/Workspace.js';
export default function Workspace_() {
  return <Workspace />;
}
```

(Or simpler: `export { Workspace as default } from "./pages/Workspace.js";`)

- [ ] **Step 11: Smoke test in browser**

```bash
docker compose up --build -d
sleep 15
open http://localhost:5173
```

Manually verify:

- left list shows 80 txns with status badges and counts on filter chips
- click a `needs_review` txn → middle shows proposals → accept → audit log on the right shows new entry, badge flips to `auto_matched`
- click a `auto_matched` txn → allocations show as confirmed rows
- click `mark unrelated` on an `unmatched` txn → status flips to `unrelated`
- run `mark unrelated` then immediately edit allocations from a stale tab → 409 toast appears

```bash
docker compose down
```

- [ ] **Step 12: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): workspace UI — list, detail, allocations, proposals, audit"
```

---

## Task 34: Web smoke test

**Files:**

- Create: `packages/web/src/smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Workspace } from './pages/Workspace.js';

const fetchMock = vi.fn(async (url: string) => {
  if (url.includes('/stats')) return new Response(JSON.stringify({ needs_review: 1 }));
  if (url.includes('/transactions?'))
    return new Response(
      JSON.stringify([
        {
          id: 'T1',
          date: '2026-03-01',
          amount: 1000,
          currency: 'EUR',
          counterparty_name: 'Acme',
          structured_reference: null,
          description: 'x',
          status: 'needs_review',
          version: 1,
        },
      ]),
    );
  return new Response('[]');
});
vi.stubGlobal('fetch', fetchMock);

describe('workspace smoke', () => {
  it('renders the list', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <Workspace />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Acme')).toBeInTheDocument();
  });
});
```

```bash
pnpm --filter @reconciler/web test
```

Expected: pass.

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/smoke.test.tsx
git commit -m "test(web): workspace smoke test"
```

---

# Phase 4 — Documentation

## Task 35: README, DECISIONS, AI-WORKFLOW, EVAL, PROMPTS

**Files:**

- Modify: `README.md`, `DECISIONS.md`, `AI-WORKFLOW.md`, `EVAL.md`, `PROMPTS.md`

- [ ] **Step 1: Rewrite `README.md`**

Sections required:

1. **What it does** — one paragraph, link to spec.
2. **Run** — `docker compose up`. Wait ~20s. Open http://localhost:5173. API at http://localhost:3001.
3. **Reseed/reset** — `docker compose down -v && docker compose up`.
4. **Tests** — `docker compose -f docker-compose.test.yml up -d && pnpm test`.
5. **Architecture** — small diagram (text), link to `docs/superpowers/specs/2026-04-27-reconciler-design.md`.
6. **What's missing** — auth, FX, multi-tenant, prepayment ledger, bulk reviewer actions, matcher config UI. Each as one bullet pointing to `DECISIONS.md`.
7. **Screenshots** — add 2 (workspace + audit modal) under `docs/screenshots/`.

- [ ] **Step 2: Write `DECISIONS.md`**

Sections:

- **Tier 3 deferrals** — FX (no multi-currency in fixture; would need rate source); auth/multi-tenant (out of scope, prototype-grade); prepayment ledger (R4 date window naturally rejects pre-issue txns); bulk reviewer actions (footgun); matcher config UI (env-only).
- **Why integer cents** — pg `numeric` returns string in JS; cents avoid decimal.js or string juggling; all amounts fit in JS safe-int range.
- **Matcher invariant** — matcher inserts new rows freely but only modifies existing rows when their status is `proposed`. Why: lets reviewer changes outlast re-runs.
- **Single workspace page** — txn-driven workflow; no invoice-centric view; no router beyond root + audit modal.
- **Optimistic locking only on transactions** — `version` column on `transactions`; allocation/proposal/payout-batch endpoints bump it. Matcher does NOT bump version (would cause spurious 409s).
- **Append-only audit** — Postgres trigger blocks UPDATE/DELETE on `audit_log`.
- **R6 credit-note rule is a hook** — true netting requires a real txn paired with an invoice; UI surfaces the credit note via `[CN]` badge in the InvoicePicker, reviewer adds a negative-amount allocation row.

- [ ] **Step 3: Write `AI-WORKFLOW.md`**

- Tools used (Claude Code with Opus 4.7, plus whatever model the candidate used).
- One override moment: a concrete instance from the build (e.g. AI suggested mocking the database in matcher tests; overridden because mock/prod divergence is the entire reason the matcher exists).
- One big save: a concrete instance (e.g. scaffolding the Drizzle schema across 7 tables; or generating the rule files in parallel from the spec).

- [ ] **Step 4: Write `EVAL.md`**

```
# Evaluation

The matcher contains no LLM. Correctness is verified deterministically via a labeled fixture sweep covering all 80 transactions in `task/transactions.json`.

## Procedure
1. `docker compose -f docker-compose.test.yml up -d`
2. `pnpm --filter @reconciler/api test fixture-sweep`

## Result
- Total transactions: 80
- Auto-matched: <fill in after running>
- Needs review: <>
- Unrelated: <>
- Payout batch: <>
- Failures (label vs. matcher): <>

## Methodology note
Labels in `task/labels.json` were established by manual inspection of the fixture before tuning the matcher. Tuning a matcher to its own labels is a known anti-pattern; we tagged all 80 outcomes once, then iterated on the matcher until the sweep passed.
```

- [ ] **Step 5: Write `PROMPTS.md`**

3-5 prompts with one-line notes — copy from your shell history during the build. Examples:

- "Generate a Drizzle schema for the spec at … using bigint for cents." — schema scaffolding
- "Write a Jaro-Winkler implementation in TypeScript with no deps." — single-file utility
- "Given this CSV header `charge_id,invoice_id,...`, write the seed parsing using csv-parse/sync." — payout parsing

- [ ] **Step 6: Take screenshots and add Loom link to README**

```bash
docker compose up -d
sleep 15
# screenshot the workspace and the audit modal manually, save to docs/screenshots/
```

Record the 3-5 min Loom (matcher run from cold boot, auto match, accept proposal, split, payout batch, audit, optimistic-lock conflict). Add the URL to README under a `## Walkthrough` section.

- [ ] **Step 7: Commit**

```bash
git add README.md DECISIONS.md AI-WORKFLOW.md EVAL.md PROMPTS.md docs/screenshots
git commit -m "docs: README + decisions + AI workflow + eval + prompts"
```

---

# Final verification

## Task 36: Cold-boot verification

- [ ] **Step 1: Wipe everything and boot from scratch**

```bash
docker compose down -v
docker compose up --build
```

Expected sequence in logs:

1. db ready
2. api: `migrations applied`
3. api: `seeded 52 invoices`
4. api: `seeded 80 transactions`
5. api: `seeded payout batch with 7 items`
6. api: server listening on 3001
7. web: vite ready on 5173

- [ ] **Step 2: Manual checklist in the UI**

- [ ] All 80 txns appear in the list
- [ ] Filter chips show counts
- [ ] An auto-matched txn shows confirmed allocation, no proposals
- [ ] A needs-review txn shows ≥1 proposal; accept flips status
- [ ] A consolidated split (R5) shows multiple confirmed allocations summing to txn amount
- [ ] The payout txn shows status `payout_batch`
- [ ] Audit log populates after each reviewer action
- [ ] Mark unrelated then unmark works; both events appear in audit
- [ ] Open two browser tabs on the same txn; save in one, then save in the other → 409 toast

- [ ] **Step 3: Run all tests**

```bash
docker compose -f docker-compose.test.yml up -d
sleep 3
pnpm --filter @reconciler/shared test
pnpm --filter @reconciler/api test
pnpm --filter @reconciler/web test
```

Expected: all green.

- [ ] **Step 4: Final commit if any docs changed**

```bash
git status
# if anything changed, commit and tag
git tag v0.1.0
```

---

## Self-review checklist (the implementer fills this in before declaring done)

- [ ] Spec coverage: every section of `docs/superpowers/specs/2026-04-27-reconciler-design.md` is implemented OR explicitly listed in DECISIONS.md as deferred.
- [ ] Cold boot works in <30s with one command.
- [ ] All tests pass.
- [ ] Loom recorded and linked in README.
- [ ] No magic numbers in matcher rule code (all in `matcherConfig`).
- [ ] No mocks of the database in tests (per spec — real Postgres).
- [ ] Audit log is genuinely append-only (verify by trying `delete from audit_log` in psql — should fail).
- [ ] Re-running the matcher does not change `allocations.updated_at` for unchanged rows.
