import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { transactionRoutes } from "./routes/transactions.js";
import { matcherRoutes } from "./routes/matcher.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(transactionRoutes);
await app.register(matcherRoutes);

app.get("/api/health", async () => ({ ok: true }));

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
