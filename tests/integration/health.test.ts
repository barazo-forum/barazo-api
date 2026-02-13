import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
}

interface ReadyResponse {
  status: string;
  checks: Record<string, { status: string; latency?: number }>;
}

/**
 * Integration test: requires PostgreSQL and Valkey running.
 * Uses docker-compose.dev.yml services (start with `pnpm dev:infra` from workspace root).
 */
describe("health routes (integration)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgresql://atgora:atgora_dev@localhost:5432/atgora",
      VALKEY_URL: process.env["VALKEY_URL"] ?? "redis://localhost:6379",
      TAP_URL: process.env["TAP_URL"] ?? "http://localhost:2480",
      TAP_ADMIN_PASSWORD:
        process.env["TAP_ADMIN_PASSWORD"] ?? "tap_dev_secret",
      HOST: "0.0.0.0",
      PORT: 0,
      LOG_LEVEL: "silent",
      CORS_ORIGINS: "http://localhost:3001",
      COMMUNITY_MODE: "single" as const,
      COMMUNITY_NAME: "Test Community",
      RATE_LIMIT_AUTH: 10,
      RATE_LIMIT_WRITE: 10,
      RATE_LIMIT_READ_ANON: 100,
      RATE_LIMIT_READ_AUTH: 300,
      OAUTH_CLIENT_ID:
        "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fauth%2Fcallback",
      OAUTH_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/callback",
      SESSION_SECRET: "integration-test-secret-minimum-32-chars",
      OAUTH_SESSION_TTL: 604800,
      OAUTH_ACCESS_TOKEN_TTL: 900,
    });

    await app.cache.connect();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health returns 200 with version", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.status).toBe("healthy");
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /api/health/ready returns 200 when all services healthy", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health/ready",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ReadyResponse>();
    expect(body.status).toBe("ready");
    expect(body.checks["database"]?.status).toBe("healthy");
    expect(body.checks["cache"]?.status).toBe("healthy");
    expect(typeof body.checks["database"]?.latency).toBe("number");
    expect(typeof body.checks["cache"]?.latency).toBe("number");
  });
});
