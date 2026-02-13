import { describe, it, expect } from "vitest";
import { envSchema, parseEnv } from "../../../src/config/env.js";

describe("envSchema", () => {
  const validEnv = {
    DATABASE_URL: "postgresql://barazo:barazo_dev@localhost:5432/barazo",
    VALKEY_URL: "redis://localhost:6379",
    TAP_URL: "http://localhost:2480",
    TAP_ADMIN_PASSWORD: "tap_dev_secret",
    OAUTH_CLIENT_ID: "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fauth%2Fcallback",
    OAUTH_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/callback",
    SESSION_SECRET: "a-very-long-session-secret-that-is-at-least-32-characters",
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

  it("rejects missing OAUTH_CLIENT_ID", () => {
    const { OAUTH_CLIENT_ID: _, ...env } = validEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("rejects missing OAUTH_REDIRECT_URI", () => {
    const { OAUTH_REDIRECT_URI: _, ...env } = validEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("rejects missing SESSION_SECRET", () => {
    const { SESSION_SECRET: _, ...env } = validEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("rejects SESSION_SECRET shorter than 32 characters", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      SESSION_SECRET: "too-short",
    });
    expect(result.success).toBe(false);
  });

  it("accepts SESSION_SECRET of exactly 32 characters", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      SESSION_SECRET: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it("applies default values for optional fields", () => {
    const result = envSchema.safeParse({
      DATABASE_URL: validEnv.DATABASE_URL,
      VALKEY_URL: validEnv.VALKEY_URL,
      TAP_URL: validEnv.TAP_URL,
      TAP_ADMIN_PASSWORD: validEnv.TAP_ADMIN_PASSWORD,
      OAUTH_CLIENT_ID: validEnv.OAUTH_CLIENT_ID,
      OAUTH_REDIRECT_URI: validEnv.OAUTH_REDIRECT_URI,
      SESSION_SECRET: validEnv.SESSION_SECRET,
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
      expect(result.data.OAUTH_SESSION_TTL).toBe(604800);
      expect(result.data.OAUTH_ACCESS_TOKEN_TTL).toBe(900);
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

  it("parses OAUTH_SESSION_TTL from string to number", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      OAUTH_SESSION_TTL: "86400",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OAUTH_SESSION_TTL).toBe(86400);
    }
  });

  it("rejects non-positive OAUTH_SESSION_TTL", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      OAUTH_SESSION_TTL: "0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer OAUTH_SESSION_TTL", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      OAUTH_SESSION_TTL: "3.5",
    });
    expect(result.success).toBe(false);
  });

  it("parses OAUTH_ACCESS_TOKEN_TTL from string to number", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      OAUTH_ACCESS_TOKEN_TTL: "1800",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OAUTH_ACCESS_TOKEN_TTL).toBe(1800);
    }
  });

  it("rejects non-positive OAUTH_ACCESS_TOKEN_TTL", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      OAUTH_ACCESS_TOKEN_TTL: "-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("parseEnv", () => {
  it("throws on invalid environment", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
