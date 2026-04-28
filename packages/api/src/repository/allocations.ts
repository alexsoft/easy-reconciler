import { eq } from 'drizzle-orm';
import type { DBOrTx } from '../db/client.js';
import { allocations } from '../db/schema.js';

export async function getAllocationById(db: DBOrTx, id: string) {
  return (await db.select().from(allocations).where(eq(allocations.id, id)).limit(1))[0];
}

export async function setAllocationConfirmed(db: DBOrTx, id: string) {
  await db.update(allocations).set({ status: 'confirmed', source: 'manual' }).where(eq(allocations.id, id));
}

export async function setAllocationRejected(db: DBOrTx, id: string) {
  await db.update(allocations).set({ status: 'rejected' }).where(eq(allocations.id, id));
}
