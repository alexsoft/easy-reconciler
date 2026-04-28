import { eq } from 'drizzle-orm';
import levenshtein from 'fast-levenshtein';
import type { DB } from '../../db/client.js';
import { transactions, invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { normalizeRef } from '../normalize.js';
import { invoiceBalance } from '../balance.js';
import { upsertProposed } from '../upsert-allocation.js';
import { withinTolerance } from '../score.js';

export async function runR3FuzzyRef(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, 'unmatched'));
  if (txs.length === 0) return;
  const allInv = await db.select().from(invoices);
  const normInv = allInv.map((i) => ({ inv: i, norm: normalizeRef(i.id) }));

  for (const tx of txs) {
    const haystack = `${tx.structured_reference ?? ''} ${tx.description}`;
    const tokens = haystack.split(/\s+/).filter((t) => t.length >= 6);
    let best: { inv: (typeof allInv)[number]; dist: number } | null = null;
    for (const tok of tokens) {
      const normTok = normalizeRef(tok);
      for (const { inv, norm } of normInv) {
        const d = levenshtein.get(normTok, norm);
        if (d <= cfg.fuzzyRef.maxLevenshtein && (!best || d < best.dist)) {
          best = { inv, dist: d };
        }
      }
    }
    if (!best) continue;
    if (best.inv.currency !== tx.currency) continue;
    const balance = await invoiceBalance(db, best.inv.id);
    if (balance <= 0) continue;
    if (
      !withinTolerance(tx.amount, balance, cfg.amountToleranceCents) &&
      tx.amount > balance + cfg.overpayment.absThresholdCents
    )
      continue;
    await upsertProposed(db, {
      transaction_id: tx.id,
      invoice_id: best.inv.id,
      amount: Math.min(tx.amount, balance),
      confidence: cfg.ruleConfidence.fuzzyRef,
      rule: 'fuzzy_ref',
      bucket: 'propose',
    });
    fired('fuzzy_ref');
  }
}
