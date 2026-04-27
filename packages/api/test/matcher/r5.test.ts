import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getTestDb, truncateAll, closeTestDb } from "../helpers/db.js";
import { transactions, invoices, allocations } from "../../src/db/schema.js";
import { runR5SubsetSum } from "../../src/matcher/rules/r5-subset-sum.js";
import { matcherConfig } from "../../src/matcher/config.js";

describe("R5 subset sum", () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("creates multi-row allocation for unique subset", async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      { id: "INV-A", type: "invoice", customer_id: "C1", customer_name: "Acme",
        customer_vat: "LU0", issue_date: "2026-01-01", due_date: "2026-02-01",
        currency: "EUR", subtotal: 1000, tax_total: 0, total: 1000 },
      { id: "INV-B", type: "invoice", customer_id: "C1", customer_name: "Acme",
        customer_vat: "LU0", issue_date: "2026-01-01", due_date: "2026-02-01",
        currency: "EUR", subtotal: 2500, tax_total: 0, total: 2500 },
    ]);
    await db.insert(transactions).values({
      id: "T1", date: "2026-01-15", amount: 3500, currency: "EUR",
      counterparty_name: "Acme", description: "consolidated",
      structured_reference: null, dedup_hash: "h1",
    });
    await runR5SubsetSum(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(2);
    expect(allocs.every((a) => a.rule === "subset_sum")).toBe(true);
  });

  it("does nothing when multiple subsets sum to target", async () => {
    const { db } = await getTestDb();
    // 1000 = A or = B+C (B=400,C=600)
    await db.insert(invoices).values([
      { id: "A", type: "invoice", customer_id: "C1", customer_name: "Acme",
        customer_vat: "LU0", issue_date: "2026-01-01", due_date: "2026-02-01",
        currency: "EUR", subtotal: 1000, tax_total: 0, total: 1000 },
      { id: "B", type: "invoice", customer_id: "C1", customer_name: "Acme",
        customer_vat: "LU0", issue_date: "2026-01-01", due_date: "2026-02-01",
        currency: "EUR", subtotal: 400, tax_total: 0, total: 400 },
      { id: "C", type: "invoice", customer_id: "C1", customer_name: "Acme",
        customer_vat: "LU0", issue_date: "2026-01-01", due_date: "2026-02-01",
        currency: "EUR", subtotal: 600, tax_total: 0, total: 600 },
    ]);
    await db.insert(transactions).values({
      id: "T1", date: "2026-01-15", amount: 1000, currency: "EUR",
      counterparty_name: "Acme", description: "x",
      structured_reference: null, dedup_hash: "h1",
    });
    await runR5SubsetSum(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
