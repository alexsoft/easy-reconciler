import { eq, and, isNull, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, payout_batches, payout_items, allocations, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import cuid from 'cuid';
import { recordAudit } from '../../db/audit.js';

export async function runR7PayoutLink(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const unlinked = await db.select().from(payout_batches).where(isNull(payout_batches.transaction_id));
  for (const batch of unlinked) {
    if (batch.net_total == null) continue;
    const candidates = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.amount, batch.net_total), eq(transactions.status, 'unmatched')));
    const winner = candidates.find((t) => {
      const blob = `${t.counterparty_name} ${t.description}`.toLowerCase();
      return blob.includes('payout') || blob.includes('stripe');
    });
    if (!winner) continue;

    await db.update(payout_batches).set({ transaction_id: winner.id }).where(eq(payout_batches.id, batch.id));
    await db
      .update(transactions)
      .set({ status: 'payout_batch', updated_at: sql`now()` })
      .where(eq(transactions.id, winner.id));
    await recordAudit(db, {
      entity_type: 'payout_batch',
      entity_id: batch.id,
      action: 'matcher_auto_confirmed',
      actor: 'matcher',
      after: { transaction_id: winner.id },
    });

    const items = await db.select().from(payout_items).where(eq(payout_items.payout_batch_id, batch.id));
    for (const item of items) {
      if (item.type !== 'charge' || !item.invoice_id) continue;
      const inv = (await db.select().from(invoices).where(eq(invoices.id, item.invoice_id)).limit(1))[0];
      if (!inv) continue;
      const id = cuid();
      await db
        .insert(allocations)
        .values({
          id,
          transaction_id: winner.id,
          invoice_id: inv.id,
          amount: item.gross_amount,
          confidence: cfg.ruleConfidence.payoutLink.toFixed(2),
          status: 'proposed',
          source: 'auto',
          rule: 'payout_link',
          created_by: 'matcher',
        })
        .onConflictDoNothing();
      await recordAudit(db, {
        entity_type: 'allocation',
        entity_id: id,
        action: 'matcher_proposed',
        actor: 'matcher',
        after: { transaction_id: winner.id, invoice_id: inv.id, amount: item.gross_amount },
      });
      fired('payout_link');
    }
  }
}
