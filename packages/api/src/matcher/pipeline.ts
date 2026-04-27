import { eq, and, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { transactions, allocations } from "../db/schema.js";
import { matcherConfig, type MatcherConfig } from "./config.js";

export interface MatcherReport {
  config: MatcherConfig;
  totals: {
    examined: number;
    autoConfirmed: number;
    proposed: number;
    markedUnrelated: number;
    skippedLocked: number;
    unchanged: number;
  };
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

  // Rules invoked here in T11+. Skeleton only for now.
  return report;
}
