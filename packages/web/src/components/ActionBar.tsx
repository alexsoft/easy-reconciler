import { useMarkUnrelated, useRunMatcher } from '../api/queries.js';
import type { TransactionDetail } from '../api/types.js';

export function ActionBar({ tx }: { tx: TransactionDetail }) {
  const mark = useMarkUnrelated(tx.id);
  const matcher = useRunMatcher();
  return (
    <div className="flex gap-2">
      <button
        onClick={() => {
          if (confirm('Mark as unrelated?')) {
            mark.mutate({ version: tx.version });
          }
        }}
        className="px-3 py-1 border rounded text-sm"
      >
        mark unrelated
      </button>
      <button onClick={() => matcher.mutate()} className="px-3 py-1 border rounded text-sm ml-auto">
        run matcher
      </button>
    </div>
  );
}
