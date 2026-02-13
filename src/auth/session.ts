import crypto from "node:crypto";
import type { Cache } from "../cache/index.js";
import type { Logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Key prefixes
// ---------------------------------------------------------------------------

const SESSION_DATA_PREFIX = "barazo:session:data:";
const ACCESS_TOKEN_PREFIX = "barazo:session:access:";
const DID_INDEX_PREFIX = "barazo:session:did:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionConfig {
  /** Session TTL in seconds (default: 604800 = 7 days) */
  sessionTtl: number;
  /** Access token TTL in seconds (default: 900 = 15 min) */
  accessTokenTtl: number;
}

/**
 * Persisted session data stored in Valkey.
 * Contains only the access token HASH (never the raw token).
 */
export interface Session {
  /** Unique session identifier (used as refresh token) */
  sid: string;
  /** User's AT Protocol DID */
  did: string;
  /** User's AT Protocol handle */
  handle: string;
  /** SHA-256 hash of the access token (raw token is never persisted) */
  accessTokenHash: string;
  /** When the access token expires (epoch ms) */
  accessTokenExpiresAt: number;
  /** When the session was created (epoch ms) */
  createdAt: number;
}

/**
 * Session data returned to callers (includes the raw access token).
 * Only exists in memory -- never serialized to Valkey.
 */
export interface SessionWithToken extends Session {
  /** Raw access token (returned to caller for HTTP response, never persisted) */
  accessToken: string;
}

export interface SessionService {
  /**
   * Create a new session after successful OAuth callback.
   * Generates session ID and access token, stores both in Valkey.
   * Returns SessionWithToken (includes raw access token for HTTP response).
   */
  createSession(did: string, handle: string): Promise<SessionWithToken>;

  /**
   * Validate an access token. Returns the session if valid, undefined if invalid/expired.
   * Looks up by access token hash, then fetches full session data.
   */
  validateAccessToken(accessToken: string): Promise<Session | undefined>;

  /**
   * Refresh a session: generate new access token, keep same session ID.
   * The refresh token (session ID) comes from the HTTP-only cookie.
   * Returns SessionWithToken with new access token, or undefined if session expired.
   */
  refreshSession(sid: string): Promise<SessionWithToken | undefined>;

  /**
   * Delete a session (logout). Removes both the session data and the access token lookup.
   */
  deleteSession(sid: string): Promise<void>;

  /**
   * Delete ALL sessions for a given DID (used on account deletion).
   * Uses the DID-to-sessions index to find all sessions.
   */
  deleteAllSessionsForDid(did: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a cryptographically random 32-byte hex string (64 chars). */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256 hash a value and return the hex digest. */
function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Truncate a hash to 8 characters for safe logging. */
function truncateForLog(value: string): string {
  return value.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionService(
  cache: Cache,
  logger: Logger,
  config: SessionConfig,
): SessionService {
  const { sessionTtl, accessTokenTtl } = config;

  async function createSession(did: string, handle: string): Promise<SessionWithToken> {
    const sid = generateToken();
    const accessToken = generateToken();
    const tokenHash = sha256(accessToken);
    const now = Date.now();

    // Persisted session stores only the hash (never the raw token)
    const session: Session = {
      sid,
      did,
      handle,
      accessTokenHash: tokenHash,
      accessTokenExpiresAt: now + accessTokenTtl * 1000,
      createdAt: now,
    };

    try {
      // Store session data (TTL = session lifetime)
      await cache.set(
        `${SESSION_DATA_PREFIX}${sid}`,
        JSON.stringify(session),
        "EX",
        sessionTtl,
      );

      // Store access token hash → session ID mapping (TTL = access token lifetime)
      await cache.set(
        `${ACCESS_TOKEN_PREFIX}${tokenHash}`,
        sid,
        "EX",
        accessTokenTtl,
      );

      // Add session ID to DID index set and refresh its TTL
      await cache.sadd(`${DID_INDEX_PREFIX}${did}`, sid);
      await cache.expire(`${DID_INDEX_PREFIX}${did}`, sessionTtl);

      logger.debug(
        { did, sid: truncateForLog(sid) },
        "Session created",
      );

      // Return with raw token for the HTTP response (never persisted)
      return { ...session, accessToken };
    } catch (err: unknown) {
      logger.error(
        { err, did, sid: truncateForLog(sid) },
        "Failed to create session",
      );
      throw err;
    }
  }

  async function validateAccessToken(accessToken: string): Promise<Session | undefined> {
    const tokenHash = sha256(accessToken);

    try {
      // Look up session ID by access token hash
      const sid = await cache.get(`${ACCESS_TOKEN_PREFIX}${tokenHash}`);
      if (sid === null) {
        logger.debug(
          { tokenHash: truncateForLog(tokenHash) },
          "Access token not found",
        );
        return undefined;
      }

      // Fetch full session data
      const data = await cache.get(`${SESSION_DATA_PREFIX}${sid}`);
      if (data === null) {
        logger.debug(
          { sid: truncateForLog(sid), tokenHash: truncateForLog(tokenHash) },
          "Session data not found (orphaned token)",
        );
        return undefined;
      }

      // Safe cast: we control all writes to this key via createSession/refreshSession
      return JSON.parse(data) as Session;
    } catch (err: unknown) {
      logger.error(
        { err, tokenHash: truncateForLog(tokenHash) },
        "Failed to validate access token",
      );
      throw err;
    }
  }

  async function refreshSession(sid: string): Promise<SessionWithToken | undefined> {
    try {
      // Fetch existing session
      const data = await cache.get(`${SESSION_DATA_PREFIX}${sid}`);
      if (data === null) {
        logger.debug(
          { sid: truncateForLog(sid) },
          "Session not found for refresh",
        );
        return undefined;
      }

      // Safe cast: we control all writes to this key via createSession/refreshSession
      const existing = JSON.parse(data) as Session;

      // Delete old access token lookup (session stores only the hash)
      await cache.del(`${ACCESS_TOKEN_PREFIX}${existing.accessTokenHash}`);

      // Generate new access token
      const newAccessToken = generateToken();
      const newTokenHash = sha256(newAccessToken);
      const now = Date.now();

      const updated: Session = {
        ...existing,
        accessTokenHash: newTokenHash,
        accessTokenExpiresAt: now + accessTokenTtl * 1000,
      };

      // Store new access token hash → session ID mapping
      await cache.set(
        `${ACCESS_TOKEN_PREFIX}${newTokenHash}`,
        sid,
        "EX",
        accessTokenTtl,
      );

      // Update session data (sliding window: resets TTL on refresh)
      await cache.set(
        `${SESSION_DATA_PREFIX}${sid}`,
        JSON.stringify(updated),
        "EX",
        sessionTtl,
      );

      logger.debug(
        { sid: truncateForLog(sid) },
        "Session refreshed",
      );

      // Return with raw token for the HTTP response (never persisted)
      return { ...updated, accessToken: newAccessToken };
    } catch (err: unknown) {
      logger.error(
        { err, sid: truncateForLog(sid) },
        "Failed to refresh session",
      );
      throw err;
    }
  }

  async function deleteSession(sid: string): Promise<void> {
    try {
      // Fetch session to get access token hash and DID for cleanup
      const data = await cache.get(`${SESSION_DATA_PREFIX}${sid}`);
      if (data === null) {
        logger.debug(
          { sid: truncateForLog(sid) },
          "Session not found for deletion",
        );
        return;
      }

      // Safe cast: we control all writes to this key via createSession/refreshSession
      const session = JSON.parse(data) as Session;

      // Delete access token lookup (session stores only the hash, no re-hashing needed)
      await cache.del(`${ACCESS_TOKEN_PREFIX}${session.accessTokenHash}`);
      // Delete session data
      await cache.del(`${SESSION_DATA_PREFIX}${sid}`);
      // Remove session ID from DID index
      await cache.srem(`${DID_INDEX_PREFIX}${session.did}`, sid);

      logger.debug(
        { sid: truncateForLog(sid) },
        "Session deleted",
      );
    } catch (err: unknown) {
      logger.error(
        { err, sid: truncateForLog(sid) },
        "Failed to delete session",
      );
      throw err;
    }
  }

  async function deleteAllSessionsForDid(did: string): Promise<number> {
    try {
      // Get all session IDs for this DID
      const sids = await cache.smembers(`${DID_INDEX_PREFIX}${did}`);

      if (sids.length === 0) {
        logger.debug({ did, count: 0 }, "All sessions deleted for DID");
        return 0;
      }

      // Delete each session individually (cleans up access token lookups too)
      // TODO(phase-3): Pipeline deletes for performance when moving to multi-instance
      for (const sid of sids) {
        await deleteSession(sid);
      }

      // Delete the DID index set itself
      await cache.del(`${DID_INDEX_PREFIX}${did}`);

      logger.debug(
        { did, count: sids.length },
        "All sessions deleted for DID",
      );

      return sids.length;
    } catch (err: unknown) {
      logger.error(
        { err, did },
        "Failed to delete all sessions for DID",
      );
      throw err;
    }
  }

  return {
    createSession,
    validateAccessToken,
    refreshSession,
    deleteSession,
    deleteAllSessionsForDid,
  };
}
