import { describe, it, expect } from "vitest";
import { envSchema, parseEnv } from "../../../src/config/env.js";

describe("envSchema", () => {
  const validEnv = {
    DATABASE_URL: "postgresql://atgora:atgora_dev@localhost:5432/atgora",
    VALKEY_URL: "redis://localhost:6379",
    TAP_URL: "http://localhost:2480",
    TAP_ADMIN_PASSWORD: "tap_dev_secret",
    HOST: "0.0.0.0",
    PORT: "3000",
    LOG_LEVEL: "info",
    CORS_ORIGINS: "http://localhost:3001",
    COMMUNITY_MODE: "single",
  };

  it("parses valid environment variables", () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
      expect(result.data.LOG_LEVEL).toBe("info");
      expect(result.data.COMMUNITY_MODE).toBe("single");
    }
  });

  it("rejects missing DATABASE_URL", () => {
    const { DATABASE_URL: _, ...env } = validEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("rejects missing VALKEY_URL", () => {
    const { VALKEY_URL: _, ...env } = validEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("rejects missing TAP_URL", () => {
    const { TAP_URL: _, ...env } = validEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("rejects missing TAP_ADMIN_PASSWORD", () => {
    const { TAP_ADMIN_PASSWORD: _, ...env } = validEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("applies default values for optional fields", () => {
    const result = envSchema.safeParse({
      DATABASE_URL: validEnv.DATABASE_URL,
      VALKEY_URL: validEnv.VALKEY_URL,
      TAP_URL: validEnv.TAP_URL,
      TAP_ADMIN_PASSWORD: validEnv.TAP_ADMIN_PASSWORD,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HOST).toBe("0.0.0.0");
      expect(result.data.PORT).toBe(3000);
      expect(result.data.LOG_LEVEL).toBe("info");
      expect(result.data.CORS_ORIGINS).toBe("http://localhost:3001");
      expect(result.data.COMMUNITY_MODE).toBe("single");
      expect(result.data.RATE_LIMIT_AUTH).toBe(10);
      expect(result.data.RATE_LIMIT_WRITE).toBe(10);
      expect(result.data.RATE_LIMIT_READ_ANON).toBe(100);
      expect(result.data.RATE_LIMIT_READ_AUTH).toBe(300);
    }
  });

  it("rejects invalid PORT (non-numeric)", () => {
    const result = envSchema.safeParse({ ...validEnv, PORT: "abc" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid COMMUNITY_MODE", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      COMMUNITY_MODE: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts global COMMUNITY_MODE", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      COMMUNITY_MODE: "global",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.COMMUNITY_MODE).toBe("global");
    }
  });

  it("accepts optional GLITCHTIP_DSN", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      GLITCHTIP_DSN: "https://key@glitchtip.example.com/1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GLITCHTIP_DSN).toBe(
        "https://key@glitchtip.example.com/1",
      );
    }
  });

  it("accepts optional EMBEDDING_URL", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      EMBEDDING_URL: "https://api.openrouter.ai/v1/embeddings",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.EMBEDDING_URL).toBe(
        "https://api.openrouter.ai/v1/embeddings",
      );
    }
  });
});

describe("parseEnv", () => {
  it("throws on invalid environment", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
