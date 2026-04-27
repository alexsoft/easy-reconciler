import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { audit_log } from "../db/schema.js";

export async function auditRoutes(app: FastifyInstance) {
  app.get("/api/audit", async (req) => {
    const q = z.object({
      entity_id: z.string(),
      limit: z.coerce.number().int().max(200).default(50),
    }).parse(req.query);
    return db.select().from(audit_log)
      .where(eq(audit_log.entity_id, q.entity_id))
      .orderBy(desc(audit_log.created_at))
      .limit(q.limit);
  });
}
