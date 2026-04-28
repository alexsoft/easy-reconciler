import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR4NameAmountDate } from '../../src/matcher/rules/r4-name-amount-date.js';
import { matcherConfig } from '../../src/matcher/config.js';

describe('R4 name+amount+date', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('matches normalized customer name with single open invoice', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-A',
      type: 'invoice',
      customer_id: 'C1',
      customer_name: 'Initech Luxembourg SARL',
      customer_vat: 'LU0',
      issue_date: '2026-02-12',
      due_date: '2026-03-14',
      currency: 'EUR',
      subtotal: 1000,
      tax_total: 0,
      total: 1000,
    });
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-02-25',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'INITECHLUXEMBOURGSARL',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR4NameAmountDate(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.rule).toBe('name_amount_date');
  });

  it('does not match when amount has multiple candidates', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values([
      {
        id: 'INV-A',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-02-01',
        due_date: '2026-03-01',
        currency: 'EUR',
        subtotal: 1000,
        tax_total: 0,
        total: 1000,
      },
      {
        id: 'INV-B',
        type: 'invoice',
        customer_id: 'C1',
        customer_name: 'Acme',
        customer_vat: 'LU0',
        issue_date: '2026-02-01',
        due_date: '2026-03-01',
        currency: 'EUR',
        subtotal: 1000,
        tax_total: 0,
        total: 1000,
      },
    ]);
    await db.insert(transactions).values({
      id: 'T1',
      date: '2026-02-15',
      amount: 1000,
      currency: 'EUR',
      counterparty_name: 'Acme',
      description: 'x',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR4NameAmountDate(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
