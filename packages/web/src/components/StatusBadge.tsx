import clsx from 'clsx';
const styles: Record<string, string> = {
  unmatched: 'bg-gray-200 text-gray-800',
  auto_matched: 'bg-green-100 text-green-800',
  partially_allocated: 'bg-yellow-100 text-yellow-800',
  needs_review: 'bg-orange-100 text-orange-800',
  unrelated: 'bg-slate-200 text-slate-700',
  payout_batch: 'bg-purple-100 text-purple-800',
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('px-2 py-0.5 text-xs rounded', styles[status] ?? 'bg-gray-100')}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
