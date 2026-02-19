import type { FastifyReply, FastifyRequest } from 'fastify'
import type { SessionService } from './session.js'
import type { Logger } from '../lib/logger.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** User info attached to authenticated requests. */
export interface RequestUser {
  did: string
  handle: string
  sid: string
}

/** Auth middleware hooks returned by createAuthMiddleware. */
export interface AuthMiddleware {
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
}

// ---------------------------------------------------------------------------
// Extend Fastify's request type
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated user info (set by requireAuth or optionalAuth middleware). */
    user?: RequestUser
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract Bearer token from the Authorization header.
 * Returns the token string if valid, or undefined if missing/malformed.
 */
function extractBearerToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined
  }

  const token = authHeader.slice('Bearer '.length)
  if (token.length === 0) {
    return undefined
  }

  return token
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// TODO(self-hosting): Add DID document verification with 1-hour cache TTL.
// Currently trusts the DID from the session. Full verification requires
// PLC directory / DNS resolution (see standards/backend.md).
// Not needed for single-instance MVP (trusted Valkey on same host).

/**
 * Create auth middleware hooks for Fastify route preHandler.
 *
 * @param sessionService - Session service for token validation
 * @param logger - Pino logger instance
 * @returns Object with requireAuth and optionalAuth hooks
 */
export function createAuthMiddleware(
  sessionService: SessionService,
  logger: Logger
): AuthMiddleware {
  /**
   * Require authentication. Returns 401 if no valid token, 502 if service error.
   * On success, sets `request.user` with the authenticated user info.
   */
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extractBearerToken(request)
    if (token === undefined) {
      await reply.status(401).send({ error: 'Authentication required' })
      return
    }

    try {
      const session = await sessionService.validateAccessToken(token)
      if (!session) {
        await reply.status(401).send({ error: 'Invalid or expired token' })
        return
      }

      request.user = {
        did: session.did,
        handle: session.handle,
        sid: session.sid,
      }
    } catch (err: unknown) {
      logger.error({ err }, 'Token validation failed in requireAuth')
      await reply.status(502).send({ error: 'Service temporarily unavailable' })
    }
  }

  /**
   * Optional authentication. If a valid token is present, sets `request.user`.
   * If no token, invalid token, or service error: continues with `request.user` undefined.
   */
  async function optionalAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = extractBearerToken(request)
    if (token === undefined) {
      return
    }

    try {
      const session = await sessionService.validateAccessToken(token)
      if (session) {
        request.user = {
          did: session.did,
          handle: session.handle,
          sid: session.sid,
        }
      }
    } catch (err: unknown) {
      logger.warn({ err }, 'Token validation failed in optionalAuth, continuing unauthenticated')
    }
  }

  return { requireAuth, optionalAuth }
}
