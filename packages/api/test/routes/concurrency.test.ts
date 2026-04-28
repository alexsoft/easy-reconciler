import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { allocationsRoutes } from '../../src/routes/allocations.js';
import { transactions, invoices } from '../../src/db/schema.js';

describe('concurrency', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('two PUTs on same version: one wins, one 409s', async () => {
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
    const app = Fastify();
    await app.register(allocationsRoutes);

    const [a, b] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: '/api/transactions/T1/allocations',
        payload: { version: 1, allocations: [{ invoice_id: 'I1', amount: 500 }] },
      }),
      app.inject({
        method: 'PUT',
        url: '/api/transactions/T1/allocations',
        payload: { version: 1, allocations: [{ invoice_id: 'I1', amount: 250 }] },
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    await app.close();
  });
});
