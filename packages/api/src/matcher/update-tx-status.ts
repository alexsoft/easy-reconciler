import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { transactions, allocations } from '../db/schema.js';

export async function recomputeTxStatus(db: DB, txId: string): Promise<void> {
  const tx = (await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1))[0];
  if (!tx) {
    return;
  }
  if (tx.status === 'unrelated' || tx.status === 'payout_batch') {
    return;
  }

  const confirmedRows = await db
    .select({ amount: allocations.amount, source: allocations.source })
    .from(allocations)
    .where(and(eq(allocations.transaction_id, txId), eq(allocations.status, 'confirmed')));
  const proposed = await db
    .select({ count: sql<string>`count(*)` })
    .from(allocations)
    .where(and(eq(allocations.transaction_id, txId), eq(allocations.status, 'proposed')));

  const confirmedSum = confirmedRows.reduce((s, r) => s + r.amount, 0);
  const hasManual = confirmedRows.some((r) => r.source === 'manual');
  const proposedCount = Number(proposed[0]?.count ?? 0);

  let nextStatus: string;
  if (confirmedSum > 0 && confirmedSum >= tx.amount) {
    nextStatus = hasManual ? 'manually_matched' : 'auto_matched';
  } else if (confirmedSum > 0) {
    nextStatus = 'partially_allocated';
  } else if (proposedCount > 0) {
    nextStatus = 'needs_review';
  } else {
    nextStatus = 'unmatched';
  }

  if (nextStatus !== tx.status) {
    await db
      .update(transactions)
      .set({ status: nextStatus, updated_at: sql`now()` })
      .where(eq(transactions.id, txId));
  }
}
