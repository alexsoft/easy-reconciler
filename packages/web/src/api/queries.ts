import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import type { TransactionListItem, TransactionDetail, InvoiceListItem, AuditEvent } from './types.js';

export const keys = {
  txs: (filter: { status?: string; search?: string }) => ['transactions', filter] as const,
  tx: (id: string) => ['transaction', id] as const,
  stats: () => ['stats'] as const,
  audit: (id: string) => ['audit', id] as const,
  invoices: (q: { customer_id?: string; search?: string }) => ['invoices', q] as const,
};

export function useTransactions(filter: { status?: string; search?: string }) {
  return useQuery({
    queryKey: keys.txs(filter),
    queryFn: () => {
      const p = new URLSearchParams();
      if (filter.status) {
        p.set('status', filter.status);
      }
      if (filter.search) {
        p.set('search', filter.search);
      }
      return api.get<TransactionListItem[]>(`/api/transactions?${p}`);
    },
  });
}

export function useTransaction(id: string | null) {
  return useQuery({
    queryKey: keys.tx(id!),
    enabled: !!id,
    queryFn: () => api.get<TransactionDetail>(`/api/transactions/${id}`),
  });
}

export function useStats() {
  return useQuery({
    queryKey: keys.stats(),
    queryFn: () => api.get<Record<string, number>>('/api/transactions/stats'),
    staleTime: 10_000,
  });
}

export function useAudit(id: string | null) {
  return useQuery({
    queryKey: keys.audit(id!),
    enabled: !!id,
    queryFn: () => api.get<AuditEvent[]>(`/api/audit?${new URLSearchParams({ entity_id: id! })}`),
    staleTime: 10_000,
  });
}

export function useInvoices(q: { customer_id?: string; search?: string }) {
  return useQuery({
    queryKey: keys.invoices(q),
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.customer_id) {
        p.set('customer_id', q.customer_id);
      }
      if (q.search) {
        p.set('search', q.search);
      }
      return api.get<InvoiceListItem[]>(`/api/invoices?${p}`);
    },
  });
}

export function invalidateTx(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: keys.tx(id) });
  qc.invalidateQueries({ queryKey: keys.audit(id) });
  qc.invalidateQueries({ queryKey: keys.stats() });
  qc.invalidateQueries({ queryKey: ['transactions'] });
}

export function useSaveAllocations(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { version: number; allocations: { invoice_id: string; amount: number }[] }) =>
      api.put(`/api/transactions/${txId}/allocations`, input),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useAcceptProposal(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      api.post(`/api/proposals/${input.id}/accept`, { version: input.version }),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useRejectProposal(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      api.post(`/api/proposals/${input.id}/reject`, {
        version: input.version,
      }),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useMarkUnrelated(txId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { version: number }) => api.post(`/api/transactions/${txId}/mark-unrelated`, input),
    onSuccess: () => invalidateTx(qc, txId),
  });
}

export function useRunMatcher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/matcher/run', {}),
    onSuccess: () => qc.invalidateQueries(),
  });
}
