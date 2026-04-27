import { useState, useEffect } from "react";
import { useSaveAllocations } from "../api/queries.js";
import { InvoicePicker } from "./InvoicePicker.js";
import { Money } from "./Money.js";
import type { TransactionDetail, AllocationDTO } from "../api/types.js";

interface Row { invoice_id: string; invoice_label: string; amount: number; }

export function AllocationsEditor({ tx, customerId }: { tx: TransactionDetail; customerId?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const save = useSaveAllocations(tx.id);

  useEffect(() => {
    setRows(tx.allocations
      .filter((a: AllocationDTO) => a.status === "confirmed" && a.invoice_id)
      .map((a) => ({ invoice_id: a.invoice_id!, invoice_label: a.invoice_id!, amount: a.amount })));
  }, [tx.id, tx.version]);

  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const remaining = tx.amount - sum;

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Allocations</h3>
      {rows.map((r, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <span className="font-mono text-xs flex-1">{r.invoice_label}</span>
          <input type="number" value={r.amount}
            onChange={(e) => setRows((prev) => prev.map((x, i) => i === idx ? { ...x, amount: Number(e.target.value) } : x))}
            className="w-32 px-2 py-1 border rounded text-sm" />
          <button onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))} className="text-red-600 text-sm">×</button>
        </div>
      ))}
      <button onClick={() => setPickerOpen((v) => !v)} className="text-sm text-blue-600">
        {pickerOpen ? "cancel" : "+ add allocation"}
      </button>
      {pickerOpen && (
        <InvoicePicker customerId={customerId} onPick={(inv) => {
          setRows((prev) => [...prev, { invoice_id: inv.id, invoice_label: `${inv.id} (${inv.customer_name})`, amount: Math.min(remaining, inv.balance) }]);
          setPickerOpen(false);
        }} />
      )}
      <div className="text-sm pt-2 border-t flex justify-between">
        <span>Remaining: <Money cents={remaining} /></span>
        <button
          disabled={save.isPending}
          onClick={() => save.mutate({ version: tx.version, allocations: rows.map(({ invoice_id, amount }) => ({ invoice_id, amount })) })}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
          {save.isPending ? "saving…" : "save"}
        </button>
      </div>
      {save.error && (
        <div className="text-sm text-red-700 bg-red-50 p-2 rounded">
          {(save.error as any)?.status === 409
            ? "This transaction was updated by someone else. Refresh to see the latest."
            : "Save failed."}
        </div>
      )}
    </div>
  );
}
