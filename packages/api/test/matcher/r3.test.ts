import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateAll, closeTestDb } from '../helpers/db.js';
import { transactions, invoices, allocations } from '../../src/db/schema.js';
import { runR3FuzzyRef } from '../../src/matcher/rules/r3-fuzzy-ref.js';
import { matcherConfig } from '../../src/matcher/config.js';

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
async function seedTx(db: any, opts: { id: string; ref: string | null; desc: string; amount: number }) {
  await db.insert(transactions).values({
    id: opts.id,
    date: '2026-01-15',
    amount: opts.amount,
    currency: 'EUR',
    counterparty_name: 'x',
    description: opts.desc,
    structured_reference: opts.ref,
    dedup_hash: opts.id,
  });
}

describe('R3 fuzzy ref', () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it('matches separator-stripped ref in description', async () => {
    const { db } = await getTestDb();
    await seedInv(db, 'INV-2026-0003', 1000);
    await seedTx(db, { id: 'T1', ref: null, desc: 'wire INV20260003 today', amount: 1000 });
    await runR3FuzzyRef(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.rule).toBe('fuzzy_ref');
  });

  it('matches with single typo (Levenshtein 1)', async () => {
    const { db } = await getTestDb();
    await seedInv(db, 'INV-2026-0007', 1000);
    await seedTx(db, { id: 'T1', ref: 'INV-2026-0008', desc: 'x', amount: 1000 });
    // ref is distance 1 from INV-2026-0007 — but INV-2026-0008 may not exist.
    await runR3FuzzyRef(db, matcherConfig, () => {});
    const allocs = await db.select().from(allocations);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.invoice_id).toBe('INV-2026-0007');
  });

  it('does not match when amount differs beyond tolerance', async () => {
    const { db } = await getTestDb();
    await seedInv(db, 'INV-2026-0003', 1000);
    await seedTx(db, { id: 'T1', ref: null, desc: 'INV20260003', amount: 99999 });
    await runR3FuzzyRef(db, matcherConfig, () => {});
    expect(await db.select().from(allocations)).toHaveLength(0);
  });
});
