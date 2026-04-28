import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR2DescriptionRef } from '../../src/matcher/rules/r2-description-ref.js';
import { matcherConfig } from '../../src/matcher/config.js';

describe('R2 description ref', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('matches when ref is in description but structured_reference is null', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-2026-0010',
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
      description: 'Wire transfer for INV-2026-0010 thanks',
      structured_reference: null,
      dedup_hash: 'h1',
    });
    await runR2DescriptionRef(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.rule).toBe('description_ref');
  });

  it('does nothing when structured_reference is already set', async () => {
    const { db } = await getTestDb();
    await db.insert(invoices).values({
      id: 'INV-2026-0010',
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
      description: 'INV-2026-0010',
      structured_reference: 'INV-2026-0010',
      dedup_hash: 'h1',
    });
    await runR2DescriptionRef(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
