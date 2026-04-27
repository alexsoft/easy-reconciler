import type { AuditEvent } from "../api/types.js";
export function AuditDiffModal({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white p-4 rounded shadow max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-2">{event.action}</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <pre className="bg-red-50 p-2 overflow-auto max-h-80">{JSON.stringify(event.before, null, 2)}</pre>
          <pre className="bg-green-50 p-2 overflow-auto max-h-80">{JSON.stringify(event.after, null, 2)}</pre>
        </div>
        <button onClick={onClose} className="mt-2 px-3 py-1 border rounded text-sm">close</button>
      </div>
    </div>
  );
}
