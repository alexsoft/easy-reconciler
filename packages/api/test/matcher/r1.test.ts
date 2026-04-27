import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getTestDb, truncateAll, closeTestDb } from "../helpers/db.js";
import { transactions, invoices, allocations } from "../../src/db/schema.js";
import { runR1ExactRef } from "../../src/matcher/rules/r1-exact-ref.js";
import { matcherConfig } from "../../src/matcher/config.js";
import { recomputeTxStatus } from "../../src/matcher/update-tx-status.js";
import { eq } from "drizzle-orm";

async function seed(db: any, opts: { txAmount: number; invoiceTotal: number; ref: string | null }) {
  await db.insert(invoices).values({
    id: "INV-2026-0001", type: "invoice", customer_id: "C1", customer_name: "Acme",
    customer_vat: "LU0", issue_date: "2026-02-21", due_date: "2026-03-23",
    currency: "EUR", subtotal: opts.invoiceTotal, tax_total: 0, total: opts.invoiceTotal,
  });
  await db.insert(transactions).values({
    id: "TXN-0001", date: "2026-02-26", amount: opts.txAmount, currency: "EUR",
    counterparty_name: "Acme Sarl", description: "Payment INV-2026-0001",
    structured_reference: opts.ref, dedup_hash: "h1",
  });
}

describe("R1 exact ref", () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("auto-confirms exact match at full amount", async () => {
    const { db } = await getTestDb();
    await seed(db, { txAmount: 112320, invoiceTotal: 112320, ref: "INV-2026-0001" });
    await runR1ExactRef(db, matcherConfig, () => {});
    await recomputeTxStatus(db, "TXN-0001");
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.status).toBe("confirmed");
    expect(allocs[0]!.amount).toBe(112320);
    const tx = (await db.select().from(transactions).where(eq(transactions.id, "TXN-0001")))[0]!;
    expect(tx.status).toBe("auto_matched");
  });

  it("auto-confirms partial at txn amount and leaves invoice partially paid", async () => {
    const { db } = await getTestDb();
    await seed(db, { txAmount: 50000, invoiceTotal: 112320, ref: "INV-2026-0001" });
    await runR1ExactRef(db, matcherConfig, () => {});
    await recomputeTxStatus(db, "TXN-0001");
    const allocs = await db.select().from(allocations);
    expect(allocs[0]!.amount).toBe(50000);
    const tx = (await db.select().from(transactions).where(eq(transactions.id, "TXN-0001")))[0]!;
    expect(tx.status).toBe("auto_matched");
  });

  it("flags overpayment for review", async () => {
    const { db } = await getTestDb();
    await seed(db, { txAmount: 119000, invoiceTotal: 112000, ref: "INV-2026-0001" });
    await runR1ExactRef(db, matcherConfig, () => {});
    await recomputeTxStatus(db, "TXN-0001");
    const allocs = await db.select().from(allocations);
    expect(allocs[0]!.amount).toBe(112000);
    expect(allocs[0]!.status).toBe("proposed");
    const tx = (await db.select().from(transactions).where(eq(transactions.id, "TXN-0001")))[0]!;
    expect(tx.status).toBe("needs_review");
  });

  it("does nothing when ref does not match any invoice", async () => {
    const { db } = await getTestDb();
    await seed(db, { txAmount: 1000, invoiceTotal: 1000, ref: "INV-NOPE" });
    await runR1ExactRef(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
