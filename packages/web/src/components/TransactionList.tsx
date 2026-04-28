import { useState, useEffect, memo } from 'react';
import { useStats, useTransactions } from '../api/queries.js';
import { StatusBadge } from './StatusBadge.js';
import { Money } from './Money.js';
import type { TransactionListItem } from '../api/types.js';
import clsx from 'clsx';

const TxRow = memo(function TxRow({
  tx,
  selected,
  onSelect,
}: {
  tx: TransactionListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(tx.id)}
      className={clsx('w-full text-left px-3 py-2 border-b hover:bg-gray-50', selected && 'bg-blue-50')}
    >
      <div className="flex justify-between items-start">
        <div className="font-mono text-xs text-gray-600">{tx.id}</div>
        <Money cents={tx.amount} />
      </div>
      <div className="text-sm truncate">{tx.counterparty_name}</div>
      <div className="flex justify-between items-center mt-1">
        <span className="text-xs text-gray-500">{tx.date}</span>
        <StatusBadge status={tx.status} />
      </div>
    </button>
  );
});

const FILTERS = [
  'all',
  'needs_review',
  'auto_matched',
  'manually_matched',
  'unmatched',
  'unrelated',
  'partially_allocated',
  'payout_batch',
];

export function TransactionList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (search.length === 1) {
      return;
    }
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const stats = useStats();
  const list = useTransactions({ status: status === 'all' ? undefined : status, search: debouncedSearch || undefined });

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 space-y-2 border-b">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={clsx(
                'px-2 py-1 text-xs rounded border',
                status === f ? 'bg-blue-600 text-white border-blue-700' : 'bg-white hover:bg-gray-50',
              )}
            >
              {f.replace(/_/g, ' ')}{' '}
              {f !== 'all' && stats.data?.[f] !== undefined && <span className="opacity-70">({stats.data[f]})</span>}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search id/counterparty/description"
          className="w-full px-2 py-1 border rounded text-sm"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {list.isLoading && <div className="p-3 text-sm text-gray-500">loading…</div>}
        {list.data?.map((t) => (
          <TxRow key={t.id} tx={t} selected={selectedId === t.id} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
