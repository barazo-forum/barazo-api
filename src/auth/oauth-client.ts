import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type { RuntimeLock } from "@atproto/oauth-client-node";
import type { Env } from "../config/env.js";
import type { Cache } from "../cache/index.js";
import type { Logger } from "../lib/logger.js";
import { ValkeyStateStore, ValkeySessionStore } from "./oauth-stores.js";

const LOCK_KEY_PREFIX = "atgora:oauth:lock:";
const LOCK_TTL_SECONDS = 10;
const LOCK_RETRY_DELAY_MS = 1000;

/**
 * Determine whether the OAuth client should operate in loopback (development) mode.
 * Loopback mode is detected when OAUTH_CLIENT_ID starts with "http://localhost".
 */
function isLoopbackMode(clientId: string): boolean {
  return clientId.startsWith("http://localhost");
}

/**
 * Build the client_id for loopback (development) mode.
 * Per the AT Protocol OAuth spec, loopback clients encode their redirect_uri
 * and scope directly in the client_id URL as query parameters.
 */
function buildLoopbackClientId(redirectUri: string): string {
  const scope = "atproto transition:generic";
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
}

/**
 * Create a Valkey-based distributed lock for preventing concurrent token refreshes.
 * Uses SETNX (SET with NX flag) to ensure only one process acquires the lock.
 *
 * The RuntimeLock interface executes a function while holding the lock,
 * then releases it automatically (even on error).
 */
function createRequestLock(cache: Cache, logger: Logger): RuntimeLock {
  return async <T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> => {
    const lockKey = `${LOCK_KEY_PREFIX}${name}`;

    // Attempt to acquire lock: SET key value EX ttl NX (only if not exists)
    const acquired = await cache.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");
    if (acquired === null) {
      // Lock not acquired, wait and retry once
      logger.debug({ lockKey }, "Lock not acquired, retrying");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, LOCK_RETRY_DELAY_MS);
      });

      const retryAcquired = await cache.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");
      if (retryAcquired === null) {
        logger.warn({ lockKey }, "Could not acquire OAuth lock after retry");
        throw new Error(`Could not acquire OAuth lock: ${name}`);
      }
    }

    try {
      return await fn();
    } finally {
      try {
        await cache.del(lockKey);
      } catch (err: unknown) {
        logger.error({ err, lockKey }, "Failed to release OAuth lock");
      }
    }
  };
}

/**
 * Create a configured NodeOAuthClient for AT Protocol authentication.
 *
 * Supports two modes:
 * - **Loopback (development):** client_id is built from redirect_uri and scope params.
 *   No HTTPS needed, works with http://localhost.
 * - **Production:** client_id points to the publicly served metadata endpoint.
 *   The PDS fetches metadata from that URL.
 */
export function createOAuthClient(
  env: Env,
  cache: Cache,
  logger: Logger,
): NodeOAuthClient {
  const loopback = isLoopbackMode(env.OAUTH_CLIENT_ID);
  const clientId = loopback
    ? buildLoopbackClientId(env.OAUTH_REDIRECT_URI)
    : env.OAUTH_CLIENT_ID;

  logger.info(
    { loopback, clientId: loopback ? "(loopback)" : clientId },
    "Creating OAuth client",
  );

  const client = new NodeOAuthClient({
    clientMetadata: {
      client_name: "ATgora Forum",
      client_id: clientId,
      client_uri: loopback ? "http://localhost" : env.OAUTH_CLIENT_ID.replace(/\/oauth-client-metadata\.json$/, ""),
      redirect_uris: [env.OAUTH_REDIRECT_URI],
      scope: "atproto transition:generic",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    },
    stateStore: new ValkeyStateStore(cache, logger),
    sessionStore: new ValkeySessionStore(cache, logger, env.OAUTH_SESSION_TTL),
    requestLock: createRequestLock(cache, logger),
  });

  // Log session lifecycle events for observability
  client.addEventListener("updated", (event: CustomEvent) => {
    const detail = event.detail as { sub: string };
    logger.info({ sub: detail.sub }, "OAuth session updated");
  });

  client.addEventListener("deleted", (event: CustomEvent) => {
    const detail = event.detail as { sub: string; cause: unknown };
    logger.info(
      { sub: detail.sub, cause: String(detail.cause) },
      "OAuth session deleted",
    );
  });

  return client;
}
