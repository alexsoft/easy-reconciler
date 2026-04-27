import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getTestDb, truncateAll, closeTestDb } from "../helpers/db.js";
import { runMatcher } from "../../src/matcher/pipeline.js";

describe("runMatcher", () => {
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("returns an empty report when there are no transactions", async () => {
    const { db } = await getTestDb();
    const report = await runMatcher(db);
    expect(report.totals.examined).toBe(0);
    expect(report.totals.autoConfirmed).toBe(0);
    expect(report.totals.proposed).toBe(0);
  });
});
