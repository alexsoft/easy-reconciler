import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { invoices, allocations, transactions } from '../../src/db/schema.js';
import { invoiceBalance, openInvoicesForCustomer } from '../../src/matcher/balance.js';
import cuid from 'cuid';

describe('invoiceBalance', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  async function seedTx(db: any, id: string) {
    await db.insert(transactions).values({
      id,
      date: '2026-03-01',
      amount: 0,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'x',
      dedup_hash: id,
    });
  }

  it('returns invoice total when no allocations exist', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 10000,
      tax_total: 1700,
      total: 11700,
    });
    expect(await invoiceBalance(db, 'INV-A')).toBe(11700);
  });

  it('subtracts confirmed allocations only', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 10000,
      tax_total: 1700,
      total: 11700,
    });
    await seedTx(db, 'TXN-1');
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-1',
      invoice_id: 'INV-A',
      amount: 5000,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    await seedTx(db, 'TXN-2');
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-2',
      invoice_id: 'INV-A',
      amount: 3000,
      status: 'proposed',
      source: 'auto',
      created_by: 'matcher',
    });
    expect(await invoiceBalance(db, 'INV-A')).toBe(11700 - 5000);
  });

  it('openInvoicesForCustomer skips fully-paid', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
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
      },
      {
        id: 'INV-B',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'X',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 2000,
        tax_total: 0,
        total: 2000,
      },
    ]);
    await seedTx(db, 'TXN-X');
    await db.insert(allocations).values({
      id: cuid(),
      transaction_id: 'TXN-X',
      invoice_id: 'INV-A',
      amount: 1000,
      status: 'confirmed',
      source: 'auto',
      created_by: 'matcher',
    });
    const open = await openInvoicesForCustomer(db, 'C1');
    expect(open.map((i) => i.id).sort()).toEqual(['INV-B']);
  });
});
