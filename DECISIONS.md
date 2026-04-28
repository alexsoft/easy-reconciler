# Decisions

## Bigint cents for all money columns

Postgres `numeric` comes back as a string in the `pg` driver. Representing money as whole-number cents (stored as `bigint`, returned as JS `number` via Drizzle's `mode: 'number'`) avoids pulling in `decimal.js` or similar and eliminates floating-point rounding entirely. Every amount in the fixture fits comfortably inside JS safe-integer range, so no precision is lost.

## Matcher invariant: only touch `proposed` rows

The matcher inserts new allocation rows freely on each run. When inserting, the status depends on confidence: high-confidence matches go directly to `confirmed` (the `auto_confirm` bucket); lower-confidence matches are inserted as `proposed` for reviewer approval. The matcher only modifies existing rows when their status is `proposed`. Rows the reviewer has moved to `confirmed` or `rejected` are left untouched. This means reviewer decisions survive re-runs of the pipeline — idempotent reruns do not churn confirmed allocations.

## Optimistic locking on `transactions` only

A `version` integer column lives on `transactions`. The matcher does **not** bump the version when it writes allocations; only reviewer-initiated PUT requests increment it. If the matcher bumped version, two open reviewer browser sessions would see spurious 409 conflicts after every pipeline run. Locking is scoped to human-initiated writes only.

## Single workspace page

The UI is transaction-driven: reviewers work down a list of transactions, open the detail pane for a selected transaction, and optionally open the audit modal. There is no domain routing beyond root + audit modal — a full router would add nav overhead with no user benefit for a single-tenant prototype.

## Append-only audit log

A Postgres trigger blocks `UPDATE` and `DELETE` on the `audit_log` table at the database level. Application code cannot accidentally or maliciously overwrite history. The trigger is installed in the migration, not the application layer, so it applies regardless of which process writes to the DB.

## R6 credit-note rule is a hook, not automatic netting

True credit-note netting requires a real offsetting transaction (a bank credit or a separate debit). R6 does not invent a phantom transaction. Instead the UI surfaces a `[CN]` badge on invoices that carry credit-note lines in the InvoicePicker. The reviewer selects the invoice and manually adds a negative allocation for the credit amount. This keeps the audit trail clean and avoids double-counting.

## Tier 3 deferrals

- **FX / multi-currency** — the fixture is single-currency (EUR). Adding FX would require a rate source, a rates table, and tolerance logic per currency pair. Deferred until there is real multi-currency data.
- **Auth / multi-tenant** — out of scope for a prototype. All API endpoints are unauthenticated; adding auth would require a user table, JWT middleware, and row-level security on every query.
- **Prepayment ledger** — R4 (name + amount + date window) rejects transactions dated before the invoice issue date, so prepayments naturally fall through to `unmatched` for human review. A true prepayment ledger would require a credit-on-account model.
- **Bulk reviewer actions** — confirming or rejecting 50 allocations in one click risks mass-overwriting reviewer work in a shared session. Deferred until there is a concurrency model that makes bulk safe.
- **Matcher config UI** — fuzzy threshold, date window, and noise keywords are currently env vars. A config UI is useful but not required for correctness; deferred.

## Jaro-Winkler function

It was initially implemented inside of the project, without using other libraries. I thought about substituting it with a library, but decided to keep as it is in order to minimize the amount of libraries required. Especially with recent chain of supply attacks it might make sense. Or when it makes sense, own mirror of package can be used inside organization which will help prevent such issues.
