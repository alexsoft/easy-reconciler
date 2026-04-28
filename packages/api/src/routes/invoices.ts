import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, ilike, or, sql, sum, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invoices, allocations } from '../db/schema.js';

export async function invoiceRoutes(app: FastifyInstance) {
  app.get('/api/invoices', async (req) => {
    const q = z
      .object({
        customer_id: z.string().optional(),
        search: z.string().max(100).optional(),
        include_credit_notes: z.coerce.boolean().default(true),
      })
      .parse(req.query);

    const filters: SQL[] = [];
    if (q.customer_id) {
      filters.push(eq(invoices.customer_id, q.customer_id));
    }
    if (!q.include_credit_notes) {
      filters.push(eq(invoices.type, 'invoice'));
    }
    if (q.search) {
      const like = `%${q.search}%`;
      filters.push(or(ilike(invoices.id, like), ilike(invoices.customer_name, like))!);
    }

    const rows = await db
      .select({
        id: invoices.id,
        type: invoices.type,
        customer_id: invoices.customer_id,
        customer_name: invoices.customer_name,
        currency: invoices.currency,
        issue_date: invoices.issue_date,
        due_date: invoices.due_date,
        total: invoices.total,
        allocated: sql<string>`coalesce(${sum(allocations.amount)}, 0)`,
      })
      .from(invoices)
      .leftJoin(allocations, and(eq(allocations.invoice_id, invoices.id), eq(allocations.status, 'confirmed')))
      .groupBy(
        invoices.id,
        invoices.type,
        invoices.customer_id,
        invoices.customer_name,
        invoices.currency,
        invoices.issue_date,
        invoices.due_date,
        invoices.total,
      )
      .where(filters.length ? and(...filters) : undefined);

    return rows.map((r) => ({ ...r, balance: r.total - Number(r.allocated) }));
  });
}
