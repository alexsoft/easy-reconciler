import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { DB } from '../db/client.js';
import { allocations, transactions } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';

const Body = z.object({ version: z.number().int() });

async function bumpAndCheck(tx: DB, txId: string, version: number) {
  const updated = await tx
    .update(transactions)
    .set({ version: sql`version + 1`, updated_at: sql`now()` })
    .where(and(eq(transactions.id, txId), eq(transactions.version, version)))
    .returning();
  return updated[0] ?? null;
}

export async function proposalsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { version: number } }>('/api/proposals/:id/accept', async (req, reply) => {
    const body = Body.parse(req.body);
    return db.transaction(async (tx) => {
      const prop = (await tx.select().from(allocations).where(eq(allocations.id, req.params.id)).limit(1))[0];
      if (!prop || prop.status !== 'proposed') return reply.code(404).send({ error: 'not_proposed' });
      const txRow = await bumpAndCheck(tx, prop.transaction_id, body.version);
      if (!txRow) return reply.code(409).send({ error: 'version_conflict' });
      await tx.update(allocations).set({ status: 'confirmed', source: 'manual' }).where(eq(allocations.id, prop.id));
      await recordAudit(tx, {
        entity_type: 'allocation',
        entity_id: prop.id,
        action: 'reviewer_confirmed',
        actor: 'reviewer',
        before: prop,
        after: { ...prop, status: 'confirmed' },
      });
      return { ok: true, version: txRow.version };
    });
  });

  app.post<{ Params: { id: string }; Body: { version: number } }>('/api/proposals/:id/reject', async (req, reply) => {
    const body = Body.parse(req.body);
    return db.transaction(async (tx) => {
      const prop = (await tx.select().from(allocations).where(eq(allocations.id, req.params.id)).limit(1))[0];
      if (!prop || prop.status !== 'proposed') return reply.code(404).send({ error: 'not_proposed' });
      const txRow = await bumpAndCheck(tx, prop.transaction_id, body.version);
      if (!txRow) return reply.code(409).send({ error: 'version_conflict' });
      await tx.update(allocations).set({ status: 'rejected' }).where(eq(allocations.id, prop.id));
      await recordAudit(tx, {
        entity_type: 'allocation',
        entity_id: prop.id,
        action: 'reviewer_rejected',
        actor: 'reviewer',
        before: prop,
        after: { ...prop, status: 'rejected' },
      });
      return { ok: true, version: txRow.version };
    });
  });
}
