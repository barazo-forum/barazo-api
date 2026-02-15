import { z } from "zod/v4";

const portSchema = z
  .string()
  .default("3000")
  .transform((val) => Number(val))
  .pipe(z.number().int().min(1).max(65535));

const intFromString = (defaultVal: string) =>
  z
    .string()
    .default(defaultVal)
    .transform((val) => Number(val))
    .pipe(z.number().int().min(0));

const positiveIntFromString = (defaultVal: string) =>
  z
    .string()
    .default(defaultVal)
    .transform((val) => Number(val))
    .pipe(z.number().int().positive());

export const envSchema = z.object({
  // Required
  DATABASE_URL: z.url(),
  VALKEY_URL: z.url(),
  TAP_URL: z.url(),
  TAP_ADMIN_PASSWORD: z.string().min(1),

  // Server
  HOST: z.string().default("0.0.0.0"),
  PORT: portSchema,
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // CORS
  CORS_ORIGINS: z.string().default("http://localhost:3001"),

  // Community
  COMMUNITY_MODE: z.enum(["single", "global"]).default("single"),
  COMMUNITY_DID: z.string().optional(),
  COMMUNITY_NAME: z.string().default("Barazo Community"),

  // Rate Limiting (requests per minute)
  RATE_LIMIT_AUTH: intFromString("10"),
  RATE_LIMIT_WRITE: intFromString("10"),
  RATE_LIMIT_READ_ANON: intFromString("100"),
  RATE_LIMIT_READ_AUTH: intFromString("300"),

  // OAuth
  OAUTH_CLIENT_ID: z.string().min(1),
  OAUTH_REDIRECT_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  OAUTH_SESSION_TTL: positiveIntFromString("604800"),
  OAUTH_ACCESS_TOKEN_TTL: positiveIntFromString("900"),

  // Monitoring (GlitchTip - Sentry SDK compatible)
  GLITCHTIP_DSN: z.string().optional(),

  // Optional: semantic search
  EMBEDDING_URL: z.string().optional(),
  AI_EMBEDDING_DIMENSIONS: z
    .string()
    .default("768")
    .transform((val) => Number(val))
    .pipe(z.number().int().min(384).max(1536)),

  // Cross-posting
  FEATURE_CROSSPOST_BLUESKY: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  FEATURE_CROSSPOST_FRONTPAGE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  PUBLIC_URL: z.string().default("http://localhost:3001"),

  // Global mode: operator DIDs (comma-separated)
  OPERATOR_DIDS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),

  // Ozone labeler (opt-in)
  OZONE_LABELER_URL: z.string().default("https://mod.bsky.app"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(env: Record<string, unknown>): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const formatted = z.prettifyError(result.error);
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}
