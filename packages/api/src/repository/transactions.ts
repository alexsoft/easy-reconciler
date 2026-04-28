import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { transactions } from '../db/schema.js';

export async function getTxById(db: DB, id: string) {
  return (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
}
