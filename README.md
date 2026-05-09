# Easy Reconciler

A deterministic invoice ↔ bank-transaction reconciliation tool for a Luxembourg SME. Bank transactions are matched against open invoices through an 8-rule pipeline (R1–R8: exact reference → description reference → fuzzy reference → name+amount+date → subset-sum → credit-note hook → payout batch link → noise classifier). A reviewer workspace surfaces proposed matches for confirmation, partial allocation, and manual override. All matching decisions are preserved in an append-only audit log.

## Run

```bash
docker compose up --build
```

Wait ~20 seconds for Postgres to initialise and seed. Then open:

- UI: http://localhost:5173
- API: http://localhost:3001/api

## Reseed / reset

```bash
docker compose down -v && docker compose up --build
```

## Tests

```bash
./bin/test
```

Runs all packages (`@reconciler/api` — 43 integration tests including the 80-transaction fixture sweep, `@reconciler/web` — 1 smoke test).

## Architecture

```
┌──────────────────────────────────────────────┐
│  packages/web  (React 18 + Vite + Tailwind 4)│
│  Single-page 3-column workspace              │
│  list | detail | audit                       │
└────────────────────┬─────────────────────────┘
                     │ HTTP (TanStack Query 5)
┌────────────────────▼─────────────────────────┐
│  packages/api  (Fastify 5 + Drizzle ORM)     │
│  REST endpoints + matcher pipeline (R1–R8)   │
└────────────────────┬─────────────────────────┘
                     │ SQL
┌────────────────────▼─────────────────────────┐
│  Postgres 18 (Docker)                        │
│  append-only audit_log enforced by trigger   │
└──────────────────────────────────────────────┘

packages/shared — Zod schemas + money helpers (shared by api + web)
```

Full design spec: [`docs/superpowers/specs/2026-04-27-reconciler-design.md`](docs/superpowers/specs/2026-04-27-reconciler-design.md)

## What's missing

- **Auth / multi-tenant** — single-tenant prototype; see [DECISIONS.md](DECISIONS.md)
- **FX / multi-currency** — fixture is single-currency; would need an exchange-rate source; see [DECISIONS.md](DECISIONS.md)
- **Prepayment ledger** — R4 date-window naturally rejects pre-issue transactions; full prepayment credit flow deferred; see [DECISIONS.md](DECISIONS.md)
- **Bulk reviewer actions** — footgun risk on a shared workspace; deferred; see [DECISIONS.md](DECISIONS.md)
- **Matcher config UI** — rule parameters (fuzzy threshold, date window, noise keywords) are env-only for now; see [DECISIONS.md](DECISIONS.md)

## Walkthrough

https://www.loom.com/share/a97387f46bde4c9f9cc2376968f839ee
