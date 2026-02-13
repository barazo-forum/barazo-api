import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import type { AuthMiddleware } from "./middleware.js";
import type { Database } from "../db/index.js";
import type { Logger } from "../lib/logger.js";
import { users } from "../db/schema/users.js";

/**
 * Create a requireAdmin preHandler hook for Fastify routes.
 *
 * This middleware:
 * 1. Delegates to requireAuth to verify the user is authenticated
 * 2. Looks up the user in the database by DID
 * 3. Checks if the user has the "admin" role
 * 4. Returns 403 if the user is not an admin
 * 5. Logs admin access attempts for audit trail
 *
 * @param db - Database instance for user lookups
 * @param authMiddleware - Auth middleware with requireAuth hook
 * @param logger - Optional Pino logger for audit trail
 * @returns A Fastify preHandler function
 */
export function createRequireAdmin(
  db: Database,
  authMiddleware: AuthMiddleware,
  logger?: Logger,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // First, run requireAuth to verify authentication
    await authMiddleware.requireAuth(request, reply);

    // If requireAuth sent a response (e.g. 401), stop here
    if (reply.sent) {
      return;
    }

    // At this point request.user should be set by requireAuth
    if (!request.user) {
      logger?.warn(
        { url: request.url, method: request.method },
        "Admin access denied: no user after auth",
      );
      await reply.status(403).send({ error: "Admin access required" });
      return;
    }

    // Look up user role in database
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.did, request.user.did));

    const userRow = rows[0];
    if (!userRow || userRow.role !== "admin") {
      logger?.warn(
        { did: request.user.did, role: userRow?.role, url: request.url, method: request.method },
        "Admin access denied: insufficient role",
      );
      await reply.status(403).send({ error: "Admin access required" });
      return;
    }

    logger?.info(
      { did: request.user.did, url: request.url, method: request.method },
      "Admin access granted",
    );
  };
}
