import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import * as Sentry from "@sentry/node";
import type { FastifyError } from "fastify";
import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import type { Env } from "./config/env.js";
import { createDb } from "./db/index.js";
import { createCache } from "./cache/index.js";
import { FirehoseService } from "./firehose/service.js";
import { createOAuthClient } from "./auth/oauth-client.js";
import { createSessionService } from "./auth/session.js";
import type { SessionService } from "./auth/session.js";
import healthRoutes from "./routes/health.js";
import { oauthMetadataRoutes } from "./routes/oauth-metadata.js";
import { authRoutes } from "./routes/auth.js";
import type { Database } from "./db/index.js";
import type { Cache } from "./cache/index.js";

// Extend Fastify types with decorated properties
declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    cache: Cache;
    env: Env;
    firehose: FirehoseService;
    oauthClient: NodeOAuthClient;
    sessionService: SessionService;
  }
}

export async function buildApp(env: Env) {
  // Initialize GlitchTip/Sentry if DSN provided
  if (env.GLITCHTIP_DSN) {
    Sentry.init({
      dsn: env.GLITCHTIP_DSN,
      environment:
        env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace"
          ? "development"
          : "production",
    });
  }

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace"
        ? { transport: { target: "pino-pretty" } }
        : {}),
    },
    trustProxy: true,
  });

  // Database
  const { db, client: dbClient } = createDb(env.DATABASE_URL);
  app.decorate("db", db);
  app.decorate("env", env);

  // Cache
  const cache = createCache(env.VALKEY_URL, app.log);
  app.decorate("cache", cache);

  // Firehose
  const firehose = new FirehoseService(db, app.log, env);
  app.decorate("firehose", firehose);

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  // CORS
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_READ_ANON,
    timeWindow: "1 minute",
  });

  // Cookies (must be registered before auth routes)
  await app.register(cookie, { secret: env.SESSION_SECRET });

  // OAuth client
  const oauthClient = createOAuthClient(env, cache, app.log);
  app.decorate("oauthClient", oauthClient);

  // Session service
  const sessionService = createSessionService(cache, app.log, {
    sessionTtl: env.OAUTH_SESSION_TTL,
    accessTokenTtl: env.OAUTH_ACCESS_TOKEN_TTL,
  });
  app.decorate("sessionService", sessionService);

  // Routes
  await app.register(healthRoutes);
  await app.register(oauthMetadataRoutes(oauthClient));
  await app.register(authRoutes(oauthClient));

  // Start firehose when app is ready
  app.addHook("onReady", async () => {
    await firehose.start();
  });

  // Graceful shutdown: stop firehose before closing DB
  app.addHook("onClose", async () => {
    app.log.info("Shutting down...");
    await firehose.stop();
    await cache.quit();
    await dbClient.end();
    app.log.info("Connections closed");
  });

  // GlitchTip error handler
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (env.GLITCHTIP_DSN) {
      Sentry.captureException(error);
    }
    app.log.error(
      { err: error, requestId: request.id },
      "Unhandled error",
    );
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: "Internal Server Error",
      message:
        env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace"
          ? error.message
          : "An unexpected error occurred",
      statusCode,
    });
  });

  return app;
}
