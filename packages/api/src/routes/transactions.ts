import type { FastifyInstance } from 'fastify';
import { and, eq, ilike, or, sql, desc, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transactions, allocations } from '../db/schema.js';
import { z } from 'zod';
import { recordAudit } from '../db/audit.js';

const StatusQuery = z
  .enum(['unmatched', 'auto_matched', 'partially_allocated', 'needs_review', 'unrelated', 'payout_batch', 'all'])
  .default('all');

export async function transactionRoutes(app: FastifyInstance) {
  app.get('/api/transactions', async (req) => {
    const q = z
      .object({
        status: StatusQuery.optional(),
        search: z.string().optional(),
      })
      .parse(req.query);

    const filters: SQL[] = [];
    if (q.status && q.status !== 'all') filters.push(eq(transactions.status, q.status));
    if (q.search) {
      const like = `%${q.search}%`;
      filters.push(
        or(
          ilike(transactions.id, like),
          ilike(transactions.counterparty_name, like),
          ilike(transactions.description, like),
          ilike(transactions.structured_reference, like),
        ),
      );
    }
    return db
      .select()
      .from(transactions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(transactions.date));
  });

  app.get('/api/transactions/stats', async () => {
    const rows = await db
      .select({
        status: transactions.status,
        count: sql<string>`count(*)`,
      })
      .from(transactions)
      .groupBy(transactions.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  });

  app.get<{ Params: { id: string } }>('/api/transactions/:id', async (req, reply) => {
    const tx = (await db.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1))[0];
    if (!tx) return reply.code(404).send({ error: 'not_found' });
    const allocs = await db.select().from(allocations).where(eq(allocations.transaction_id, tx.id));
    return {
      ...tx,
      allocations: allocs.filter((a) => a.status !== 'proposed'),
      proposals: allocs.filter((a) => a.status === 'proposed'),
    };
  });

  const VersionBody = z.object({ version: z.number().int() });

  app.post<{ Params: { id: string } }>('/api/transactions/:id/mark-unrelated', async (req, reply) => {
    const body = VersionBody.parse(req.body);
    return db.transaction(async (tx) => {
      const updated = await tx
        .update(transactions)
        .set({ status: 'unrelated', version: sql`version + 1`, updated_at: sql`now()` })
        .where(and(eq(transactions.id, req.params.id), eq(transactions.version, body.version)))
        .returning();
      if (updated.length === 0) {
        const cur = (await tx.select().from(transactions).where(eq(transactions.id, req.params.id)))[0];
        return reply.code(409).send({ error: 'version_conflict', current: cur });
      }
      await recordAudit(tx, {
        entity_type: 'transaction',
        entity_id: req.params.id,
        action: 'reviewer_marked_unrelated',
        actor: 'reviewer',
        after: { status: 'unrelated' },
      });
      return { ok: true, version: updated[0]!.version };
    });
  });

  app.post<{ Params: { id: string } }>('/api/transactions/:id/unmark-unrelated', async (req, reply) => {
    const body = VersionBody.parse(req.body);
    return db.transaction(async (tx) => {
      const updated = await tx
        .update(transactions)
        .set({ status: 'unmatched', version: sql`version + 1`, updated_at: sql`now()` })
        .where(and(eq(transactions.id, req.params.id), eq(transactions.version, body.version)))
        .returning();
      if (updated.length === 0) return reply.code(409).send({ error: 'version_conflict' });
      await recordAudit(tx, {
        entity_type: 'transaction',
        entity_id: req.params.id,
        action: 'reviewer_unmarked_unrelated',
        actor: 'reviewer',
        after: { status: 'unmatched' },
      });
      return { ok: true, version: updated[0]!.version };
    });
  });
}
