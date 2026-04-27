import { eq } from "drizzle-orm";
import cuid from "cuid";
import type { DB } from "../../db/client.js";
import { transactions, invoices, allocations } from "../../db/schema.js";
import type { MatcherConfig } from "../config.js";
import { normalizeCustomerName } from "../normalize.js";
import { jaroWinkler } from "../jaro-winkler.js";
import { openInvoicesForCustomer } from "../balance.js";
import { recordAudit } from "../../db/audit.js";

interface Subset { invoices: Array<{ id: string; balance: number }>; sum: number }

function findSingleSubset(
  candidates: Array<{ id: string; balance: number }>,
  target: number, tolerance: number, maxInvoices: number, maxCandidates: number,
): Subset | null {
  if (candidates.length > maxCandidates) candidates = candidates.slice(0, maxCandidates);
  let found: Subset | null = null;
  let foundCount = 0;
  function recurse(start: number, picked: typeof candidates, sum: number) {
    if (foundCount > 1) return;
    if (Math.abs(sum - target) <= tolerance && picked.length > 0) {
      found = { invoices: picked.slice(), sum };
      foundCount++;
      return;
    }
    if (picked.length >= maxInvoices) return;
    if (sum > target + tolerance) return;
    for (let i = start; i < candidates.length; i++) {
      picked.push(candidates[i]!);
      recurse(i + 1, picked, sum + candidates[i]!.balance);
      picked.pop();
      if (foundCount > 1) return;
    }
  }
  recurse(0, [], 0);
  return foundCount === 1 ? found : null;
}

export async function runR5SubsetSum(
  db: DB, cfg: MatcherConfig, fired: (rule: string) => void,
): Promise<void> {
  const txs = await db.select().from(transactions).where(eq(transactions.status, "unmatched"));
  if (txs.length === 0) return;
  const allInv = await db.select().from(invoices);
  const normInv = allInv.map((i) => ({ inv: i, norm: normalizeCustomerName(i.customer_name) }));

  for (const tx of txs) {
    const txNorm = normalizeCustomerName(tx.counterparty_name);
    if (!txNorm) continue;
    const customers = new Set(
      normInv
        .filter(({ norm }) => jaroWinkler(txNorm, norm) >= cfg.customerName.jaroWinklerThreshold)
        .map(({ inv }) => inv.customer_id),
    );
    if (customers.size === 0) continue;

    let chosen: Subset | null = null;
    for (const cust of customers) {
      const open = await openInvoicesForCustomer(db, cust);
      const candidates = open.map((o) => ({ id: o.id, balance: o.balance }));
      const subset = findSingleSubset(
        candidates, tx.amount, cfg.amountToleranceCents,
        cfg.subsetSum.maxInvoices, cfg.subsetSum.maxCandidates,
      );
      if (subset && subset.invoices.length >= 2) { chosen = subset; break; }
    }
    if (!chosen) continue;

    const correlation = cuid();
    for (const inv of chosen.invoices) {
      const id = cuid();
      await db.insert(allocations).values({
        id, transaction_id: tx.id, invoice_id: inv.id,
        amount: inv.balance,
        confidence: cfg.ruleConfidence.subsetSum.toFixed(2),
        status: "proposed", source: "auto", rule: "subset_sum", created_by: "matcher",
      });
      await recordAudit(db, {
        entity_type: "allocation", entity_id: id,
        action: "matcher_proposed", actor: "matcher",
        correlation_id: correlation,
        after: { transaction_id: tx.id, invoice_id: inv.id, amount: inv.balance, status: "proposed" },
      });
      fired("subset_sum");
    }
  }
}
