const SUFFIXES = [
  "s.à r.l.",
  "sarl-s",
  "sarl",
  "s.a.",
  "sa",
  "scs",
  "scsp",
];

export function normalizeCustomerName(input: string): string {
  let s = input.toLowerCase();
  // strip IBAN tail and anything after a slash
  s = s.split("/")[0]!.trim();
  s = s.replace(/iban\s*lu\s*[\d\s]*$/, "").trim();
  // strip legal suffixes in order of longest first (to handle overlaps)
  const sortedSuffixes = [...SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suf of sortedSuffixes) {
    // Convert suffix to regex that matches flexible spacing/punctuation
    // e.g., "s.à r.l." -> matches "s à r l" or "s.à r.l." with flexible spacing
    const pattern = suf
      .split(/[\s.]+/)
      .filter((part) => part.length > 0)
      .join("[\\s.]*");
    // Match at word boundary or preceded by a letter, match end with word boundary or end of string
    const re = new RegExp(`(?:^|\\s|(?<=[a-z]))${pattern}(?:\\b|$)`, "gi");
    s = s.replace(re, " ");
  }
  // clean up special characters and normalize whitespace
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return s;
}

export function normalizeRef(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extractRefsFromText(text: string): string[] {
  const re = /INV-\d{4}-\d{4}/g;
  return text.match(re) ?? [];
}
