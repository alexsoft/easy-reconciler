import { useState } from 'react';
import { useInvoices } from '../api/queries.js';
import { formatEUR } from '@reconciler/shared';
import type { InvoiceListItem } from '../api/types.js';

export function InvoicePicker({ customerId, onPick }: { customerId?: string; onPick: (inv: InvoiceListItem) => void }) {
  const [search, setSearch] = useState('');
  const invs = useInvoices({ customer_id: customerId, search: search || undefined });
  return (
    <div className="border rounded p-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="search invoice…"
        className="w-full px-2 py-1 border rounded text-sm mb-2"
      />
      <ul className="max-h-48 overflow-auto">
        {invs.data?.map((i) => (
          <li key={i.id}>
            <button
              onClick={() => onPick(i)}
              className="w-full text-left px-2 py-1 hover:bg-gray-50 text-sm flex justify-between"
            >
              <span className="font-mono text-xs">
                {i.id} {i.type === 'credit_note' && <span className="ml-1 text-purple-600">[CN]</span>}
              </span>
              <span className="text-gray-600">{i.customer_name}</span>
              <span>{formatEUR(i.balance)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
