import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { allocations } from '../db/schema.js';

export async function getAllocationById(db: DB, id: string) {
  return (await db.select().from(allocations).where(eq(allocations.id, id)).limit(1))[0];
}
