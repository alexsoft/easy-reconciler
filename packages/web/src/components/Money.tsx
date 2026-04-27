import { formatEUR } from "@reconciler/shared";
export function Money({ cents }: { cents: number }) {
  return <span className={cents < 0 ? "text-red-600" : ""}>{formatEUR(cents)}</span>;
}
