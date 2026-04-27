import { z } from "zod";

export const InvoiceLineSchema = z.object({
  line_id: z.string(),
  description: z.string(),
  quantity: z.number().int().positive(),
  unit_price: z.number(),
  tax_rate: z.number(),
  amount: z.number(),
});

export const InvoiceSchema = z.object({
  id: z.string(),
  type: z.enum(["invoice", "credit_note"]),
  customer_id: z.string(),
  customer_name: z.string(),
  customer_vat: z.string(),
  issue_date: z.string(),
  due_date: z.string(),
  currency: z.string().length(3),
  line_items: z.array(InvoiceLineSchema),
  subtotal: z.number(),
  tax_total: z.number(),
  total: z.number(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  currency: z.string().length(3),
  counterparty_name: z.string(),
  structured_reference: z.string().nullable().optional(),
  description: z.string(),
});

export const PayoutItemCsvSchema = z.object({
  charge_id: z.string(),
  invoice_id: z.string(),
  customer_name: z.string(),
  gross_amount: z.string(),
  fee: z.string(),
  net_amount: z.string(),
  type: z.enum(["charge", "refund", "chargeback", "payout"]),
});

export type InvoiceInput = z.infer<typeof InvoiceSchema>;
export type TransactionInput = z.infer<typeof TransactionSchema>;
export type PayoutItemCsv = z.infer<typeof PayoutItemCsvSchema>;

export const TxStatus = z.enum([
  "unmatched",
  "auto_matched",
  "partially_allocated",
  "needs_review",
  "unrelated",
  "payout_batch",
]);
export type TxStatus = z.infer<typeof TxStatus>;

export const AllocationStatus = z.enum(["proposed", "confirmed", "rejected"]);
export type AllocationStatus = z.infer<typeof AllocationStatus>;

export const AllocationSource = z.enum(["auto", "manual"]);
export type AllocationSource = z.infer<typeof AllocationSource>;

export const TransactionDTO = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  currency: z.string(),
  counterparty_name: z.string(),
  structured_reference: z.string().nullable(),
  description: z.string(),
  status: TxStatus,
  version: z.number().int(),
});
export type TransactionDTO = z.infer<typeof TransactionDTO>;

export const AllocationDTO = z.object({
  id: z.string(),
  transaction_id: z.string(),
  invoice_id: z.string().nullable(),
  amount: z.number(),
  confidence: z.number().nullable(),
  status: AllocationStatus,
  source: AllocationSource,
  rule: z.string().nullable(),
  created_by: z.string(),
});
export type AllocationDTO = z.infer<typeof AllocationDTO>;
