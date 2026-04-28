import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { runMatcher } from '../matcher/pipeline.js';

export async function matcherRoutes(app: FastifyInstance) {
  app.post('/api/matcher/run', async () => runMatcher(db));
}
