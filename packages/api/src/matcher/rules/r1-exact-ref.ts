import { eq, isNotNull, and } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';

type RuleHook = (event: string) => void;

export async function runR1ExactRef(db: DB, cfg: MatcherConfig, fired: RuleHook): Promise<void> {
  const txs = await db
    .select()
    .from(transactions)
    .where(and(isNotNull(transactions.structured_reference), eq(transactions.status, 'unmatched')));

  for (const tx of txs) {
    const ref = tx.structured_reference!;
    const inv = (await db.select().from(invoices).where(eq(invoices.id, ref)).limit(1))[0];
    if (!inv) {
      continue;
    }
    if (inv.currency !== tx.currency) {
      continue;
    }

    const balance = await invoiceBalance(db, inv.id);
    if (balance <= 0) {
      continue;
    }

    const allocAmount = Math.min(tx.amount, balance);
    const overpaymentAbs = tx.amount - balance;
    const overpaymentPct = balance > 0 ? overpaymentAbs / balance : 0;
    const isOver = overpaymentAbs > cfg.overpayment.absThresholdCents && overpaymentPct > cfg.overpayment.pctThreshold;

    const bucket = isOver ? 'propose' : 'auto_confirm';
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: inv.id,
      amount: allocAmount,
      confidence: cfg.ruleConfidence.exactRef,
      rule: 'exact_ref',
      bucket,
    });
    fired('exact_ref');
  }
}
