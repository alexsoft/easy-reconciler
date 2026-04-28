import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { invoices } from '../../db/schema.js';
import type { MatcherConfig } from '../config.js';
import { invoiceBalance } from '../balance.js';

export async function runR6CreditNoteNet(db: DB, cfg: MatcherConfig, fired: (rule: string) => void): Promise<void> {
  const creditNotes = await db.select().from(invoices).where(eq(invoices.type, 'credit_note'));
  for (const cn of creditNotes) {
    const cnBalance = await invoiceBalance(db, cn.id);
    if (cnBalance <= 0) {
      continue;
    }
    fired('credit_note_net_skipped');
  }
}
