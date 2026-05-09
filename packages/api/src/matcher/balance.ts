import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { invoices, allocations } from '../db/schema.js';

export async function invoiceBalance(db: DB, invoiceId: string): Promise<number> {
  const inv = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (inv.length === 0) {
    throw new Error(`invoice ${invoiceId} not found`);
  }
  const allocated = await db
    .select({ sum: sql<string | null>`coalesce(sum(${allocations.amount}), 0)` })
    .from(allocations)
    .where(and(eq(allocations.invoice_id, invoiceId), eq(allocations.status, 'confirmed')));
  const sum = Number(allocated[0]?.sum ?? 0);
  return inv[0]!.total - sum;
}

export async function openInvoicesForCustomer(db: DB, customerId: string) {
  const rows = await db
    .select({
      id: invoices.id,
      type: invoices.type,
      customer_id: invoices.customer_id,
      customer_name: invoices.customer_name,
      customer_vat: invoices.customer_vat,
      issue_date: invoices.issue_date,
      due_date: invoices.due_date,
      currency: invoices.currency,
      subtotal: invoices.subtotal,
      tax_total: invoices.tax_total,
      total: invoices.total,
      created_at: invoices.created_at,
      updated_at: invoices.updated_at,
      allocated: sql<string>`coalesce(sum(${allocations.amount}), 0)`,
    })
    .from(invoices)
    .leftJoin(
      allocations,
      and(eq(allocations.invoice_id, invoices.id), eq(allocations.status, 'confirmed')),
    )
    .where(and(eq(invoices.customer_id, customerId), eq(invoices.type, 'invoice')))
    .groupBy(invoices.id);
  return rows
    .map((r) => ({ ...r, balance: r.total - Number(r.allocated) }))
    .filter((r) => r.balance > 0);
}

export async function allOpenInvoicesByCustomer(
  db: DB,
): Promise<Map<string, Array<{ id: string; balance: number; customer_name: string }>>> {
  const rows = await db
    .select({
      id: invoices.id,
      customer_id: invoices.customer_id,
      customer_name: invoices.customer_name,
      total: invoices.total,
      allocated: sql<string>`coalesce(sum(${allocations.amount}), 0)`,
    })
    .from(invoices)
    .leftJoin(
      allocations,
      and(eq(allocations.invoice_id, invoices.id), eq(allocations.status, 'confirmed')),
    )
    .where(eq(invoices.type, 'invoice'))
    .groupBy(invoices.id);

  const map = new Map<string, Array<{ id: string; balance: number; customer_name: string }>>();
  for (const r of rows) {
    const balance = r.total - Number(r.allocated);
    if (balance <= 0) {
      continue;
    }
    const list = map.get(r.customer_id) ?? [];
    list.push({ id: r.id, balance, customer_name: r.customer_name });
    map.set(r.customer_id, list);
  }
  return map;
}
