import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getTestDb, truncateAll, closeTestDb } from "../helpers/db.js";
import { transactions, invoices, allocations, payout_batches, payout_items } from "../../src/db/schema.js";
import { runR7PayoutLink } from "../../src/matcher/rules/r7-payout-link.js";
import { matcherConfig } from "../../src/matcher/config.js";
import { eq } from "drizzle-orm";

describe("R7 payout link", () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("links payout txn and proposes per-charge allocations", async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      { id: "INV-A", type: "invoice", customer_id: "C1", customer_name: "Acme",
        customer_vat: "LU0", issue_date: "2026-01-01", due_date: "2026-02-01",
        currency: "EUR", subtotal: 50000, tax_total: 0, total: 50000 },
    ]);
    await db.insert(transactions).values({
      id: "T-PAYOUT", date: "2026-03-01", amount: 47500, currency: "EUR",
      counterparty_name: "Stripe", description: "Stripe payout March",
      structured_reference: null, dedup_hash: "hp",
    });
    await db.insert(payout_batches).values({
      id: "po_test", transaction_id: null,
      gross_total: 50000, fee_total: 2500, net_total: 47500,
    });
    await db.insert(payout_items).values({
      id: "ch_1", payout_batch_id: "po_test", invoice_id: "INV-A",
      customer_name: "Acme", gross_amount: 50000, fee: 2500, net_amount: 47500,
      type: "charge",
    });
    await runR7PayoutLink(db, matcherConfig, () => {});
    const tx = (await db.select().from(transactions).where(eq(transactions.id, "T-PAYOUT")))[0]!;
    expect(tx.status).toBe("payout_batch");
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.status).toBe("proposed");
  });
});
