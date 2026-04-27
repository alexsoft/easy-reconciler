import { useAcceptProposal, useRejectProposal } from "../api/queries.js";
import { Money } from "./Money.js";
import type { TransactionDetail } from "../api/types.js";

export function MatcherProposals({ tx }: { tx: TransactionDetail }) {
  const accept = useAcceptProposal(tx.id);
  const reject = useRejectProposal(tx.id);
  if (tx.proposals.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">Matcher proposals</h3>
      {tx.proposals.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-sm border rounded p-2">
          <span className="font-mono text-xs flex-1">{p.invoice_id}</span>
          <span className="text-xs text-gray-500">conf {p.confidence}</span>
          <span className="text-xs text-gray-500">{p.rule}</span>
          <Money cents={p.amount} />
          <button onClick={() => accept.mutate({ id: p.id, version: tx.version })}
            className="px-2 py-0.5 bg-green-600 text-white rounded text-xs">accept</button>
          <button onClick={() => reject.mutate({ id: p.id, version: tx.version })}
            className="px-2 py-0.5 bg-gray-600 text-white rounded text-xs">reject</button>
        </div>
      ))}
    </div>
  );
}
