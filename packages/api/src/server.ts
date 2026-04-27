import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { transactionRoutes } from "./routes/transactions.js";
import { matcherRoutes } from "./routes/matcher.js";
import { allocationsRoutes } from "./routes/allocations.js";
import { proposalsRoutes } from "./routes/proposals.js";
import { payoutRoutes } from "./routes/payouts.js";
import { auditRoutes } from "./routes/audit.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(transactionRoutes);
await app.register(matcherRoutes);
await app.register(allocationsRoutes);
await app.register(proposalsRoutes);
await app.register(payoutRoutes);
await app.register(auditRoutes);

app.get("/api/health", async () => ({ ok: true }));

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
