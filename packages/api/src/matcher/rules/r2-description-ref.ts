import { eq, and, isNull } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { extractRefsFromText } from '../normalize.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';

export async function runR2DescriptionRef(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.structured_reference), eq(transactions.status, 'unmatched')));

  for (const tx of txs) {
    const refs = extractRefsFromText(tx.description);
    if (refs.length === 0) continue;
    // single-ref simple case; multiple refs handled by R5 subset-sum
    if (refs.length > 1) continue;
    const ref = refs[0]!;
    const inv = (await db.select().from(invoices).where(eq(invoices.id, ref)).limit(1))[0];
    if (!inv || inv.currency !== tx.currency) continue;
    const balance = await invoiceBalance(db, inv.id);
    if (balance <= 0) continue;
    const overAbs = tx.amount - balance;
    const isOver =
      overAbs > cfg.overpayment.absThresholdCents && overAbs / Math.max(balance, 1) > cfg.overpayment.pctThreshold;
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: inv.id,
      amount: Math.min(tx.amount, balance),
      confidence: cfg.ruleConfidence.descriptionRef,
      rule: 'description_ref',
      bucket: isOver ? 'propose' : 'auto_confirm',
    });
    fired('description_ref');
  }
}
