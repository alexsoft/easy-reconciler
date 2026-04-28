import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { applyProposal } from '../service/proposal.js';

const Body = z.object({ version: z.number().int() });

export async function proposalsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { version: number } }>('/api/proposals/:id/accept', async (req, reply) => {
    const { version } = Body.parse(req.body);
    const result = await applyProposal(db, req.params.id, 'accept', version);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return { ok: true, version: result.version };
  });

  app.post<{ Params: { id: string }; Body: { version: number } }>('/api/proposals/:id/reject', async (req, reply) => {
    const { version } = Body.parse(req.body);
    const result = await applyProposal(db, req.params.id, 'reject', version);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return { ok: true, version: result.version };
  });
}
