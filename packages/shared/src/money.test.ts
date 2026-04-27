import { describe, it, expect } from "vitest";
import { toCents, fromCents, formatEUR } from "./money.js";

describe("money", () => {
  it("rounds floats to integer cents", () => {
    expect(toCents(1123.2)).toBe(112320);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it("round-trips", () => {
    expect(fromCents(toCents(122.85))).toBe(122.85);
  });
  it("formats EUR", () => {
    expect(formatEUR(112320)).toMatch(/1.123,20.*€/);
  });
});
