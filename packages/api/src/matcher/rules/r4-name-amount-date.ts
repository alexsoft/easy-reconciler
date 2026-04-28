import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { normalizeCustomerName } from '../normalize.js';
import { jaroWinkler } from '../jaro-winkler.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';
import { withinTolerance } from '../score.js';

const dayMs = 24 * 60 * 60 * 1000;

export async function runR4NameAmountDate(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, 'unmatched'));
  if (txs.length === 0) {
    return;
  }
  const allInv = await db.select().from(invoices);
  const normInv = allInv.map((i) => ({ inv: i, norm: normalizeCustomerName(i.customer_name) }));

  for (const tx of txs) {
    const txNorm = normalizeCustomerName(tx.counterparty_name);
    if (!txNorm) {
      continue;
    }

    const customerHits = normInv.filter(
      ({ norm }) => jaroWinkler(txNorm, norm) >= cfg.customerName.jaroWinklerThreshold,
    );
    if (customerHits.length === 0) {
      continue;
    }

    const candidates: typeof allInv = [];
    for (const { inv } of customerHits) {
      if (inv.currency !== tx.currency) {
        continue;
      }
      if (inv.type !== 'invoice') {
        continue;
      }
      const issue = new Date(inv.issue_date);
      const txDate = new Date(tx.date);
      const diff = (txDate.getTime() - issue.getTime()) / dayMs;
      if (diff < -cfg.dateWindow.daysBeforeIssue) {
        continue;
      }
      if (diff > cfg.dateWindow.daysAfterIssue) {
        continue;
      }
      const balance = await invoiceBalance(db, inv.id);
      if (balance <= 0) {
        continue;
      }
      if (!withinTolerance(tx.amount, balance, cfg.amountToleranceCents)) {
        continue;
      }
      candidates.push(inv);
    }
    if (candidates.length !== 1) {
      continue;
    }
    const inv = candidates[0]!;
    const balance = await invoiceBalance(db, inv.id);
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: inv.id,
      amount: Math.min(tx.amount, balance),
      confidence: cfg.ruleConfidence.nameAmountDate,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    fired('name_amount_date');
  }
}
