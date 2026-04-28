import { eq, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, allocations } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { recordAudit } from '../../db/audit.js';

export async function runR8Noise(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, 'unmatched'));
  for (const tx of txs) {
    const haystack = `${tx.counterparty_name} ${tx.description}`.toLowerCase();
    const hit = cfg.noiseKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
    const isNegativeOrphan = tx.amount < 0;

    if (!hit && !isNegativeOrphan) continue;

    const existing = await db
      .select({ c: sql<string>`count(*)` })
      .from(allocations)
      .where(eq(allocations.transaction_id, tx.id));
    if (Number(existing[0]?.c ?? 0) > 0) continue;

    await db
      .update(transactions)
      .set({ status: 'unrelated', updated_at: sql`now()` })
      .where(eq(transactions.id, tx.id));
    await recordAudit(db, {
      entity_type: 'transaction',
      entity_id: tx.id,
      action: 'matcher_marked_unrelated',
      actor: 'matcher',
      before: { status: tx.status },
      after: { status: 'unrelated' },
    });
    fired('noise');
  }
}
