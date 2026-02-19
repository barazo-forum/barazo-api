import { eq } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { badRequest } from '../lib/api-errors.js'
import { didParamSchema } from '../validation/block-mute.js'
import { userPreferences } from '../db/schema/user-preferences.js'

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const errorJsonSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const },
  },
}

const successJsonSchema = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
  },
}

const didParamJsonSchema = {
  type: 'object' as const,
  required: ['did'],
  properties: {
    did: { type: 'string' as const },
  },
}

// ---------------------------------------------------------------------------
// Block/mute action routes plugin
// ---------------------------------------------------------------------------

/**
 * Block and mute action routes for the Barazo forum.
 *
 * - POST   /api/users/me/block/:did  -- Add DID to blocked list
 * - DELETE /api/users/me/block/:did  -- Remove DID from blocked list
 * - POST   /api/users/me/mute/:did   -- Add DID to muted list
 * - DELETE /api/users/me/mute/:did   -- Remove DID from muted list
 */
export function blockMuteRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, authMiddleware } = app

    // -------------------------------------------------------------------
    // POST /api/users/me/block/:did (auth required)
    // -------------------------------------------------------------------

    app.post(
      '/api/users/me/block/:did',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Block & Mute'],
          summary: 'Block a user by DID',
          security: [{ bearerAuth: [] }],
          params: didParamJsonSchema,
          response: {
            200: successJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const requestUser = request.user
        if (!requestUser) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const paramResult = didParamSchema.safeParse({
          did: decodeURIComponent((request.params as { did: string }).did),
        })
        if (!paramResult.success) {
          throw badRequest('Invalid DID format')
        }
        const targetDid = paramResult.data.did

        // Read current preferences
        const rows = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.did, requestUser.did))

        const prefs = rows[0]
        const currentBlocked: string[] = prefs?.blockedDids ?? []

        // Idempotent: if already blocked, return success
        if (currentBlocked.includes(targetDid)) {
          return reply.status(200).send({ success: true })
        }

        const newBlocked = [...currentBlocked, targetDid]
        const now = new Date()

        // Upsert preferences with updated blockedDids
        await db
          .insert(userPreferences)
          .values({
            did: requestUser.did,
            blockedDids: newBlocked,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userPreferences.did,
            set: {
              blockedDids: newBlocked,
              updatedAt: now,
            },
          })

        return reply.status(200).send({ success: true })
      }
    )

    // -------------------------------------------------------------------
    // DELETE /api/users/me/block/:did (auth required)
    // -------------------------------------------------------------------

    app.delete(
      '/api/users/me/block/:did',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Block & Mute'],
          summary: 'Unblock a user by DID',
          security: [{ bearerAuth: [] }],
          params: didParamJsonSchema,
          response: {
            200: successJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const requestUser = request.user
        if (!requestUser) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const paramResult = didParamSchema.safeParse({
          did: decodeURIComponent((request.params as { did: string }).did),
        })
        if (!paramResult.success) {
          throw badRequest('Invalid DID format')
        }
        const targetDid = paramResult.data.did

        // Read current preferences
        const rows = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.did, requestUser.did))

        const prefs = rows[0]
        const currentBlocked: string[] = prefs?.blockedDids ?? []
        const newBlocked = currentBlocked.filter((d) => d !== targetDid)
        const now = new Date()

        // Upsert preferences with updated blockedDids
        await db
          .insert(userPreferences)
          .values({
            did: requestUser.did,
            blockedDids: newBlocked,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userPreferences.did,
            set: {
              blockedDids: newBlocked,
              updatedAt: now,
            },
          })

        return reply.status(200).send({ success: true })
      }
    )

    // -------------------------------------------------------------------
    // POST /api/users/me/mute/:did (auth required)
    // -------------------------------------------------------------------

    app.post(
      '/api/users/me/mute/:did',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Block & Mute'],
          summary: 'Mute a user by DID',
          security: [{ bearerAuth: [] }],
          params: didParamJsonSchema,
          response: {
            200: successJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const requestUser = request.user
        if (!requestUser) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const paramResult = didParamSchema.safeParse({
          did: decodeURIComponent((request.params as { did: string }).did),
        })
        if (!paramResult.success) {
          throw badRequest('Invalid DID format')
        }
        const targetDid = paramResult.data.did

        // Read current preferences
        const rows = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.did, requestUser.did))

        const prefs = rows[0]
        const currentMuted: string[] = prefs?.mutedDids ?? []

        // Idempotent: if already muted, return success
        if (currentMuted.includes(targetDid)) {
          return reply.status(200).send({ success: true })
        }

        const newMuted = [...currentMuted, targetDid]
        const now = new Date()

        // Upsert preferences with updated mutedDids
        await db
          .insert(userPreferences)
          .values({
            did: requestUser.did,
            mutedDids: newMuted,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userPreferences.did,
            set: {
              mutedDids: newMuted,
              updatedAt: now,
            },
          })

        return reply.status(200).send({ success: true })
      }
    )

    // -------------------------------------------------------------------
    // DELETE /api/users/me/mute/:did (auth required)
    // -------------------------------------------------------------------

    app.delete(
      '/api/users/me/mute/:did',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Block & Mute'],
          summary: 'Unmute a user by DID',
          security: [{ bearerAuth: [] }],
          params: didParamJsonSchema,
          response: {
            200: successJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const requestUser = request.user
        if (!requestUser) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const paramResult = didParamSchema.safeParse({
          did: decodeURIComponent((request.params as { did: string }).did),
        })
        if (!paramResult.success) {
          throw badRequest('Invalid DID format')
        }
        const targetDid = paramResult.data.did

        // Read current preferences
        const rows = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.did, requestUser.did))

        const prefs = rows[0]
        const currentMuted: string[] = prefs?.mutedDids ?? []
        const newMuted = currentMuted.filter((d) => d !== targetDid)
        const now = new Date()

        // Upsert preferences with updated mutedDids
        await db
          .insert(userPreferences)
          .values({
            did: requestUser.did,
            mutedDids: newMuted,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userPreferences.did,
            set: {
              mutedDids: newMuted,
              updatedAt: now,
            },
          })

        return reply.status(200).send({ success: true })
      }
    )

    done()
  }
}
