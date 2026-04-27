export const toCents = (eur: number): number => Math.round(eur * 100);
export const fromCents = (cents: number): number => cents / 100;

export const formatEUR = (cents: number): string =>
  new Intl.NumberFormat("de-LU", { style: "currency", currency: "EUR" }).format(
    fromCents(cents),
  );
