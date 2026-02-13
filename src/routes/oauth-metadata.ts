import type { FastifyPluginCallback } from "fastify";
import type { NodeOAuthClient } from "@atproto/oauth-client-node";

/** Cache-Control header value: public, max-age 1 hour, stale-while-revalidate 1 day */
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

/**
 * OAuth metadata endpoints required by the AT Protocol OAuth spec.
 * These serve the client metadata and JWKS so that the PDS can discover
 * this application's OAuth configuration.
 */
export function oauthMetadataRoutes(oauthClient: NodeOAuthClient): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.get("/oauth-client-metadata.json", async (_request, reply) => {
      return reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", CACHE_CONTROL)
        .send(oauthClient.clientMetadata);
    });

    fastify.get("/jwks.json", async (_request, reply) => {
      return reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", CACHE_CONTROL)
        .send(oauthClient.jwks);
    });

    done();
  };
}
