import { useTransaction } from "../api/queries.js";
import { Money } from "./Money.js";
import { StatusBadge } from "./StatusBadge.js";
import { AllocationsEditor } from "./AllocationsEditor.js";
import { MatcherProposals } from "./MatcherProposals.js";
import { ActionBar } from "./ActionBar.js";

export function TransactionDetail({ id }: { id: string }) {
  const tx = useTransaction(id);
  if (tx.isLoading) return <div className="p-4 text-sm">loading…</div>;
  if (!tx.data) return <div className="p-4 text-sm text-red-600">not found</div>;
  const t = tx.data;
  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div>
        <div className="flex justify-between items-start">
          <div>
            <div className="font-mono text-sm text-gray-500">{t.id}</div>
            <div className="text-lg font-semibold">{t.counterparty_name}</div>
            <div className="text-sm text-gray-600">{t.description}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl"><Money cents={t.amount} /></div>
            <div className="text-xs text-gray-500">{t.date}</div>
            <StatusBadge status={t.status} />
          </div>
        </div>
      </div>
      <AllocationsEditor tx={t} />
      <MatcherProposals tx={t} />
      <ActionBar tx={t} />
    </div>
  );
}
