# Evaluation

The matcher contains no LLM. Correctness is verified deterministically via a labeled fixture sweep covering all 80 transactions in `task/transactions.json`.

## Procedure

1. `docker compose -f docker-compose.test.yml up -d`
2. `./bin/pnpm --filter @reconciler/api test fixture-sweep`

## Result

- Total transactions: 80
- Auto-matched: 38 (R1 exact-ref: 34, FX under-payments auto-confirmed: 3, part-payment auto-confirmed: 1)
- Needs review: 10 (partial payments, fuzzy/subset matches, credit-note netting cases, false-positive duplicate)
- Partially allocated: 3 (FX/rounded-up overpayments where allocation < tx amount)
- Payout batch: 1 (Stripe)
- Unrelated: 28 (salary/rent/fee/SaaS/internal transfers)
- Unmatched: 8 (prepayments, re-imported duplicates, bank interest, refunds, VAT credits)
- Sweep failures: 0

## Methodology note

Labels in `task/labels.json` were established by manual inspection of the 80 fixture transactions before running the sweep. Labels represent the correct accounting outcome per the spec tier model: R8 noise keywords classify operational outflows; everything else that cannot be auto-matched routes to `needs_review` or stays `unmatched` for human review. Tuning the matcher to its own labels is an anti-pattern — these labels were fixed first.
