import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { upsertProposed } from '../../src/matcher/upsert-allocation.js';
import cuid from 'cuid';
import { eq } from 'drizzle-orm';

async function seed(db: any) {
  await db.insert(invoices).values({
    id: 'INV-A',
    type: 'invoice',
    customer_id: 'C1',
    customer_name: 'X',
    customer_vat: 'LU0',
    issue_date: '2026-01-01',
    due_date: '2026-02-01',
    currency: 'EUR',
    subtotal: 1000,
    tax_total: 0,
    total: 1000,
  });
  await db.insert(transactions).values({
    id: 'TXN-1',
    date: '2026-03-01',
    amount: 1000,
    currency: 'EUR',
    counterparty_name: 'x',
    description: 'x',
    dedup_hash: 'h1',
  });
}

describe('upsertProposed', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('inserts new allocation as confirmed when bucket is auto_confirm', async () => {
    const { db } = await getTestDb();
    await seed(db);
    const r = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 1.0,
      rule: 'exact_ref',
      bucket: 'auto_confirm',
    });
    expect(r.action).toBe('inserted_confirmed');
    const rows = await db.select().from(allocations);
    expect(rows[0]!.status).toBe('confirmed');
  });

  it('inserts new allocation as proposed when bucket is propose', async () => {
    const { db } = await getTestDb();
    await seed(db);
    const r = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.8,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    expect(r.action).toBe('inserted_proposed');
  });

  it('does not modify a confirmed row (matcher invariant)', async () => {
    const { db } = await getTestDb();
    await seed(db);
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: '1.00',
      status: 'confirmed',
      source: 'manual',
      rule: null,
      created_by: 'reviewer',
    });
    const r = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 999,
      confidence: 0.5,
      rule: 'exact_ref',
      bucket: 'propose',
    });
    expect(r.action).toBe('skipped_non_proposed');
    const row = (await db.select().from(allocations).where(eq(allocations.transaction_id, 'TXN-1')))[0]!;
    expect(row.amount).toBe(1000);
    expect(row.source).toBe('manual');
  });

  it('updates a proposed row only when fields change', async () => {
    const { db } = await getTestDb();
    await seed(db);
    await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.8,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    const second = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.8,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    expect(second.action).toBe('unchanged');
    const third = await upsertProposed(db, {
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 1000,
      confidence: 0.85,
      rule: 'name_amount_date',
      bucket: 'propose',
    });
    expect(third.action).toBe('updated');
  });
});
