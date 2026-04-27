import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { sql, eq, and } from "drizzle-orm";
import { getTestDb, closeTestDb } from "../helpers/db.js";
import { transactions, allocations } from "../../src/db/schema.js";

interface Label {
  txn_id: string;
  expected_status: string;
  expected_invoices: string[];
}

const labelsPath = resolve(process.cwd(), "../../task/labels.json");
const labels: Label[] = (
  JSON.parse(readFileSync(labelsPath, "utf-8")) as { labels: Label[] }
).labels;

describe("fixture sweep", () => {
  beforeAll(async () => {
    const { db } = await getTestDb();
    await db.execute(sql`
      truncate table audit_log, payout_items, payout_batches,
        allocations, transactions, invoice_lines, invoices
        restart identity cascade
    `);
    execSync("npx tsx src/db/seed.ts", {
      cwd: "/app/packages/api",
      stdio: "pipe",
      timeout: 60_000,
      env: { ...process.env },
    });
  }, 120_000);

  afterAll(closeTestDb);

  for (const label of labels) {
    it(`${label.txn_id} → ${label.expected_status}`, async () => {
      const { db } = await getTestDb();
      const tx = (
        await db
          .select()
          .from(transactions)
          .where(eq(transactions.id, label.txn_id))
          .limit(1)
      )[0];
      expect(tx, `txn ${label.txn_id} not found`).toBeDefined();
      expect(tx!.status).toBe(label.expected_status);

      if (label.expected_invoices.length > 0) {
        const allocs = await db
          .select()
          .from(allocations)
          .where(
            and(
              eq(allocations.transaction_id, label.txn_id),
              eq(allocations.status, "confirmed"),
            ),
          );
        const invoiceIds = allocs
          .map((a) => a.invoice_id)
          .filter(Boolean)
          .sort() as string[];
        expect(invoiceIds).toEqual(label.expected_invoices.sort());
      }
    });
  }
});
