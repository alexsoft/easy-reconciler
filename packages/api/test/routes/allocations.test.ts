import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactionRoutes } from '../../src/routes/transactions.js';
import { allocationsRoutes } from '../../src/routes/allocations.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';

async function buildApp() {
  const app = Fastify();
  await app.register(transactionRoutes);
  await app.register(allocationsRoutes);
  return app;
}

describe('PUT /api/transactions/:id/allocations', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('replaces allocations as confirmed', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
        id: 'I1',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'X',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 500,
        tax_total: 0,
        total: 500,
      },
      {
        id: 'I2',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'X',
        customer_vat: 'LU0',
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        currency: 'EUR',
        subtotal: 500,
        tax_total: 0,
        total: 500,
      },
    ]);
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT',
      url: '/api/transactions/T1/allocations',
      payload: {
        version: 1,
        allocations: [
          { invoice_id: 'I1', amount: 500 },
          { invoice_id: 'I2', amount: 500 },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(2);
    expect(allocs.every((a) => a.status === 'confirmed')).toBe(true);
    await app.close();
  });

  it('returns 409 on stale version', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'I1',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'X',
      customer_vat: 'LU0',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      currency: 'EUR',
      subtotal: 500,
      tax_total: 0,
      total: 500,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 500,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT',
      url: '/api/transactions/T1/allocations',
      payload: { version: 99, allocations: [{ invoice_id: 'I1', amount: 500 }] },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });
});
