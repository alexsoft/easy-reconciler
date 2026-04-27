import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getTestDb, truncateAll, closeTestDb } from "../helpers/db.js";
import { transactions, invoices, allocations } from "../../src/db/schema.js";
import { runMatcher } from "../../src/matcher/pipeline.js";

describe("matcher idempotency", () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("two runs produce identical allocations", async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: "INV-A", type: "invoice", customer_id: "C1", customer_name: "X",
      customer_vat: "LU0", issue_date: "2026-01-01", due_date: "2026-02-01",
      currency: "EUR", subtotal: 1000, tax_total: 0, total: 1000,
    });
    await db.insert(transactions).values({
      id: "T1", date: "2026-01-15", amount: 1000, currency: "EUR",
      counterparty_name: "x", description: "p INV-A", structured_reference: "INV-A",
      dedup_hash: "h1",
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
