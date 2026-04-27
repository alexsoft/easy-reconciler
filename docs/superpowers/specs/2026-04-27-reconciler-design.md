# Invoice ↔ Transaction Reconciler — Design Spec

Date: 2026-04-27
Status: approved, ready for implementation planning

## Goal

Build a reconciliation tool that matches the 80 bank transactions in `task/transactions.json` against the 52 invoices/credit notes in `task/invoices.json`, parses the Stripe-style `task/payout_report.csv`, auto-closes confidently matched transactions, and routes the rest to a review UI where a human can split, partially allocate, attach credit notes, or mark as unrelated — with an audit trail.

Stack: Fastify + Drizzle + Postgres 18 + React + TanStack Query + Vite, TypeScript end-to-end, pnpm workspaces, runnable via `docker compose up`.

## Scope decisions

### Edge case triage (three runtime behaviors)

**Auto-close** (matcher writes a confirmed allocation, reviewer never sees it unless they look):
1. Exact reference match
2. Fuzzy reference match (garbled refs)
3. Partial payments (allocation < invoice total → invoice stays `partially_paid`)
4. Over/underpayment within tolerance
5. Credit-note netting against an open invoice
6. Consolidated payments (subset-sum across one customer's open invoices)
7. Duplicate re-imports (idempotent dedup hash)
8. Unrelated noise (salary/rent/fees → classified as non-AR, no match attempted)

**Parse, but always route to review** (system understands the case but a human confirms):
9. Stripe-style payouts — parsed into a payout batch with per-charge proposed allocations; the one matching transaction is linked to the batch.
10. Prepayments (txn before invoice issue date) — flagged but not auto-matched.

**Deferred** (documented in DECISIONS.md, no code):
- True FX drift (multi-currency conversion). Fixture is EUR-only; would require an FX rate source.
- Auth, multi-tenant, real bank-feed sync, email notifications, invoice-centric view, bulk reviewer actions, matcher config UI, prepayment ledger replay.

### LLM in the matcher

No. Purely deterministic rules. AI is used as a development tool only (captured in `AI-WORKFLOW.md` and `PROMPTS.md`). Correctness is verified via a labeled fixture (`task/labels.json`) covering all 80 transactions — `EVAL.md` documents the run results.

## Architecture

### Repo layout

```
easy-reconciler/
  docker-compose.yml          # postgres + api + web
  package.json                # root pnpm workspace
  packages/
    shared/                   # zod schemas + shared types
    api/
      src/
        db/{schema.ts,migrate.ts,seed.ts}
        matcher/{pipeline.ts, config.ts, rules/*.ts, score.ts}
        routes/{transactions.ts, invoices.ts, allocations.ts, audit.ts, matcher.ts, payouts.ts}
        server.ts
    web/
      src/{App.tsx, pages/Workspace.tsx, components/*, api/client.ts}
  task/                       # original fixtures, untouched
  docs/                       # this spec lives here
```

### One-command boot

`docker compose up`. The `api` container's entrypoint:
1. Wait for Postgres.
2. Run Drizzle migrations.
3. Idempotent seed from `task/invoices.json`, `task/transactions.json`, `task/payout_report.csv` (upserts by source `id` / dedup hash).
4. Run matcher once so the UI has data on first load.
5. Start Fastify.

Re-running `docker compose up` is safe — every step is idempotent.

### Out of scope (recap)

Auth, multi-tenant, real bank-feed sync, FX conversion, email/notifications, invoice-centric view, bulk actions, matcher config UI.

## Data model

All tables: `id` text PK from source data where available (cuid otherwise). Money stored as **integer cents** in `bigint` columns (Drizzle `bigint('amount', { mode: 'number' })`). Postgres `numeric` returns strings in JS; cents avoids that and stays exact within JS `Number` precision. Timestamps `timestamptz default now()`.

### `invoices`
- `id` text PK (e.g. `INV-2026-0001`)
- `type` text — `'invoice' | 'credit_note'`
- `customer_id`, `customer_name`, `customer_vat` text
- `issue_date`, `due_date` date
- `currency` text (3-char)
- `subtotal`, `tax_total`, `total` bigint (cents)
- `created_at`, `updated_at`
- Status (`open | partially_paid | paid | overpaid`) is **derived** from allocations in the query layer, not stored.

### `invoice_lines`
- `id` text PK (`INV-…-L1`)
- `invoice_id` text FK
- `description` text
- `quantity` int
- `unit_price`, `amount` bigint (cents)
- `tax_rate` numeric(5,4)  — a rate, not money

### `transactions`
- `id` text PK (`TXN-0001`)
- `date` date
- `amount` bigint (cents, signed; positive = inbound)
- `currency` text
- `counterparty_name` text
- `structured_reference` text nullable
- `description` text
- `dedup_hash` text — `sha256(date|amount|counterparty_name|description)`, **unique index** → guarantees re-import idempotency
- `status` text — `'unmatched' | 'auto_matched' | 'partially_allocated' | 'needs_review' | 'unrelated' | 'payout_batch'`
- `version` int default 1 — optimistic-lock token
- `created_at`, `updated_at`

### `allocations` (heart of the system)
- `id` cuid PK
- `transaction_id` text FK
- `invoice_id` text FK (nullable only for non-AR payout fees recorded for accounting completeness)
- `amount` bigint (cents, signed; negative for credit-note netting)
- `confidence` numeric(3,2) — 0.00–1.00
- `status` text — `'proposed' | 'confirmed' | 'rejected'`
- `source` text — `'auto' | 'manual'`
- `rule` text nullable — which matcher rule fired (`exact_ref`, `fuzzy_ref`, `subset_sum`, …)
- `created_by` text — `'matcher' | 'reviewer'`
- `created_at`, `updated_at`
- **Unique index** on `(transaction_id, invoice_id)` where `invoice_id is not null` — keeps matcher upserts idempotent.
- **Matcher invariant:** matcher freely *inserts new* allocation rows (with `proposed` or `confirmed` status, depending on confidence bucket). When a row already exists for the same `(transaction_id, invoice_id)`, matcher only modifies it if its current `status = 'proposed'`. Once a row is `confirmed` or `rejected`, matcher leaves it alone. Enforced in matcher code, asserted in tests.

"Marked unrelated" is **not** an allocation row — it's `transactions.status = 'unrelated'`. Allocations always represent value flowing to an invoice.

### `audit_log` (append-only)
- `id` cuid PK
- `entity_type` text — `'transaction' | 'allocation' | 'payout_batch'`
- `entity_id` text
- `action` text (see Audit section)
- `actor` text — `'matcher' | 'reviewer'`
- `correlation_id` text nullable — groups multi-row reviewer actions
- `before` jsonb nullable, `after` jsonb nullable
- `created_at`
- Index on `(entity_id, created_at desc)`.
- Postgres trigger blocks `UPDATE` and `DELETE` — append-only enforced at the DB level.

### `payout_batches`
- `id` text PK (`po_1NfK2r2026EasyBiz`)
- `transaction_id` text FK — the one txn that funds the batch
- `gross_total`, `fee_total`, `net_total` bigint (cents)
- `status` text — `'needs_review' | 'confirmed'`

### `payout_items`
- `id` text PK (`ch_30NfK`, `rf_A1`, `cb_B1`, …)
- `payout_batch_id` text FK
- `invoice_id` text FK nullable (refunds/chargebacks may not link)
- `customer_name` text
- `gross_amount`, `fee`, `net_amount` bigint (cents)
- `type` text — `'charge' | 'refund' | 'chargeback'`

## Matcher pipeline

`runMatcher(db) → MatcherReport` is a pure function (modulo DB I/O), idempotent, runs as the last step of seed and on `POST /api/matcher/run`. Each rule is a separate file under `src/matcher/rules/` exporting `(ctx) => Proposal[]`. Rules run in order; once a transaction has a `confirmed` allocation OR is `unrelated`, it's skipped.

### Confidence buckets

- `>= autoConfirm (0.95)` → matcher writes the allocation as `status: 'confirmed', source: 'auto'`. Txn moves to `auto_matched` (or `partially_allocated` if amount < invoice balance).
- `>= propose (0.70)` and `< autoConfirm` → `status: 'proposed'`, txn → `needs_review`.
- `< propose` → no proposal written; txn stays `unmatched`.

### Rules (first to score ≥ propose threshold wins for a given txn)

**R1 — Exact structured reference** (conf 1.00)
- `transactions.structured_reference` exact-equals an `invoices.id`, currencies match.
- Amount equals invoice total → confirmed full payment.
- Amount < invoice total within tolerance → confirmed partial.
- Amount > invoice total → confirmed up to invoice total, remainder flagged as overpayment.

**R2 — Reference extracted from description** (conf 0.95)
- Regex `/INV-\d{4}-\d{4}/` against `description`. Same amount logic as R1.

**R3 — Fuzzy reference** (conf 0.85)
- `structured_reference` or `description` contains a token within Levenshtein ≤ `fuzzyRef.maxLevenshtein` of a known invoice id, OR matches the id with separators stripped (`INV20260003` ≈ `INV-2026-0003`). Amount must match within tolerance.

**R4 — Customer name + amount + date window** (conf 0.80)
- Normalize `counterparty_name`: lowercase; strip suffixes `S.à r.l. / SARL / S.A. / SCS / SARL-S`; strip whitespace and punctuation; strip `IBAN LU…` tail.
- Compute Jaro-Winkler similarity vs normalized `invoices.customer_name`. Threshold from config.
- Among customer matches: amount equals an open invoice's balance, date within `[issue_date − daysBeforeIssue, issue_date + daysAfterIssue]`. Single hit → propose; multiple → no proposal.

**R5 — Consolidated payment (subset-sum)** (conf 0.75)
- Same customer match as R4. Find a subset of that customer's open invoices whose balances sum to txn amount within tolerance. Bounded: max `subsetSum.maxInvoices` invoices, max `subsetSum.maxCandidates` candidates. Single subset → propose multi-row allocation. Multiple valid subsets → no proposal.

**R6 — Credit-note netting** (conf 0.80)
- Runs after R1–R5. For each open credit note, find an open invoice for the same customer whose balance equals the credit note total (or matches a remaining gap on a partially-allocated invoice). Propose a negative allocation.

**R7 — Payout batch link** (conf 0.95 on the txn↔batch link only)
- Find the txn whose amount equals payout net total and whose description/counterparty contains `payout` or `stripe`. Link `payout_batches.transaction_id` and set `transactions.status = 'payout_batch'`. The link itself is auto-confirmed (high confidence, low ambiguity).
- Per-charge allocations from the CSV are pre-built and always written as `status: 'proposed'` regardless of confidence — Tier 2 behavior, reviewer confirms the batch via `POST /api/payout-batches/:id/confirm`.
- Refunds and chargebacks have no `invoice_id` link in the CSV; they are surfaced in `PayoutBatchView` as informational rows, not allocations.

**R8 — Non-AR classifier (noise)**
- Keyword rules on `description`/`counterparty_name` from `noiseKeywords` config, OR negative amount with no matching invoice. Sets `transactions.status = 'unrelated'` with `matcher_marked_unrelated` audit row. Reviewer can override.

### Tolerances and prepayments

- Amount equality tolerance: `amountToleranceCents` (rounding drift).
- Overpayment: > `overpayment.pctThreshold` AND > `overpayment.absThresholdCents` → flagged for review; smaller → auto-confirmed with audit note.
- Underpayment: any short payment is treated as a partial; invoice stays `partially_allocated`.
- Prepayments: R4's date window naturally rejects txns before issue date − `daysBeforeIssue`. They stay `unmatched`. DECISIONS.md notes a "prepayment ledger" as the real-world fix.

### Configuration

All thresholds, tolerances, and rule confidences live in `packages/api/src/matcher/config.ts`, loaded from env vars with sensible defaults. No magic numbers in rule code. The resolved config is included in every `MatcherReport` so a run is reproducible from the report alone. Tests construct configs with overrides without touching env.

```ts
matcherConfig = {
  confidence: { autoConfirm, propose },
  amountToleranceCents,
  overpayment: { pctThreshold, absThresholdCents },
  dateWindow: { daysBeforeIssue, daysAfterIssue },
  fuzzyRef: { maxLevenshtein },
  customerName: { jaroWinklerThreshold },
  subsetSum: { maxInvoices, maxCandidates },
  ruleConfidence: { exactRef, descriptionRef, fuzzyRef, nameAmountDate, subsetSum, creditNoteNet, payoutLink },
  noiseKeywords: string[],
}
```

### Idempotency mechanics

- For each (txn, invoice) the matcher writes: upsert on the unique index. If existing row has `status != 'proposed'`, skip (matcher invariant). If `status = 'proposed'`, update only if `confidence/rule/amount` changed (no spurious `updated_at` churn or audit noise).
- Matcher uses `SELECT … FOR UPDATE SKIP LOCKED` per transaction so two concurrent matcher runs don't double-write. Records `matcher_skipped_locked` to audit.
- `MatcherReport` returns per-rule fire counts, auto-confirmed count, proposed count, skipped count.

### What the matcher will NOT do

- Mutate `confirmed` or `rejected` allocations.
- Mark a txn `unrelated` if it already has any allocation.
- Delete allocations.

All destructive moves are reviewer-only.

## Review UI

Single page at `/`. No router beyond it (one route + a modal for audit-log detail). Tailwind for styling. TanStack Query for data; mutations invalidate relevant query keys. Optimistic updates only on cheap actions (status filter, selection); writes wait for server confirmation so version conflicts surface.

### Layout (3 columns, full viewport height)

- **Left (35%) — Transaction list.** Filter chips with counts (`needs review`, `auto matched`, `unmatched`, `unrelated`, `partially allocated`). Search box. Sortable table: date, amount, counterparty, status badge, structured ref. Click selects.
- **Middle (45%) — Transaction detail.** Header (txn fields), `AllocationsEditor`, `MatcherProposals`, `ActionBar`.
- **Right (20%) — Audit log.** Last 50 events for the selected txn. Click expands to before/after diff in a modal.

### Components

- **TransactionList** — `GET /api/transactions?status=&search=`. Filter counts via `GET /api/transactions/stats`.
- **TransactionDetail** — header, editor, proposals, actions.
- **AllocationsEditor** — rows of `(invoice picker, amount input, remove)`. "+ add allocation" appends. Footer shows `txn amount − Σ allocations = remaining`. Save enabled when remaining is within tolerance OR user explicitly chose "save partial". Save calls `PUT /api/transactions/:id/allocations` with the full list and the read `version`; 409 → toast + auto-refetch + a "your changes" dialog the user can re-apply.
- **InvoicePicker** — combobox over `GET /api/invoices?customer_id=&status=open` with debounced search. Defaults customer filter to the txn's matched customer. Credit notes for the same customer appear with a `[CN]` badge; selecting one auto-fills its negative amount.
- **MatcherProposals** — read-only list of `proposed` allocations. Each row has [accept] / [reject]. Hidden if empty.
- **PayoutBatchView** — replaces AllocationsEditor when txn is the payout. Lists charges/refund/chargeback, each with proposed invoice and a checkbox. "Confirm batch" promotes all checked items at once. Fees recorded for accounting completeness without invoice linkage.
- **ActionBar** — `[mark unrelated]` (with confirm), `[run matcher]`.
- **AuditLog** — `GET /api/audit?entity_id=:id&limit=50`.

### Empty/edge states

- No selection → "Select a transaction to review" + matcher run button.
- Txn with zero proposals AND zero allocations → editor opens with one empty row.
- Version conflict → described above.

### TanStack Query keys

- `['transactions', { status, search }]`, `['transaction', id]`, `['allocations', txnId]`, `['proposals', txnId]`, `['audit', txnId]`, `['stats']`, `['invoices', { customerId, status }]`.
- Mutations invalidate `['transaction', id]`, `['allocations', txnId]`, `['stats']`, `['audit', txnId]`.

### Not in the UI (DECISIONS.md)

Invoice-centric view, bulk actions, matcher-config UI, login.

## Audit log

One helper `recordAudit(tx, {...})` called inside the same DB transaction as the change. Never written from the client — API derives `actor` from a request header (hardcoded `reviewer` for now). Postgres trigger blocks UPDATE/DELETE.

### Actions

- Matcher: `matcher_proposed`, `matcher_updated`, `matcher_auto_confirmed`, `matcher_marked_unrelated`, `matcher_skipped_locked`.
- Reviewer: `reviewer_confirmed`, `reviewer_rejected`, `reviewer_split`, `reviewer_edited_allocation`, `reviewer_marked_unrelated`, `reviewer_unmarked_unrelated`, `reviewer_attached_credit_note`, `reviewer_confirmed_payout_batch`.

`before`/`after` are full row jsonb so the modal can diff them. Multi-row changes share a `correlation_id` so the UI can group them.

## Concurrency

- `transactions.version` int is the single optimistic-lock token for all reviewer mutations. Reads return it; writes require it in the request body.
- Every reviewer endpoint that touches *any* state attached to a transaction — `PUT /transactions/:id/allocations`, `mark-unrelated`, `unmark-unrelated`, `proposals/:id/accept`, `proposals/:id/reject`, `payout-batches/:id/confirm` — bumps the parent txn's version inside the same DB transaction:
  `UPDATE transactions SET version = version + 1 WHERE id = $1 AND version = $2 RETURNING version`. Zero rows updated → 409 with current version + entity body. The proposal/payout-batch endpoints look up the parent `transaction_id` from the proposal/batch row and version-check on that.
- Matcher uses `SELECT … FOR UPDATE SKIP LOCKED` per transaction so two concurrent matcher runs don't double-write. Matcher writes do **not** bump `version` — version is for reviewer concurrency only, and bumping it on matcher runs would cause spurious 409s on every UI save after a background re-run.

## API surface

All write endpoints run inside one `db.transaction()` covering the change + version bump + audit insert. No partial states.

- `GET    /api/transactions?status=&search=&cursor=`
- `GET    /api/transactions/stats`
- `GET    /api/transactions/:id` — txn + version + allocations + proposals + payout batch if any
- `PUT    /api/transactions/:id/allocations` — body `{ allocations: [{invoice_id, amount}], version }`, replaces full allocation set
- `POST   /api/transactions/:id/mark-unrelated` — body `{ version }`
- `POST   /api/transactions/:id/unmark-unrelated` — body `{ version }`
- `POST   /api/proposals/:id/accept` — body `{ version }`
- `POST   /api/proposals/:id/reject` — body `{ version }`
- `POST   /api/payout-batches/:id/confirm` — body `{ version, accepted_item_ids: [] }`
- `GET    /api/invoices?customer_id=&status=&search=`
- `GET    /api/audit?entity_id=&limit=`
- `POST   /api/matcher/run` → `MatcherReport`

## Testing (proportional to the 4–6h budget)

- **API:** vitest + real Postgres in `docker-compose.test.yml`. One e2e per matcher rule using a small targeted fixture. Idempotency assertion: run matcher twice, allocations table identical. Concurrency: two parallel `PUT /allocations` for same txn — one returns 409.
- **Web:** smoke test — render workspace, select a needs-review txn, accept a proposal, assert audit row appears. No exhaustive component tests; budget goes to matcher correctness.
- **Labeled fixture sweep:** `task/labels.json` (committed) maps every TXN id to its expected outcome (`{ txn_id, expected_status, expected_invoices, expected_allocation_cents }`). One test loads the full fixture, runs seed + matcher, walks every txn, asserts matcher produced the labeled outcome. Satisfies the eval question without an LLM.

## Deliverables mapping

- `README.md` — what it does, `docker compose up`, screenshots, "what's missing".
- `DECISIONS.md` — Tier 3 deferrals (FX), no-auth/no-bulk/no-invoice-view, env-only matcher config, the matcher-only-touches-proposed invariant, why integer cents, why single workspace page.
- `AI-WORKFLOW.md` — tools used; one override moment; one big save.
- `EVAL.md` — short note: no LLM in matcher; correctness verified via labeled fixture covering all 80 transactions; results summary.
- `PROMPTS.md` — 3–5 prompts captured during build.
- Loom (3–5 min) — matcher run from cold boot, one auto match, one needs-review confirm, one consolidated split, the payout batch, the audit log, one optimistic-lock conflict.

## Scope summary

~12 endpoints, ~7 tables, ~8 matcher rules, 1 React page with ~6 components, ~10 backend tests + the labeled fixture sweep + 1 web smoke test.

Cuts called out explicitly: auth, multi-tenant, FX, bank-feed sync, invoice-centric view, bulk actions, matcher config UI, prepayment ledger, real notifications.
