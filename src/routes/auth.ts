import { z } from "zod/v4";
import type { FastifyPluginCallback } from "fastify";
import type { NodeOAuthClient } from "@atproto/oauth-client-node";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const loginQuerySchema = z.object({
  handle: z.string().trim().min(1),
});

const callbackQuerySchema = z.object({
  iss: z.string().min(1),
  code: z.string().min(1),
  state: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Cookie options helper
// ---------------------------------------------------------------------------

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
    const { sessionService, env } = app;
    const dev = isDevMode(env.OAUTH_CLIENT_ID);
    const sessionTtl = env.OAUTH_SESSION_TTL;

    // Cookie name constant
    const COOKIE_NAME = "atgora_refresh";
    const COOKIE_PATH = "/api/auth";

    // -------------------------------------------------------------------
    // GET /api/auth/login?handle={handle}
    // -------------------------------------------------------------------

    app.get("/api/auth/login", async (request, reply) => {
      const parsed = loginQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid handle" });
      }

      const { handle } = parsed.data;

      try {
        const redirectUrl = await oauthClient.authorize(handle, {
          scope: "atproto transition:generic",
        });
        return await reply.status(200).send({ url: redirectUrl.toString() });
      } catch (err: unknown) {
        app.log.error({ err, handle }, "OAuth authorize failed");
        return await reply.status(502).send({ error: "Failed to initiate login" });
      }
    });

    // -------------------------------------------------------------------
    // GET /api/auth/callback?iss={iss}&code={code}&state={state}
    // -------------------------------------------------------------------

    app.get("/api/auth/callback", async (request, reply) => {
      const parsed = callbackQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid callback parameters" });
      }

      const { iss, code, state } = parsed.data;

      try {
        // Build URLSearchParams for the OAuth client callback
        const callbackParams = new URLSearchParams({ iss, code, state });
        const result = await oauthClient.callback(callbackParams);

        // Extract DID from the OAuth session
        const did = result.session.did;

        // Create our application session
        // The handle is resolved from the DID; for now we use the DID as a
        // placeholder if handle resolution is not available from the OAuth session.
        // In practice, the handle was used to initiate login and can be resolved
        // from the AT Protocol identity layer.
        const handle = did; // Will be resolved properly via identity resolver in production

        const session = await sessionService.createSession(did, handle);

        // Set refresh cookie
        void reply.setCookie(COOKIE_NAME, session.sid, {
          httpOnly: true,
          secure: !dev,
          sameSite: "strict",
          path: COOKIE_PATH,
          maxAge: sessionTtl,
        });

        return await reply.status(200).send({
          accessToken: session.accessToken,
          expiresAt: session.accessTokenExpiresAt,
          did,
          handle: session.handle,
        });
      } catch (err: unknown) {
        app.log.error({ err }, "OAuth callback failed");
        return await reply.status(502).send({ error: "OAuth callback failed" });
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

      const session = await sessionService.refreshSession(sid);
      if (!session) {
        // Clear the stale cookie
        void reply.clearCookie(COOKIE_NAME, { path: COOKIE_PATH });
        return reply.status(401).send({ error: "Session expired" });
      }

      // Re-set refresh cookie with refreshed maxAge
      void reply.setCookie(COOKIE_NAME, session.sid, {
        httpOnly: true,
        secure: !dev,
        sameSite: "strict",
        path: COOKIE_PATH,
        maxAge: sessionTtl,
      });

      return reply.status(200).send({
        accessToken: session.accessToken,
        expiresAt: session.accessTokenExpiresAt,
      });
    });

    // -------------------------------------------------------------------
    // DELETE /api/auth/session
    // -------------------------------------------------------------------

    app.delete("/api/auth/session", async (request, reply) => {
      const sid = request.cookies[COOKIE_NAME];
      if (!sid) {
        return reply.status(204).send();
      }

      await sessionService.deleteSession(sid);

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

      const session = await sessionService.validateAccessToken(token);
      if (!session) {
        return reply.status(401).send({ error: "Invalid or expired token" });
      }

      return reply.status(200).send({
        did: session.did,
        handle: session.handle,
      });
    });

    done();
  };
}
