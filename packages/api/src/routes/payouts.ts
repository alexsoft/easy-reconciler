import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { payout_batches, payout_items, allocations, transactions } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import { setAllocationStatus } from '../repository/allocations.js';

const Body = z.object({
  version: z.number().int(),
  accepted_item_ids: z.array(z.string()),
});

export async function payoutRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: z.infer<typeof Body> }>(
    '/api/payout-batches/:id/confirm',
    async (req, reply) => {
      const body = Body.parse(req.body);
      return db.transaction(async (tx) => {
        const batch = (await tx.select().from(payout_batches).where(eq(payout_batches.id, req.params.id)).limit(1))[0];
        if (!batch?.transaction_id) {
          return reply.code(400).send({ error: 'batch_not_linked' });
        }
        const updated = await tx
          .update(transactions)
          .set({ version: sql`version + 1`, updated_at: sql`now()` })
          .where(and(eq(transactions.id, batch.transaction_id), eq(transactions.version, body.version)))
          .returning();
        if (updated.length === 0) {
          return reply.code(409).send({ error: 'version_conflict' });
        }

        const items = await tx.select().from(payout_items).where(eq(payout_items.payout_batch_id, batch.id));
        const accepted = new Set(body.accepted_item_ids);
        for (const item of items) {
          if (item.type !== 'charge' || !item.invoice_id) {
            continue;
          }
          const allocs = await tx
            .select()
            .from(allocations)
            .where(
              and(
                eq(allocations.transaction_id, batch.transaction_id),
                eq(allocations.invoice_id, item.invoice_id),
                eq(allocations.rule, 'payout_link'),
              ),
            );
          const existing = allocs[0];
          if (!existing) {
            continue;
          }
          await setAllocationStatus(tx, existing.id, accepted.has(item.id) ? 'confirmed' : 'rejected');
        }
        await tx.update(payout_batches).set({ status: 'confirmed' }).where(eq(payout_batches.id, batch.id));
        await recordAudit(tx, {
          entity_type: 'payout_batch',
          entity_id: batch.id,
          action: 'reviewer_confirmed_payout_batch',
          actor: 'reviewer',
          after: { accepted: body.accepted_item_ids },
        });
        return { ok: true, version: updated[0]!.version };
      });
    },
  );
}
