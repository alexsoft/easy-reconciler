import { useState } from "react";
import { useAudit } from "../api/queries.js";
import type { AuditEvent } from "../api/types.js";
import { AuditDiffModal } from "./AuditDiffModal.js";

export function AuditLog({ entityId }: { entityId: string }) {
  const audit = useAudit(entityId);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  return (
    <div className="h-full overflow-auto p-3 border-l">
      <h3 className="font-semibold text-sm mb-2">Audit log</h3>
      {audit.data?.length === 0 && <div className="text-xs text-gray-500">no events</div>}
      {audit.data?.map((e) => (
        <button key={e.id} onClick={() => setOpen(e)}
          className="w-full text-left text-xs border-b py-1 hover:bg-gray-50">
          <div className="text-gray-500">{new Date(e.created_at).toLocaleString()}</div>
          <div><span className="font-medium">{e.actor}</span> · {e.action}</div>
        </button>
      ))}
      {open && <AuditDiffModal event={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
