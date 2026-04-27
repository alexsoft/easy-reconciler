import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getTestDb, truncateAll, closeTestDb } from "../helpers/db.js";
import { transactions } from "../../src/db/schema.js";
import { runR8Noise } from "../../src/matcher/rules/r8-noise.js";
import { matcherConfig } from "../../src/matcher/config.js";
import { eq } from "drizzle-orm";

describe("R8 noise", () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("marks salary as unrelated", async () => {
    const { db } = await getTestDb();
    await db.insert(transactions).values({
      id: "T1", date: "2026-03-01", amount: -250000, currency: "EUR",
      counterparty_name: "EasyBiz Salary", description: "March salary",
      structured_reference: null, dedup_hash: "h1",
    });
    await runR8Noise(db, matcherConfig, () => {});
    const t = (await db.select().from(transactions).where(eq(transactions.id, "T1")))[0]!;
    expect(t.status).toBe("unrelated");
  });
});
