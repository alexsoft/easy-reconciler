import { sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { transactions } from "../db/schema.js";
import { matcherConfig, type MatcherConfig } from "./config.js";
import { runR1ExactRef } from "./rules/r1-exact-ref.js";
import { runR2DescriptionRef } from "./rules/r2-description-ref.js";
import { runR3FuzzyRef } from "./rules/r3-fuzzy-ref.js";
import { runR4NameAmountDate } from "./rules/r4-name-amount-date.js";
import { recomputeTxStatus } from "./update-tx-status.js";

export interface MatcherReport {
  config: MatcherConfig;
  totals: { examined: number; autoConfirmed: number; proposed: number; markedUnrelated: number; skippedLocked: number; unchanged: number };
  perRule: Record<string, number>;
}

export async function runMatcher(db: DB): Promise<MatcherReport> {
  const report: MatcherReport = {
    config: matcherConfig,
    totals: { examined: 0, autoConfirmed: 0, proposed: 0, markedUnrelated: 0, skippedLocked: 0, unchanged: 0 },
    perRule: {},
  };
  const txs = await db.select().from(transactions);
  report.totals.examined = txs.length;

  const fired = (rule: string) => { report.perRule[rule] = (report.perRule[rule] ?? 0) + 1; };

  await runR1ExactRef(db, matcherConfig, fired);
  await runR2DescriptionRef(db, matcherConfig, fired);
  await runR3FuzzyRef(db, matcherConfig, fired);
  await runR4NameAmountDate(db, matcherConfig, fired);

  for (const tx of txs) await recomputeTxStatus(db, tx.id);

  const stats = await db.select({
    auto: sql<string>`count(*) filter (where status = 'auto_matched')`,
    review: sql<string>`count(*) filter (where status = 'needs_review')`,
  }).from(transactions);
  report.totals.autoConfirmed = Number(stats[0]?.auto ?? 0);
  report.totals.proposed = Number(stats[0]?.review ?? 0);

  return report;
}
