import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { parse as parseCsv } from "csv-parse/sync";
import { db, pool } from "./client.js";
import { invoices, invoice_lines, transactions, payout_batches, payout_items } from "./schema.js";
import {
  InvoiceSchema,
  TransactionSchema,
  toCents,
} from "@reconciler/shared";

const taskDir = resolve(process.cwd(), "../../task");

const dedupHash = (t: { date: string; amount: number; counterparty_name: string; description: string }) =>
  createHash("sha256")
    .update([t.date, t.amount.toString(), t.counterparty_name, t.description].join("|"))
    .digest("hex");

async function seedInvoices() {
  const raw = JSON.parse(readFileSync(`${taskDir}/invoices.json`, "utf-8"));
  const parsed = raw.map((r: unknown) => InvoiceSchema.parse(r));

  for (const inv of parsed) {
    await db
      .insert(invoices)
      .values({
        id: inv.id,
        type: inv.type,
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
        customer_vat: inv.customer_vat,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        currency: inv.currency,
        subtotal: toCents(inv.subtotal),
        tax_total: toCents(inv.tax_total),
        total: toCents(inv.total),
      })
      .onConflictDoUpdate({
        target: invoices.id,
        set: {
          subtotal: toCents(inv.subtotal),
          tax_total: toCents(inv.tax_total),
          total: toCents(inv.total),
          updated_at: sql`now()`,
        },
      });

    for (const line of inv.line_items) {
      await db
        .insert(invoice_lines)
        .values({
          id: line.line_id,
          invoice_id: inv.id,
          description: line.description,
          quantity: line.quantity,
          unit_price: toCents(line.unit_price),
          amount: toCents(line.amount),
          tax_rate: line.tax_rate.toString(),
        })
        .onConflictDoNothing();
    }
  }
  console.log(`seeded ${parsed.length} invoices`);
}

async function seedTransactions() {
  const raw = JSON.parse(readFileSync(`${taskDir}/transactions.json`, "utf-8"));
  const parsed = raw.map((r: unknown) => TransactionSchema.parse(r));

  for (const t of parsed) {
    const cents = toCents(t.amount);
    const hash = dedupHash({
      date: t.date,
      amount: cents,
      counterparty_name: t.counterparty_name,
      description: t.description,
    });
    await db
      .insert(transactions)
      .values({
        id: t.id,
        date: t.date,
        amount: cents,
        currency: t.currency,
        counterparty_name: t.counterparty_name,
        structured_reference: t.structured_reference ?? null,
        description: t.description,
        dedup_hash: hash,
      })
      .onConflictDoNothing({ target: transactions.dedup_hash });
  }
  console.log(`seeded ${parsed.length} transactions`);
}

async function seedPayout() {
  const raw = readFileSync(`${taskDir}/payout_report.csv`, "utf-8");
  const rows = parseCsv(raw, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;

  const totalRow = rows.find((r) => r.type === "payout");
  if (!totalRow) throw new Error("payout total row missing");

  const charges = rows.filter((r) => r.type === "charge");
  const refunds = rows.filter((r) => r.type === "refund");
  const chargebacks = rows.filter((r) => r.type === "chargeback");

  const grossTotal = [...charges, ...refunds, ...chargebacks]
    .reduce((s, r) => s + toCents(Number(r.gross_amount || "0")), 0);
  const feeTotal = [...charges, ...refunds, ...chargebacks]
    .reduce((s, r) => s + toCents(Number(r.fee || "0")), 0);
  const netTotal = toCents(Number(totalRow.net_amount));

  const batchId = totalRow.charge_id;
  await db.insert(payout_batches).values({
    id: batchId,
    transaction_id: null,
    gross_total: grossTotal,
    fee_total: feeTotal,
    net_total: netTotal,
  }).onConflictDoUpdate({
    target: payout_batches.id,
    set: { gross_total: grossTotal, fee_total: feeTotal, net_total: netTotal },
  });

  for (const r of [...charges, ...refunds, ...chargebacks]) {
    await db.insert(payout_items).values({
      id: r.charge_id,
      payout_batch_id: batchId,
      invoice_id: r.invoice_id || null,
      customer_name: r.customer_name,
      gross_amount: toCents(Number(r.gross_amount || "0")),
      fee: toCents(Number(r.fee || "0")),
      net_amount: toCents(Number(r.net_amount || "0")),
      type: r.type as "charge" | "refund" | "chargeback",
    }).onConflictDoNothing();
  }
  console.log(`seeded payout batch with ${charges.length + refunds.length + chargebacks.length} items`);
}

async function main() {
  await seedInvoices();
  await seedTransactions();
  await seedPayout();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
