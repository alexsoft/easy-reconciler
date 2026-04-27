import { useState } from "react";
import { TransactionList } from "../components/TransactionList.js";
import { TransactionDetail } from "../components/TransactionDetail.js";
import { AuditLog } from "../components/AuditLog.js";

export function Workspace() {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="h-full grid" style={{ gridTemplateColumns: "35% 45% 20%" }}>
      <TransactionList selectedId={sel} onSelect={setSel} />
      <div className="overflow-hidden">
        {sel ? <TransactionDetail id={sel} /> : <div className="p-6 text-gray-500">Select a transaction to review</div>}
      </div>
      {sel ? <AuditLog entityId={sel} /> : <div className="border-l p-3 text-xs text-gray-500">audit log</div>}
    </div>
  );
}
