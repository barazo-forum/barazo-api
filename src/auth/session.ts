import crypto from "node:crypto";
import type { Cache } from "../cache/index.js";
import type { Logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Key prefixes
// ---------------------------------------------------------------------------

const SESSION_DATA_PREFIX = "atgora:session:data:";
const ACCESS_TOKEN_PREFIX = "atgora:session:access:";
const DID_INDEX_PREFIX = "atgora:session:did:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionConfig {
  /** Session TTL in seconds (default: 604800 = 7 days) */
  sessionTtl: number;
  /** Access token TTL in seconds (default: 900 = 15 min) */
  accessTokenTtl: number;
}

export interface Session {
  /** Unique session identifier (used as refresh token) */
  sid: string;
  /** User's AT Protocol DID */
  did: string;
  /** User's AT Protocol handle */
  handle: string;
  /** Short-lived access token (random, 32 bytes hex) */
  accessToken: string;
  /** When the access token expires (epoch ms) */
  accessTokenExpiresAt: number;
  /** When the session was created (epoch ms) */
  createdAt: number;
}

export interface SessionService {
  /**
   * Create a new session after successful OAuth callback.
   * Generates session ID and access token, stores both in Valkey.
   * Returns the Session object (caller handles cookie + response).
   */
  createSession(did: string, handle: string): Promise<Session>;

  /**
   * Validate an access token. Returns the session if valid, undefined if invalid/expired.
   * Looks up by access token hash, then fetches full session data.
   */
  validateAccessToken(accessToken: string): Promise<Session | undefined>;

  /**
   * Refresh a session: generate new access token, keep same session ID.
   * The refresh token (session ID) comes from the HTTP-only cookie.
   * Returns updated session or undefined if session expired/not found.
   */
  refreshSession(sid: string): Promise<Session | undefined>;

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

  async function createSession(did: string, handle: string): Promise<Session> {
    const sid = generateToken();
    const accessToken = generateToken();
    const now = Date.now();

    const session: Session = {
      sid,
      did,
      handle,
      accessToken,
      accessTokenExpiresAt: now + accessTokenTtl * 1000,
      createdAt: now,
    };

    try {
      const tokenHash = sha256(accessToken);

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

      return session;
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

      return JSON.parse(data) as Session;
    } catch (err: unknown) {
      logger.error(
        { err, tokenHash: truncateForLog(tokenHash) },
        "Failed to validate access token",
      );
      throw err;
    }
  }

  async function refreshSession(sid: string): Promise<Session | undefined> {
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

      const existing = JSON.parse(data) as Session;

      // Delete old access token lookup
      const oldTokenHash = sha256(existing.accessToken);
      await cache.del(`${ACCESS_TOKEN_PREFIX}${oldTokenHash}`);

      // Generate new access token
      const newAccessToken = generateToken();
      const newTokenHash = sha256(newAccessToken);
      const now = Date.now();

      const updated: Session = {
        ...existing,
        accessToken: newAccessToken,
        accessTokenExpiresAt: now + accessTokenTtl * 1000,
      };

      // Store new access token hash → session ID mapping
      await cache.set(
        `${ACCESS_TOKEN_PREFIX}${newTokenHash}`,
        sid,
        "EX",
        accessTokenTtl,
      );

      // Update session data
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

      return updated;
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
      // Fetch session to get access token and DID for cleanup
      const data = await cache.get(`${SESSION_DATA_PREFIX}${sid}`);
      if (data === null) {
        logger.debug(
          { sid: truncateForLog(sid) },
          "Session not found for deletion",
        );
        return;
      }

      const session = JSON.parse(data) as Session;
      const tokenHash = sha256(session.accessToken);

      // Delete access token lookup
      await cache.del(`${ACCESS_TOKEN_PREFIX}${tokenHash}`);
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
