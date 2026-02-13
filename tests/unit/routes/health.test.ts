import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../../src/app.js";
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

describe("health routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      DATABASE_URL: "postgresql://atgora:atgora_dev@localhost:5432/atgora",
      VALKEY_URL: "redis://localhost:6379",
      TAP_URL: "http://localhost:2480",
      TAP_ADMIN_PASSWORD: "tap_dev_secret",
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
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/health", () => {
    it("returns 200 with status healthy", async () => {
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
  });

  describe("GET /api/health/ready", () => {
    it("returns dependency check results", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/health/ready",
      });

      const body = response.json<ReadyResponse>();
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("checks");
      expect(body.checks).toHaveProperty("database");
      expect(body.checks).toHaveProperty("cache");
    });
  });
});
