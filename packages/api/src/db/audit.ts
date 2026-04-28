import cuid from 'cuid';
import type { DB } from './client.js';
import { audit_log } from './schema.js';

export type AuditAction =
  | 'matcher_proposed'
  | 'matcher_updated'
  | 'matcher_auto_confirmed'
  | 'matcher_marked_unrelated'
  | 'matcher_skipped_locked'
  | 'reviewer_confirmed'
  | 'reviewer_rejected'
  | 'reviewer_split'
  | 'reviewer_edited_allocation'
  | 'reviewer_marked_unrelated'
  | 'reviewer_unmarked_unrelated'
  | 'reviewer_attached_credit_note'
  | 'reviewer_confirmed_payout_batch';

export interface AuditEntry {
  entity_type: 'transaction' | 'allocation' | 'payout_batch';
  entity_id: string;
  action: AuditAction;
  actor: 'matcher' | 'reviewer';
  correlation_id?: string;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(tx: DB, entry: AuditEntry): Promise<void> {
  await tx.insert(audit_log).values({
    id: cuid(),
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    action: entry.action,
    actor: entry.actor,
    correlation_id: entry.correlation_id ?? null,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
  });
}
