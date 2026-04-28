import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactionRoutes } from '../../src/routes/transactions.js';
import { runMatcher } from '../../src/matcher/pipeline.js';
import { transactions, invoices } from '../../src/db/schema.js';

async function buildApp() {
  const app = Fastify();
  await app.register(transactionRoutes);
  return app;
}

describe('transactions API', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('GET /api/transactions returns all', async () => {
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
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'p INV-A',
      structured_reference: 'INV-A',
      dedup_hash: 'h1',
    });
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/api/transactions' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.payload)).toHaveLength(1);
    await app.close();
  });

  it('GET /api/transactions/:id returns proposals + allocations', async () => {
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
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-01-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'x',
      description: 'p',
      structured_reference: 'INV-A',
      dedup_hash: 'h1',
    });
    await runMatcher(db);
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/api/transactions/T1' });
    const body = JSON.parse(r.payload);
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0].status).toBe('confirmed');
    await app.close();
  });
});
