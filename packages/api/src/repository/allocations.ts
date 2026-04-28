import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { allocations } from '../db/schema.js';

export async function getAllocationById(db: DB, id: string) {
  return (await db.select().from(allocations).where(eq(allocations.id, id)).limit(1))[0];
}

export async function setAllocationStatus(db: DB, id: string, status: 'confirmed' | 'rejected') {
  await db
    .update(allocations)
    .set(status === 'confirmed' ? { status, source: 'manual' } : { status })
    .where(eq(allocations.id, id));
}
