import { eq, and, sql } from 'drizzle-orm';
import type { DB, DBOrTx } from '../db/client.js';
import { allocations, transactions } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import { getAllocationById, setAllocationConfirmed, setAllocationRejected } from '../repository/allocations.js';

export type ProposalResult = { ok: true; version: number } | { ok: false; code: 404 | 409; error: string };

async function bumpTxVersion(db: DBOrTx, txId: string, version: number) {
  const updated = await db
    .update(transactions)
    .set({ version: sql`version + 1`, updated_at: sql`now()` })
    .where(and(eq(transactions.id, txId), eq(transactions.version, version)))
    .returning();
  return updated[0] ?? null;
}

export async function applyProposal(db: DB, proposalId: string, action: 'accept' | 'reject', version: number): Promise<ProposalResult> {
  return db.transaction(async (tx) => {
    const prop = await getAllocationById(tx, proposalId);
    if (!prop || prop.status !== 'proposed') {
      return { ok: false, code: 404, error: 'not_proposed' };
    }
    const txRow = await bumpTxVersion(tx, prop.transaction_id, version);
    if (!txRow) {
      return { ok: false, code: 409, error: 'version_conflict' };
    }
    if (action === 'accept') {
      await setAllocationConfirmed(tx, prop.id);
      await recordAudit(tx, { entity_type: 'allocation', entity_id: prop.id, action: 'reviewer_confirmed', actor: 'reviewer', before: prop, after: { ...prop, status: 'confirmed' } });
    } else {
      await setAllocationRejected(tx, prop.id);
      await recordAudit(tx, { entity_type: 'allocation', entity_id: prop.id, action: 'reviewer_rejected', actor: 'reviewer', before: prop, after: { ...prop, status: 'rejected' } });
    }
    return { ok: true, version: txRow.version };
  });
}
