import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from './helpers/db.js';
import { invoices } from '../src/db/schema.js';

describe('test infra', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('can insert and read', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'TEST-1',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 170,
      total: 1170,
    });
    const rows = await db.select().from(invoices);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(1170);
  });
});
