import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import {
  BARAZO_BASE_SCOPES,
  BARAZO_CROSSPOST_SCOPES,
  FALLBACK_SCOPE,
  hasCrossPostScopes,
} from "../auth/scopes.js";
import { userPreferences } from "../db/schema/user-preferences.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const loginQuerySchema = z.object({
  handle: z.string().trim().min(1),
  crosspost: z.enum(["true", "false"]).optional(),
});

const callbackQuerySchema = z.object({
  iss: z.string().min(1),
  code: z.string().min(1),
  state: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME = "barazo_refresh";
const COOKIE_PATH = "/api/auth";

function isDevMode(clientId: string): boolean {
  return clientId.startsWith("http://localhost");
}

// ---------------------------------------------------------------------------
// Auth routes plugin
// ---------------------------------------------------------------------------

/**
 * Authentication routes for AT Protocol OAuth.
 *
 * - GET  /api/auth/login     -- Initiate OAuth flow
 * - GET  /api/auth/callback  -- OAuth callback
 * - POST /api/auth/refresh   -- Refresh session
 * - DELETE /api/auth/session  -- Logout
 * - GET  /api/auth/me        -- Current user info
 */
export function authRoutes(
  oauthClient: NodeOAuthClient,
): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { sessionService, handleResolver, env } = app;
    const dev = isDevMode(env.OAUTH_CLIENT_ID);
    const sessionTtl = env.OAUTH_SESSION_TTL;

    // -------------------------------------------------------------------
    // GET /api/auth/login?handle={handle}
    // -------------------------------------------------------------------

    app.get("/api/auth/login", {
      config: { rateLimit: { max: env.RATE_LIMIT_AUTH, timeWindow: "1 minute" } },
    }, async (request, reply) => {
      const parsed = loginQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid handle" });
      }

      const { handle, crosspost } = parsed.data;

      const requestedScope = crosspost === "true"
        ? BARAZO_CROSSPOST_SCOPES
        : BARAZO_BASE_SCOPES;

      try {
        let redirectUrl: URL;
        try {
          redirectUrl = await oauthClient.authorize(handle, {
            scope: requestedScope,
          });
        } catch {
          // PDS may not support granular scopes -- fall back to transition:generic
          app.log.warn(
            { handle, requestedScope },
            "Granular scopes rejected by PDS, falling back to transition:generic",
          );
          redirectUrl = await oauthClient.authorize(handle, {
            scope: FALLBACK_SCOPE,
          });
        }
        return await reply.status(200).send({ url: redirectUrl.toString() });
      } catch (err: unknown) {
        app.log.error({ err, handle }, "OAuth authorize failed");
        return await reply.status(502).send({ error: "Failed to initiate login" });
      }
    });

    // -------------------------------------------------------------------
    // GET /api/auth/callback?iss={iss}&code={code}&state={state}
    // -------------------------------------------------------------------

    app.get("/api/auth/callback", {
      config: { rateLimit: { max: Math.ceil(env.RATE_LIMIT_AUTH / 2), timeWindow: "1 minute" } },
    }, async (request, reply) => {
      const parsed = callbackQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid callback parameters" });
      }

      const { iss, code, state } = parsed.data;

      // Determine the frontend origin for redirect
      const frontendOrigin = env.CORS_ORIGINS.split(",")[0]?.trim() || "http://localhost:3000";

      try {
        // Build URLSearchParams for the OAuth client callback
        const callbackParams = new URLSearchParams({ iss, code, state });
        const result = await oauthClient.callback(callbackParams);

        // Extract DID from the OAuth session
        const did = result.session.did;

        // Resolve handle from DID via AT Protocol identity layer
        // (PLC directory lookup with Valkey cache + DB fallback)
        const handle = await handleResolver.resolve(did);

        const session = await sessionService.createSession(did, handle);

        // Fire-and-forget profile sync from PDS (never blocks auth flow)
        void app.profileSync.syncProfile(did);

        // Detect cross-post scope grant and persist to user preferences.
        // The tokenSet scope field reflects what the PDS actually granted.
        const grantedScope = (result.session as { tokenSet?: { scope?: string } }).tokenSet?.scope ?? "";
        if (hasCrossPostScopes(grantedScope)) {
          void app.db
            .insert(userPreferences)
            .values({ did, crossPostScopesGranted: true })
            .onConflictDoUpdate({
              target: userPreferences.did,
              set: { crossPostScopesGranted: true, updatedAt: new Date() },
            })
            .catch((dbErr: unknown) => {
              app.log.error({ err: dbErr, did }, "Failed to persist cross-post scope grant");
            });
        }

        // Set refresh cookie (sameSite lax to survive cross-site redirect from PDS)
        void reply.setCookie(COOKIE_NAME, session.sid, {
          httpOnly: true,
          secure: !dev,
          sameSite: "lax",
          path: COOKIE_PATH,
          maxAge: sessionTtl,
        });

        // Redirect to frontend -- no tokens in URL, frontend uses cookie to refresh
        const redirectUrl = new URL("/auth/callback", frontendOrigin);
        redirectUrl.searchParams.set("success", "true");

        return await reply.redirect(redirectUrl.toString(), 302);
      } catch (err: unknown) {
        app.log.error({ err }, "OAuth callback failed");

        // Redirect to frontend with error
        const errorUrl = new URL("/auth/callback", frontendOrigin);
        errorUrl.searchParams.set("error", "OAuth callback failed");
        return await reply.redirect(errorUrl.toString(), 302);
      }
    });

    // -------------------------------------------------------------------
    // GET /api/auth/crosspost-authorize
    // -------------------------------------------------------------------

    app.get("/api/auth/crosspost-authorize", {
      config: { rateLimit: { max: env.RATE_LIMIT_AUTH, timeWindow: "1 minute" } },
    }, async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const token = authHeader.slice("Bearer ".length);
      const session = await sessionService.validateAccessToken(token);
      if (!session) {
        return await reply.status(401).send({ error: "Invalid or expired token" });
      }

      try {
        let redirectUrl: URL;
        try {
          redirectUrl = await oauthClient.authorize(session.handle, {
            scope: BARAZO_CROSSPOST_SCOPES,
          });
        } catch {
          app.log.warn(
            { handle: session.handle },
            "Granular cross-post scopes rejected by PDS, falling back to transition:generic",
          );
          redirectUrl = await oauthClient.authorize(session.handle, {
            scope: FALLBACK_SCOPE,
          });
        }
        return await reply.status(200).send({ url: redirectUrl.toString() });
      } catch (err: unknown) {
        app.log.error({ err, handle: session.handle }, "Cross-post authorize failed");
        return await reply.status(502).send({ error: "Failed to initiate cross-post authorization" });
      }
    });

    // -------------------------------------------------------------------
    // POST /api/auth/refresh
    // -------------------------------------------------------------------

    app.post("/api/auth/refresh", async (request, reply) => {
      const sid = request.cookies[COOKIE_NAME];
      if (!sid) {
        return reply.status(401).send({ error: "No refresh token" });
      }

      try {
        const session = await sessionService.refreshSession(sid);
        if (!session) {
          // Clear the stale cookie
          void reply.clearCookie(COOKIE_NAME, { path: COOKIE_PATH });
          return await reply.status(401).send({ error: "Session expired" });
        }

        // Re-set refresh cookie with refreshed maxAge
        void reply.setCookie(COOKIE_NAME, session.sid, {
          httpOnly: true,
          secure: !dev,
          sameSite: "lax",
          path: COOKIE_PATH,
          maxAge: sessionTtl,
        });

        // Query cross-post scope status from user preferences
        const prefRows = await app.db
          .select({ crossPostScopesGranted: userPreferences.crossPostScopesGranted })
          .from(userPreferences)
          .where(eq(userPreferences.did, session.did));

        return await reply.status(200).send({
          accessToken: session.accessToken,
          expiresAt: session.accessTokenExpiresAt,
          did: session.did,
          handle: session.handle,
          crossPostScopesGranted: prefRows[0]?.crossPostScopesGranted ?? false,
        });
      } catch (err: unknown) {
        app.log.error({ err }, "Session refresh failed");
        return reply.status(502).send({ error: "Service temporarily unavailable" });
      }
    });

    // -------------------------------------------------------------------
    // DELETE /api/auth/session
    // -------------------------------------------------------------------

    app.delete("/api/auth/session", async (request, reply) => {
      const sid = request.cookies[COOKIE_NAME];
      if (!sid) {
        return reply.status(204).send();
      }

      try {
        await sessionService.deleteSession(sid);
      } catch (err: unknown) {
        app.log.error({ err }, "Session deletion failed");
        return reply.status(502).send({ error: "Service temporarily unavailable" });
      }

      // Clear the cookie
      void reply.clearCookie(COOKIE_NAME, { path: COOKIE_PATH });

      return reply.status(204).send();
    });

    // -------------------------------------------------------------------
    // GET /api/auth/me
    // -------------------------------------------------------------------

    app.get("/api/auth/me", async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const token = authHeader.slice("Bearer ".length);

      try {
        const session = await sessionService.validateAccessToken(token);
        if (!session) {
          return await reply.status(401).send({ error: "Invalid or expired token" });
        }

        // Query cross-post scope status from user preferences
        const mePrefRows = await app.db
          .select({ crossPostScopesGranted: userPreferences.crossPostScopesGranted })
          .from(userPreferences)
          .where(eq(userPreferences.did, session.did));

        return await reply.status(200).send({
          did: session.did,
          handle: session.handle,
          crossPostScopesGranted: mePrefRows[0]?.crossPostScopesGranted ?? false,
        });
      } catch (err: unknown) {
        app.log.error({ err }, "Token validation failed");
        return reply.status(502).send({ error: "Service temporarily unavailable" });
      }
    });

    done();
  };
}
