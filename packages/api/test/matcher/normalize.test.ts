import { describe, it, expect } from "vitest";
import { normalizeCustomerName, normalizeRef, extractRefsFromText } from "../../src/matcher/normalize.js";

describe("normalizeCustomerName", () => {
  it("strips legal suffixes", () => {
    expect(normalizeCustomerName("Acme S.à r.l.")).toBe("acme");
    expect(normalizeCustomerName("Globex S.A.")).toBe("globex");
    expect(normalizeCustomerName("Initech Luxembourg SARL")).toBe("initech luxembourg");
    expect(normalizeCustomerName("Hooli SARL-S")).toBe("hooli");
  });
  it("strips IBAN tail", () => {
    expect(normalizeCustomerName("Umbrella SCS / IBAN LU28 0019 4006 4475 0000")).toBe("umbrella");
  });
  it("collapses whitespace", () => {
    expect(normalizeCustomerName("INITECHLUXEMBOURGSARL")).toBe("initechluxembourg");
  });
});

describe("normalizeRef", () => {
  it("strips separators and lowercases", () => {
    expect(normalizeRef("INV-2026-0003")).toBe("inv20260003");
    expect(normalizeRef("INV 2026 0003")).toBe("inv20260003");
  });
});

describe("extractRefsFromText", () => {
  it("finds inv-yyyy-nnnn patterns", () => {
    expect(extractRefsFromText("Payment INV-2026-0003 thanks")).toEqual(["INV-2026-0003"]);
    expect(extractRefsFromText("two refs INV-2026-0001 and INV-2026-0009"))
      .toEqual(["INV-2026-0001", "INV-2026-0009"]);
    expect(extractRefsFromText("nothing here")).toEqual([]);
  });
});
