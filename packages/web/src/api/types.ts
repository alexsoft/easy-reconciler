export type TxStatus =
  | 'unmatched'
  | 'auto_matched'
  | 'manually_matched'
  | 'partially_allocated'
  | 'needs_review'
  | 'unrelated'
  | 'payout_batch';

export interface TransactionListItem {
  id: string;
  date: string;
  amount: number;
  currency: string;
  counterparty_name: string;
  structured_reference: string | null;
  description: string;
  status: TxStatus;
  version: number;
}

export interface AllocationDTO {
  id: string;
  transaction_id: string;
  invoice_id: string | null;
  amount: number;
  confidence: number | null;
  status: 'proposed' | 'confirmed' | 'rejected';
  source: 'auto' | 'manual';
  rule: string | null;
  created_by: string;
}

export interface TransactionDetail extends TransactionListItem {
  allocations: AllocationDTO[];
  proposals: AllocationDTO[];
}

export interface InvoiceListItem {
  id: string;
  type: 'invoice' | 'credit_note';
  customer_id: string;
  customer_name: string;
  currency: string;
  issue_date: string;
  due_date: string;
  total: number;
  allocated: string;
  balance: number;
}

export interface AuditEvent {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  correlation_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}
