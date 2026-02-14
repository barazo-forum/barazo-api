import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import scalarApiReference from "@scalar/fastify-api-reference";
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
import { createAuthMiddleware } from "./auth/middleware.js";
import type { AuthMiddleware, RequestUser } from "./auth/middleware.js";
import healthRoutes from "./routes/health.js";
import { oauthMetadataRoutes } from "./routes/oauth-metadata.js";
import { authRoutes } from "./routes/auth.js";
import { setupRoutes } from "./routes/setup.js";
import { topicRoutes } from "./routes/topics.js";
import { replyRoutes } from "./routes/replies.js";
import { categoryRoutes } from "./routes/categories.js";
import { adminSettingsRoutes } from "./routes/admin-settings.js";
import { reactionRoutes } from "./routes/reactions.js";
import { createRequireAdmin } from "./auth/require-admin.js";
import { createSetupService } from "./setup/service.js";
import type { SetupService } from "./setup/service.js";
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
    authMiddleware: AuthMiddleware;
    setupService: SetupService;
    requireAdmin: ReturnType<typeof createRequireAdmin>;
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
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
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

  // Auth middleware (request decoration must happen before hooks can set the property)
  app.decorateRequest("user", undefined as RequestUser | undefined);
  const authMiddleware = createAuthMiddleware(sessionService, app.log);
  app.decorate("authMiddleware", authMiddleware);

  // Setup service
  const setupService = createSetupService(db, app.log);
  app.decorate("setupService", setupService);

  // Admin middleware
  const requireAdmin = createRequireAdmin(db, authMiddleware, app.log);
  app.decorate("requireAdmin", requireAdmin);

  // OpenAPI documentation (register before routes so schemas are collected)
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Barazo Forum API",
        description:
          "AT Protocol forum AppView -- portable identity, federated communities.",
        version: "0.1.0",
      },
      servers: [
        {
          url: env.CORS_ORIGINS.split(",")[0]?.trim() ?? "http://localhost:3000",
          description: "Primary server",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "Access token from /api/auth/callback or /api/auth/refresh",
          },
        },
      },
    },
  });

  await app.register(scalarApiReference, {
    routePrefix: "/docs",
    configuration: {
      theme: "kepler",
    },
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(oauthMetadataRoutes(oauthClient));
  await app.register(authRoutes(oauthClient));
  await app.register(setupRoutes());
  await app.register(topicRoutes());
  await app.register(replyRoutes());
  await app.register(categoryRoutes());
  await app.register(adminSettingsRoutes());
  await app.register(reactionRoutes());

  // OpenAPI spec endpoint (after routes so all schemas are registered)
  app.get("/api/openapi.json", { schema: { hide: true } }, async (_request, reply) => {
    return reply
      .header("Content-Type", "application/json")
      .send(app.swagger());
  });

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
