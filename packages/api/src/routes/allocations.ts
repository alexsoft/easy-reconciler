import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import cuid from 'cuid';
import { db } from '../db/client.js';
import { transactions, allocations, invoices } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';

const Body = z.object({
  version: z.number().int(),
  allocations: z.array(
    z.object({
      invoice_id: z.string(),
      amount: z.number().int(),
    }),
  ),
});

export async function allocationsRoutes(app: FastifyInstance) {
  app.put<{ Params: { id: string }; Body: z.infer<typeof Body> }>(
    '/api/transactions/:id/allocations',
    async (req, reply) => {
      const body = Body.parse(req.body);
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(transactions)
          .set({ version: sql`version + 1`, updated_at: sql`now()` })
          .where(and(eq(transactions.id, req.params.id), eq(transactions.version, body.version)))
          .returning();
        if (updated.length === 0) {
          const current = (await tx.select().from(transactions).where(eq(transactions.id, req.params.id)))[0];
          return reply.code(409).send({ error: 'version_conflict', current });
        }

        const before = await tx.select().from(allocations).where(eq(allocations.transaction_id, req.params.id));
        await tx.delete(allocations).where(eq(allocations.transaction_id, req.params.id));

        const correlation = cuid();
        const after: unknown[] = [];
        for (const a of body.allocations) {
          const inv = (await tx.select().from(invoices).where(eq(invoices.id, a.invoice_id)).limit(1))[0];
          if (!inv) return reply.code(400).send({ error: 'invoice_not_found', id: a.invoice_id });
          const id = cuid();
          const row = {
            id,
            transaction_id: req.params.id,
            invoice_id: a.invoice_id,
            amount: a.amount,
            confidence: null,
            status: 'confirmed' as const,
            source: 'manual' as const,
            rule: null,
            created_by: 'reviewer',
          };
          await tx.insert(allocations).values(row);
          after.push(row);
        }

        await recordAudit(tx, {
          entity_type: 'transaction',
          entity_id: req.params.id,
          action: 'reviewer_split',
          actor: 'reviewer',
          correlation_id: correlation,
          before,
          after,
        });

        const sumRow = await tx
          .select({
            sum: sql<string>`coalesce(sum(amount), 0)`,
          })
          .from(allocations)
          .where(and(eq(allocations.transaction_id, req.params.id), eq(allocations.status, 'confirmed')));
        const sum = Number(sumRow[0]?.sum ?? 0);
        const tx0 = updated[0]!;
        let status: string;
        if (sum >= tx0.amount) status = 'auto_matched';
        else if (sum > 0) status = 'partially_allocated';
        else status = 'unmatched';
        await tx.update(transactions).set({ status }).where(eq(transactions.id, req.params.id));

        return { ok: true, version: tx0.version };
      });
    },
  );
}
