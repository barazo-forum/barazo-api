import { eq, and, sql } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { getCommunityDid } from '../config/env.js'
import { createPdsClient } from '../lib/pds-client.js'
import {
  notFound,
  forbidden,
  badRequest,
  conflict,
  errorResponseSchema,
  sendError,
} from '../lib/api-errors.js'
import { createVoteSchema, voteStatusQuerySchema } from '../validation/votes.js'
import { votes } from '../db/schema/votes.js'
import { topics } from '../db/schema/topics.js'
import { replies } from '../db/schema/replies.js'
import { checkOnboardingComplete } from '../lib/onboarding-gate.js'
import { extractRkey, getCollectionFromUri } from '../lib/at-uri.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTION = 'forum.barazo.interaction.vote'
const TOPIC_COLLECTION = 'forum.barazo.topic.post'
const REPLY_COLLECTION = 'forum.barazo.topic.reply'

// Upvote-only for now; "down" can be added later without breaking change
const ALLOWED_DIRECTIONS = ['up']

// ---------------------------------------------------------------------------
// Vote routes plugin
// ---------------------------------------------------------------------------

/**
 * Vote routes for the Barazo forum.
 *
 * - POST   /api/votes             -- Cast a vote
 * - DELETE  /api/votes/:uri        -- Remove a vote
 * - GET     /api/votes/status      -- Check if user voted on a subject
 */
export function voteRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, env, authMiddleware, firehose } = app
    const pdsClient = createPdsClient(app.oauthClient, app.log)

    // -------------------------------------------------------------------
    // POST /api/votes (auth required)
    // -------------------------------------------------------------------

    app.post(
      '/api/votes',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Votes'],
          summary: 'Cast a vote on a topic or reply',
          security: [{ bearerAuth: [] }],
          body: {
            type: 'object',
            required: ['subjectUri', 'subjectCid', 'direction'],
            properties: {
              subjectUri: { type: 'string', minLength: 1 },
              subjectCid: { type: 'string', minLength: 1 },
              direction: { type: 'string', minLength: 1 },
            },
          },
          response: {
            201: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
                cid: { type: 'string' },
                rkey: { type: 'string' },
                direction: { type: 'string' },
                subjectUri: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            500: errorResponseSchema,
            502: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const parsed = createVoteSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid vote data')
        }

        const { subjectUri, subjectCid, direction } = parsed.data
        const communityDid = getCommunityDid(env)

        // Validate direction
        if (!ALLOWED_DIRECTIONS.includes(direction)) {
          throw badRequest(
            `Vote direction "${direction}" is not allowed. Allowed: ${ALLOWED_DIRECTIONS.join(', ')}`
          )
        }

        // Onboarding gate
        const onboarding = await checkOnboardingComplete(db, user.did, communityDid)
        if (!onboarding.complete) {
          return reply.status(403).send({
            error: 'Onboarding required',
            fields: onboarding.missingFields,
          })
        }

        // Verify subject exists and belongs to the same community
        const collection = getCollectionFromUri(subjectUri)
        let subjectExists = false

        if (collection === TOPIC_COLLECTION) {
          const topicRows = await db
            .select({ uri: topics.uri })
            .from(topics)
            .where(and(eq(topics.uri, subjectUri), eq(topics.communityDid, communityDid)))
          subjectExists = topicRows.length > 0
        } else if (collection === REPLY_COLLECTION) {
          const replyRows = await db
            .select({ uri: replies.uri })
            .from(replies)
            .where(and(eq(replies.uri, subjectUri), eq(replies.communityDid, communityDid)))
          subjectExists = replyRows.length > 0
        }

        if (!subjectExists) {
          throw notFound('Subject not found')
        }

        const now = new Date().toISOString()

        // Build AT Protocol record
        const record: Record<string, unknown> = {
          subject: { uri: subjectUri, cid: subjectCid },
          direction,
          community: communityDid,
          createdAt: now,
        }

        // Write record to user's PDS
        let pdsResult: { uri: string; cid: string }
        try {
          pdsResult = await pdsClient.createRecord(user.did, COLLECTION, record)
        } catch (err: unknown) {
          if (err instanceof Error && 'statusCode' in err) throw err
          app.log.error({ err, did: user.did }, 'PDS write failed for vote creation')
          return sendError(reply, 502, 'Failed to write to remote PDS')
        }

        const rkey = extractRkey(pdsResult.uri)

        try {
          // Track repo if this is user's first interaction
          const repoManager = firehose.getRepoManager()
          const alreadyTracked = await repoManager.isTracked(user.did)
          if (!alreadyTracked) {
            await repoManager.trackRepo(user.did)
          }

          // Optimistically insert into local DB + increment count in a transaction
          const insertResult = await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(votes)
              .values({
                uri: pdsResult.uri,
                rkey,
                authorDid: user.did,
                subjectUri,
                subjectCid,
                direction,
                communityDid,
                cid: pdsResult.cid,
                createdAt: new Date(now),
                indexedAt: new Date(),
              })
              .onConflictDoNothing()
              .returning()

            // If no rows were inserted, the unique constraint was hit (duplicate vote)
            if (inserted.length === 0) {
              return inserted
            }

            // Increment vote count on the subject
            if (collection === TOPIC_COLLECTION) {
              await tx
                .update(topics)
                .set({ voteCount: sql`${topics.voteCount} + 1` })
                .where(eq(topics.uri, subjectUri))
            } else if (collection === REPLY_COLLECTION) {
              await tx
                .update(replies)
                .set({ voteCount: sql`${replies.voteCount} + 1` })
                .where(eq(replies.uri, subjectUri))
            }

            return inserted
          })

          if (insertResult.length === 0) {
            throw conflict('Vote already exists')
          }

          return await reply.status(201).send({
            uri: pdsResult.uri,
            cid: pdsResult.cid,
            rkey,
            direction,
            subjectUri,
            createdAt: now,
          })
        } catch (err: unknown) {
          if (err instanceof Error && 'statusCode' in err) throw err
          app.log.error({ err, did: user.did }, 'Failed to create vote')
          return sendError(reply, 500, 'Failed to save vote locally')
        }
      }
    )

    // -------------------------------------------------------------------
    // DELETE /api/votes/:uri (auth required, author only)
    // -------------------------------------------------------------------

    app.delete(
      '/api/votes/:uri',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Votes'],
          summary: 'Remove a vote (author only)',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['uri'],
            properties: {
              uri: { type: 'string' },
            },
          },
          response: {
            204: { type: 'null' },
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            500: errorResponseSchema,
            502: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const { uri } = request.params as { uri: string }
        const decodedUri = decodeURIComponent(uri)
        const communityDid = getCommunityDid(env)

        // Fetch existing vote (scoped to this community)
        const existing = await db
          .select()
          .from(votes)
          .where(and(eq(votes.uri, decodedUri), eq(votes.communityDid, communityDid)))

        const vote = existing[0]
        if (!vote) {
          throw notFound('Vote not found')
        }

        // Author check
        if (vote.authorDid !== user.did) {
          throw forbidden('Not authorized to delete this vote')
        }

        const rkey = extractRkey(decodedUri)

        // Delete from PDS
        try {
          await pdsClient.deleteRecord(user.did, COLLECTION, rkey)
        } catch (err: unknown) {
          if (err instanceof Error && 'statusCode' in err) throw err
          app.log.error({ err, uri: decodedUri }, 'PDS delete failed for vote')
          return sendError(reply, 502, 'Failed to delete record from remote PDS')
        }

        try {
          // In transaction: delete from DB + decrement count on subject
          await db.transaction(async (tx) => {
            await tx
              .delete(votes)
              .where(and(eq(votes.uri, decodedUri), eq(votes.communityDid, communityDid)))

            const subjectCollection = getCollectionFromUri(vote.subjectUri)

            if (subjectCollection === TOPIC_COLLECTION) {
              await tx
                .update(topics)
                .set({
                  voteCount: sql`GREATEST(${topics.voteCount} - 1, 0)`,
                })
                .where(eq(topics.uri, vote.subjectUri))
            } else if (subjectCollection === REPLY_COLLECTION) {
              await tx
                .update(replies)
                .set({
                  voteCount: sql`GREATEST(${replies.voteCount} - 1, 0)`,
                })
                .where(eq(replies.uri, vote.subjectUri))
            }
          })

          return await reply.status(204).send()
        } catch (err: unknown) {
          if (err instanceof Error && 'statusCode' in err) throw err
          app.log.error({ err, uri: decodedUri }, 'Failed to delete vote')
          return sendError(reply, 500, 'Failed to delete vote locally')
        }
      }
    )

    // -------------------------------------------------------------------
    // GET /api/votes/status (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get(
      '/api/votes/status',
      {
        preHandler: [authMiddleware.optionalAuth],
        schema: {
          tags: ['Votes'],
          summary: 'Check if a user has voted on a subject',
          querystring: {
            type: 'object',
            required: ['subjectUri', 'did'],
            properties: {
              subjectUri: { type: 'string' },
              did: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                voted: { type: 'boolean' },
                vote: {
                  type: ['object', 'null'],
                  properties: {
                    uri: { type: 'string' },
                    direction: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
            400: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = voteStatusQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid query parameters')
        }

        const { subjectUri, did } = parsed.data
        const communityDid = getCommunityDid(env)

        const rows = await db
          .select({
            uri: votes.uri,
            direction: votes.direction,
            createdAt: votes.createdAt,
          })
          .from(votes)
          .where(
            and(
              eq(votes.authorDid, did),
              eq(votes.subjectUri, subjectUri),
              eq(votes.communityDid, communityDid)
            )
          )

        const vote = rows[0]

        return reply.status(200).send({
          voted: !!vote,
          vote: vote
            ? {
                uri: vote.uri,
                direction: vote.direction,
                createdAt: vote.createdAt.toISOString(),
              }
            : null,
        })
      }
    )

    done()
  }
}
