import { and, eq, sql } from 'drizzle-orm';
import cuid from 'cuid';
import type { DB } from '../db/client.js';
import { allocations } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import type { Bucket } from './score.js';

export interface UpsertInput {
  transaction_id: string;
  invoice_id: string;
  amount: number;
  confidence: number;
  rule: string;
  bucket: Exclude<Bucket, 'skip'>;
}

export type UpsertAction =
  | 'inserted_proposed'
  | 'inserted_confirmed'
  | 'updated'
  | 'unchanged'
  | 'skipped_non_proposed';

export interface UpsertResult {
  action: UpsertAction;
  allocation_id?: string;
}

export async function upsertProposed(db: DB, input: UpsertInput): Promise<UpsertResult> {
  const existing = await db
    .select()
    .from(allocations)
    .where(and(eq(allocations.transaction_id, input.transaction_id), eq(allocations.invoice_id, input.invoice_id)))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    if (row.status !== 'proposed') {
      return { action: 'skipped_non_proposed', allocation_id: row.id };
    }

    const sameAmount = row.amount === input.amount;
    const sameConf = Number(row.confidence) === input.confidence;
    const sameRule = row.rule === input.rule;
    if (sameAmount && sameConf && sameRule) {
      return { action: 'unchanged', allocation_id: row.id };
    }
    await db
      .update(allocations)
      .set({
        amount: input.amount,
        confidence: input.confidence.toFixed(2),
        rule: input.rule,
        updated_at: sql`now()`,
      })
      .where(eq(allocations.id, row.id));
    await recordAudit(db, {
      entity_type: 'allocation',
      entity_id: row.id,
      action: 'matcher_updated',
      actor: 'matcher',
      before: row,
      after: { ...row, amount: input.amount, confidence: input.confidence, rule: input.rule },
    });
    return { action: 'updated', allocation_id: row.id };
  }

  const id = cuid();
  const status = input.bucket === 'auto_confirm' ? 'confirmed' : 'proposed';
  await db.insert(allocations).values({
    id,
    transaction_id: input.transaction_id,
    invoice_id: input.invoice_id,
    amount: input.amount,
    confidence: input.confidence.toFixed(2),
    status,
    source: 'auto',
    rule: input.rule,
    created_by: 'matcher',
  });
  await recordAudit(db, {
    entity_type: 'allocation',
    entity_id: id,
    action: status === 'confirmed' ? 'matcher_auto_confirmed' : 'matcher_proposed',
    actor: 'matcher',
    after: {
      transaction_id: input.transaction_id,
      invoice_id: input.invoice_id,
      amount: input.amount,
      status,
      rule: input.rule,
    },
  });
  return {
    action: status === 'confirmed' ? 'inserted_confirmed' : 'inserted_proposed',
    allocation_id: id,
  };
}
