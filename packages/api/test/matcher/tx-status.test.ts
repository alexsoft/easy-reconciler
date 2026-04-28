import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { recomputeTxStatus } from '../../src/matcher/update-tx-status.js';
import cuid from 'cuid';
import { eq } from 'drizzle-orm';

async function seedTx(db: any, opts: { id: string; amount: number; status?: string }) {
  await db.insert(transactions).values({
    id: opts.id,
    date: '2026-03-01',
    amount: opts.amount,
    currency: 'EUR',
    counterparty_name: 'x',
    description: 'x',
    dedup_hash: opts.id,
    status: opts.status ?? 'unmatched',
  });
}
async function seedInv(db: any, id: string, total: number) {
  await db.insert(invoices).values({
    id,
    type: 'invoice',
    customer_id: 'C1',
    customer_name: 'X',
    customer_vat: 'LU0',
    issue_date: '2026-01-01',
    due_date: '2026-02-01',
    currency: 'EUR',
    subtotal: total,
    tax_total: 0,
    total,
  });
}

describe('recomputeTxStatus', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('auto_matched when fully covered by confirmed allocations', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000 });
    await seedInv(db, 'I1', 1000);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'T1',
      invoice_id: 'I1',
      amount: 1000,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('auto_matched');
  });

  it('partially_allocated when confirmed sum < tx amount', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000 });
    await seedInv(db, 'I1', 1000);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'T1',
      invoice_id: 'I1',
      amount: 600,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('partially_allocated');
  });

  it('needs_review when only proposed allocations exist', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000 });
    await seedInv(db, 'I1', 1000);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'T1',
      invoice_id: 'I1',
      amount: 1000,
      status: 'proposed',
      source: 'auto',
      created_by: 'matcher',
    });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('needs_review');
  });

  it('preserves explicit unrelated/payout_batch status', async () => {
    const { db } = await getTestDb();
    await seedTx(db, { id: 'T1', amount: 1000, status: 'unrelated' });
    await recomputeTxStatus(db, 'T1');
    const t = (await db.select().from(transactions).where(eq(transactions.id, 'T1')))[0]!;
    expect(t.status).toBe('unrelated');
  });
});
