import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { NodeOAuthClient } from '@atproto/oauth-client-node'
import { oauthMetadataRoutes } from '../../../src/routes/oauth-metadata.js'

const mockClientMetadata = {
  client_id: 'https://forum.barazo.forum/oauth-client-metadata.json',
  client_name: 'Barazo Forum',
  client_uri: 'https://forum.barazo.forum',
  redirect_uris: ['https://forum.barazo.forum/api/auth/callback'],
  scope: 'atproto transition:generic',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  application_type: 'web',
  token_endpoint_auth_method: 'none',
  dpop_bound_access_tokens: true,
}

const mockJwks = {
  keys: [
    {
      kty: 'EC',
      crv: 'P-256',
      x: 'test-x-coordinate',
      y: 'test-y-coordinate',
      kid: 'test-key-id',
    },
  ],
}

function createMockOAuthClient(): NodeOAuthClient {
  return {
    clientMetadata: mockClientMetadata,
    jwks: mockJwks,
  } as unknown as NodeOAuthClient
}

describe('OAuth metadata routes', () => {
  let app: FastifyInstance
  let mockClient: NodeOAuthClient

  beforeAll(async () => {
    mockClient = createMockOAuthClient()
    app = Fastify({ logger: false })
    await app.register(oauthMetadataRoutes(mockClient))
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /oauth-client-metadata.json', () => {
    it('returns client metadata as JSON', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth-client-metadata.json',
      })

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual(mockClientMetadata)
    })

    it('sets Content-Type to application/json', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth-client-metadata.json',
      })

      expect(response.headers['content-type']).toContain('application/json')
    })

    it('sets Cache-Control headers for caching', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth-client-metadata.json',
      })

      expect(response.headers['cache-control']).toBe(
        'public, max-age=3600, stale-while-revalidate=86400'
      )
    })
  })

  describe('GET /jwks.json', () => {
    it('returns JWKS as JSON', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jwks.json',
      })

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual(mockJwks)
    })

    it('sets Content-Type to application/json', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jwks.json',
      })

      expect(response.headers['content-type']).toContain('application/json')
    })

    it('sets Cache-Control headers for caching', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jwks.json',
      })

      expect(response.headers['cache-control']).toBe(
        'public, max-age=3600, stale-while-revalidate=86400'
      )
    })
  })

  describe('GET /jwks.json with empty keys', () => {
    let emptyApp: FastifyInstance

    beforeAll(async () => {
      const emptyClient = {
        clientMetadata: mockClientMetadata,
        jwks: { keys: [] },
      } as unknown as NodeOAuthClient

      emptyApp = Fastify({ logger: false })
      await emptyApp.register(oauthMetadataRoutes(emptyClient))
      await emptyApp.ready()
    })

    afterAll(async () => {
      await emptyApp.close()
    })

    it('returns empty keys array when no keys configured', async () => {
      const response = await emptyApp.inject({
        method: 'GET',
        url: '/jwks.json',
      })

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ keys: [] })
    })
  })
})
