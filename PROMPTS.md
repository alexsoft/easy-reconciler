# Example Prompts

Representative prompts used during the build, in roughly chronological order.

---

**1. Schema scaffold**

> Generate a Drizzle ORM schema for these 7 tables (invoices, invoice_lines, transactions, allocations, payout_batches, payout_items, audit_log) using bigint cents for all money columns. Include a Postgres trigger enforcing append-only on audit_log.

Full schema scaffold generated in one shot, including the trigger as a raw SQL migration step.

---

**2. Jaro-Winkler utility**

> Write a Jaro-Winkler distance function in TypeScript with no external dependencies. Include unit tests covering edge cases: empty strings, identical strings, single transposition, prefix bonus.

Single-file utility, mathematically correct on first attempt. Used in R3 (fuzzy reference matching).

---

**3. Payout CSV seed**

> Given this CSV header `charge_id,invoice_id,customer_name,gross_amount,fee,net_amount,type`, write a csv-parse/sync seed function that upserts a payout_batch and its payout_items, mapping net_amount cents to the allocatable amount on the batch.

Produced a working seed function with correct upsert logic and cent conversion.

---

**4. R5 subset-sum**

> Implement R5 subset-sum: given a target amount and a list of open invoice balances for a customer, find the unique subset (if any) that sums to the target within a tolerance. Only fire if exactly one such subset exists. Return null if zero or multiple subsets match.

Backtracking algorithm with early exit, correct uniqueness check, and tolerance parameter wired through from env config.

---

**5. Optimistic-lock concurrency test**

> Write an integration test that sends two concurrent PUT /api/transactions/:id/allocations requests with the same version number and asserts exactly one succeeds with 200 and the other fails with 409. Use the real test database, not mocks.

Produced a clean `Promise.all` concurrency test against the real Postgres instance; no mock involvement.

---

**6. Review**
> Review the project from following points of view: performance, code quality, code organization, security. You can use sub agents.
  In the end create a table with comments and short descriptions how to improve that

Produced a good quality list of things to fix: N+1 queries, missing indexes, some possible DoS vectors, possible issues with authorization, missing validation rules, etc.
