import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { invoices, allocations } from "../db/schema.js";

export async function invoiceBalance(db: DB, invoiceId: string): Promise<number> {
  const inv = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (inv.length === 0) throw new Error(`invoice ${invoiceId} not found`);
  const allocated = await db
    .select({ sum: sql<string | null>`coalesce(sum(${allocations.amount}), 0)` })
    .from(allocations)
    .where(and(eq(allocations.invoice_id, invoiceId), eq(allocations.status, "confirmed")));
  const sum = Number(allocated[0]?.sum ?? 0);
  return inv[0]!.total - sum;
}

export async function openInvoicesForCustomer(db: DB, customerId: string) {
  const all = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.customer_id, customerId), eq(invoices.type, "invoice")));
  const result: Array<typeof all[number] & { balance: number }> = [];
  for (const inv of all) {
    const balance = await invoiceBalance(db, inv.id);
    if (balance > 0) result.push({ ...inv, balance });
  }
  return result;
}
