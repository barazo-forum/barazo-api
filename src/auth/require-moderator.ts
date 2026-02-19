import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import type { AuthMiddleware } from './middleware.js'
import type { Database } from '../db/index.js'
import type { Logger } from '../lib/logger.js'
import { users } from '../db/schema/users.js'

/**
 * Create a requireModerator preHandler hook for Fastify routes.
 *
 * This middleware:
 * 1. Delegates to requireAuth to verify the user is authenticated
 * 2. Looks up the user in the database by DID
 * 3. Checks if the user has the "moderator" or "admin" role
 * 4. Returns 403 if the user does not have sufficient privileges
 * 5. Logs moderator access attempts for audit trail
 *
 * @param db - Database instance for user lookups
 * @param authMiddleware - Auth middleware with requireAuth hook
 * @param logger - Optional Pino logger for audit trail
 * @returns A Fastify preHandler function
 */
export function createRequireModerator(
  db: Database,
  authMiddleware: AuthMiddleware,
  logger?: Logger
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // First, run requireAuth to verify authentication
    await authMiddleware.requireAuth(request, reply)

    // If requireAuth sent a response (e.g. 401), stop here
    if (reply.sent) {
      return
    }

    // At this point request.user should be set by requireAuth
    if (!request.user) {
      logger?.warn(
        { url: request.url, method: request.method },
        'Moderator access denied: no user after auth'
      )
      await reply.status(403).send({ error: 'Moderator access required' })
      return
    }

    // Look up user role in database
    const rows = await db.select().from(users).where(eq(users.did, request.user.did))

    const userRow = rows[0]
    if (!userRow || (userRow.role !== 'moderator' && userRow.role !== 'admin')) {
      logger?.warn(
        { did: request.user.did, role: userRow?.role, url: request.url, method: request.method },
        'Moderator access denied: insufficient role'
      )
      await reply.status(403).send({ error: 'Moderator access required' })
      return
    }

    logger?.info(
      { did: request.user.did, role: userRow.role, url: request.url, method: request.method },
      'Moderator access granted'
    )
  }
}
