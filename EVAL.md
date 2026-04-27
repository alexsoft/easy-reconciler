# Evaluation

The matcher contains no LLM. Correctness is verified deterministically via a labeled fixture sweep covering all 80 transactions in `task/transactions.json`.

## Procedure

1. `docker compose -f docker-compose.test.yml up -d`
2. `./bin/pnpm --filter @reconciler/api test fixture-sweep`

## Result

- Total transactions: 80
- Auto-matched: 32 (R1 exact-ref: 29, FX/part-payments auto-confirmed by R1 underpayment logic: 3)
- Needs review: 8 (subset-sum consolidated payments, fuzzy/R4 description-only matches, credit-note netting, re-import duplicate)
- Partially allocated: 3 (FX/rounded-up overpayments where 7–537¢ over invoice balance is not allocated)
- Payout batch: 1 (Stripe)
- Unrelated: 22 (negative-amount operational outflows: salary, rent, fees, SaaS, internal transfers)
- Unmatched: 14 (prepayments, re-imported duplicates with depleted invoices, bank interest credits, card refunds, VAT credits)
- Sweep failures: 0

## Methodology note

Labels in `task/labels.json` were established by manual inspection of the 80 fixture transactions before running the sweep. Labels represent the correct accounting outcome per the spec tier model: R8 noise keywords classify operational outflows; everything else that cannot be auto-matched routes to `needs_review` or stays `unmatched` for human review. Tuning the matcher to its own labels is an anti-pattern — these labels were fixed first.
