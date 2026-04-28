import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  bigint,
  integer,
  date,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

const cents = (name: string) => bigint(name, { mode: 'number' }).notNull();
const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'invoice' | 'credit_note'
  customer_id: text('customer_id').notNull(),
  customer_name: text('customer_name').notNull(),
  customer_vat: text('customer_vat').notNull(),
  issue_date: date('issue_date').notNull(),
  due_date: date('due_date').notNull(),
  currency: text('currency').notNull(),
  subtotal: cents('subtotal'),
  tax_total: cents('tax_total'),
  total: cents('total'),
  created_at: now(),
  updated_at: now(),
});

export const invoice_lines = pgTable(
  'invoice_lines',
  {
    id: text('id').primaryKey(),
    invoice_id: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unit_price: cents('unit_price'),
    amount: cents('amount'),
    tax_rate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull(),
  },
  (t) => ({
    invoiceIdx: index('invoice_lines_invoice_idx').on(t.invoice_id),
  }),
);

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    date: date('date').notNull(),
    amount: cents('amount'),
    currency: text('currency').notNull(),
    counterparty_name: text('counterparty_name').notNull(),
    structured_reference: text('structured_reference'),
    description: text('description').notNull(),
    dedup_hash: text('dedup_hash').notNull(),
    status: text('status').notNull().default('unmatched'),
    version: integer('version').notNull().default(1),
    created_at: now(),
    updated_at: now(),
  },
  (t) => ({
    dedupIdx: uniqueIndex('transactions_dedup_idx').on(t.dedup_hash),
    statusIdx: index('transactions_status_idx').on(t.status),
  }),
);

export const allocations = pgTable(
  'allocations',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transactions.id),
    invoice_id: text('invoice_id').references(() => invoices.id),
    amount: cents('amount'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    status: text('status').notNull(),
    source: text('source').notNull(),
    rule: text('rule'),
    created_by: text('created_by').notNull(),
    created_at: now(),
    updated_at: now(),
  },
  (t) => ({
    txInvIdx: uniqueIndex('allocations_tx_inv_idx')
      .on(t.transaction_id, t.invoice_id)
      .where(sql`invoice_id is not null`),
    txIdx: index('allocations_tx_idx').on(t.transaction_id),
    invIdx: index('allocations_invoice_idx').on(t.invoice_id),
  }),
);

export const payout_batches = pgTable(
  'payout_batches',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id').references(() => transactions.id),
    gross_total: cents('gross_total'),
    fee_total: cents('fee_total'),
    net_total: cents('net_total'),
    status: text('status').notNull().default('needs_review'),
  },
  (t) => ({
    txIdx: index('payout_batches_tx_idx').on(t.transaction_id),
  }),
);

export const payout_items = pgTable(
  'payout_items',
  {
    id: text('id').primaryKey(),
    payout_batch_id: text('payout_batch_id')
      .notNull()
      .references(() => payout_batches.id),
    invoice_id: text('invoice_id').references(() => invoices.id),
    customer_name: text('customer_name').notNull(),
    gross_amount: cents('gross_amount'),
    fee: cents('fee'),
    net_amount: cents('net_amount'),
    type: text('type').notNull(),
  },
  (t) => ({
    invoiceIdx: index('payout_items_invoice_idx').on(t.invoice_id),
  }),
);

export const audit_log = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    entity_type: text('entity_type').notNull(),
    entity_id: text('entity_id').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    correlation_id: text('correlation_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    created_at: now(),
  },
  (t) => ({
    entityIdx: index('audit_entity_idx').on(t.entity_id, t.created_at),
  }),
);
