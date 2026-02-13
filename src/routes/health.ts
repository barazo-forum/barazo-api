import type { FastifyPluginCallback } from "fastify";
import { sql } from "drizzle-orm";

const healthRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get("/api/health", async (_request, reply) => {
    return reply.send({
      status: "healthy",
      version: "0.1.0",
      uptime: process.uptime(),
    });
  });

  fastify.get("/api/health/ready", async (_request, reply) => {
    const checks: Record<string, { status: string; latency?: number }> = {};

    // Check database
    const dbStart = performance.now();
    try {
      await fastify.db.execute(sql`SELECT 1`);
      checks["database"] = {
        status: "healthy",
        latency: Math.round(performance.now() - dbStart),
      };
    } catch {
      checks["database"] = { status: "unhealthy" };
    }

    // Check cache
    const cacheStart = performance.now();
    try {
      await fastify.cache.ping();
      checks["cache"] = {
        status: "healthy",
        latency: Math.round(performance.now() - cacheStart),
      };
    } catch {
      checks["cache"] = { status: "unhealthy" };
    }

    const allHealthy = Object.values(checks).every(
      (c) => c.status === "healthy",
    );

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? "ready" : "degraded",
      checks,
    });
  });

  done();
};

export default healthRoutes;
