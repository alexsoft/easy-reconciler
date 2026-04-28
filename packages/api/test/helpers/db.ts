import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from '../../src/db/schema.js';
import { sql } from 'drizzle-orm';

let pool: pg.Pool | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export async function getTestDb() {
  if (!db) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  }
  return { db, pool: pool! };
}

export async function truncateAll() {
  const { db } = await getTestDb();
  await db.execute(sql`
    truncate table audit_log, payout_items, payout_batches,
      allocations, transactions, invoice_lines, invoices
      restart identity cascade;
  `);
}

export async function closeTestDb() {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
