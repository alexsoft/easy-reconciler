# **EasyBiz screening task: Invoice ↔ Transaction reconciler**

Thanks for your interest in joining EasyBiz as a product-owner developer. Below is a short take-home task that mirrors the kind of work you'd own here. We care far more about **how you work** than about how much you ship.

---

## **The Problem**

EasyBiz helps Luxembourg SMEs keep their books clean. One of the recurring jobs is reconciliation: matching bank transactions to the invoices they settle. The 80% that automates cleanly is boring. The 20% that doesn't — partial payments, consolidated settlements, credit-note netting, FX drift, garbled references, payment-provider payouts — is where real product thinking lives.

## **Files in This Folder**

- `invoices.json` — 52 records (50 invoices + 2 credit notes). Each has a header and line items.
- `transactions.json` — 80 bank transactions (date, amount, noisy counterparty name, sometimes a structured reference, freeform description).
- `payout_report.csv` — one Stripe-style payout report you'll need to break apart. **Note:** only _one_ transaction in `transactions.json` corresponds to this payout — the rest are direct bank movements.

<aside>
📁

[transactions.json](attachment:fc0061ec-f361-443a-8c4e-01133f8f3310:transactions.json)

[payout_report.csv](attachment:84552a8c-18f7-4006-aed0-4b5935c37a75:payout_report.csv)

[invoices.json](attachment:7a74ed65-cf2d-4fe9-bb3e-95ed2e5026b6:invoices.json)

</aside>

## **What to Build**

A tool that:

1. **Auto-matches** transactions to invoices (and their line items where applicable), with a confidence score per match.
2. **Handles — or explicitly defers with a documented reason — the realistic cases present in the data:**
   - partial payments
   - consolidated payments (one transaction settles multiple invoices)
   - credit-note netting
   - FX differences
   - over/underpayment
   - garbled invoice references
   - payment-provider payouts (Stripe-style)
   - prepayments (transaction arrives before invoice)
   - duplicate re-imports (same transaction imported twice)
   - unrelated noise (salary, rent, fees, refunds)
3. **Ships a review UI** for everything the matcher couldn't close confidently. A reviewer must be able to split a transaction across invoices, allocate partial payments, attach a credit note, or mark a transaction as unrelated — with an audit trail.

Use whatever stack, tools, and AI you like. Our in-house stack is **Fastify + Drizzle + Postgres + React + TanStack Query** — matching it is a bonus but not required.

## **Deliverables**

In a single Git repo (public or shared privately):

1. **Working prototype** — runnable with **one command** (Docker compose, `pnpm dev`, whatever — just make it one command).
2. **`README.md`** — what it does, how to run, what's missing.
3. **`DECISIONS.md`** — tradeoffs, scope cuts, **which accounting edge cases you deferred and why**.
4. **`AI-WORKFLOW.md`** — which AI tools you used, one moment you overrode the AI and why, one moment the AI saved you hours.
5. **`EVAL.md`** (or in-line in `DECISIONS.md`) — if you used an LLM anywhere in the matcher, show precision/recall on your own labeled set.
6. **A 3–5 min Loom walkthrough** (screen + voice) showing the tool and explaining one non-trivial design decision.
7. **`PROMPTS.md`** — 3–5 example prompts you actually used on this task, with a one-line note on what each was for.

## **Constraints & Rules**

- **Budget:** 4–6 hours of actual work. Don't over-invest — we'd rather see what you prioritize than what you grind.
- **Deadline:** 48 hours from when the link is shared with you.
- **Questions:** You may send **one** clarifying question by email. We'll answer within a few hours.
- **AI:** Required. Use anything. Share a handful of your actual prompts in `PROMPTS.md`.
- **Secrets:** Don't share real API keys.

## **What We're Assessing**

So you can focus your time:

- **Accounting judgment** — do you recognize that a partial payment isn't a match failure but a state change on an invoice?
- **Structure** — do you plan before coding and cut scope explicitly?
- **Programming rigor** — is your matcher idempotent if re-run? Do you think about concurrent reviewers? About indexes?
- **AI proficiency** — how you prompt, how you catch AI errors, whether you verify with evals.
- **Approach & tools** — deliberate choices, not defaults.
- **Documentation** — can a stranger read your README and understand the _why_?
- **Verification** — did you run what you claim works?
- **Product sense for the unautomated 20%** — what does the review UI actually feel like to use?

## **Next Steps**

- Review within 48h of your submission.
- Finalists move to a **paid 1-week trial** on a small real feature in our codebase.

Good luck. Have fun with it — the best submissions usually do.
