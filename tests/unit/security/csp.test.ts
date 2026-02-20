import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'

/**
 * Tests for Content Security Policy configuration.
 *
 * API routes get a strict CSP (no 'unsafe-inline', no CDN allowlisting).
 * The /docs scope gets a permissive CSP for the Scalar API reference UI,
 * which requires inline scripts/styles and CDN assets.
 */
describe('Content Security Policy', () => {
  let app: FastifyInstance

  // Permissive CSP for docs scope (must match app.ts DOCS_CSP)
  const docsCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self' https://cdn.jsdelivr.net",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  beforeAll(async () => {
    app = Fastify({ logger: false })

    // Strict global CSP (mirrors app.ts helmet config)
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    })

    // Simulate an API route
    app.get('/api/test', () => ({ ok: true }))

    // Simulate a non-API, non-docs route
    app.get('/health', () => ({ status: 'ok' }))

    // Docs scope with permissive CSP override (mirrors app.ts docsPlugin)
    await app.register(function docsScope(scope, _opts, done) {
      scope.addHook('onRequest', (_request, reply, hookDone) => {
        reply.header('content-security-policy', docsCsp)
        hookDone()
      })
      scope.get('/docs', (_request, reply) => {
        return reply.type('text/html').send('<html><body>docs</body></html>')
      })
      done()
    })

    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('API routes (strict CSP)', () => {
    it('does not include unsafe-inline in script-src', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/test' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toBeDefined()
      expect(csp).not.toContain('unsafe-inline')
    })

    it('does not allow cdn.jsdelivr.net', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/test' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).not.toContain('cdn.jsdelivr.net')
    })

    it('restricts script-src to self only', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/test' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("script-src 'self'")
    })

    it('restricts style-src to self only', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/test' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("style-src 'self'")
    })
  })

  describe('docs routes (permissive CSP for Scalar)', () => {
    it('allows unsafe-inline for scripts', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("'unsafe-inline'")
      expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net")
    })

    it('allows unsafe-inline for styles', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net")
    })

    it('allows cdn.jsdelivr.net for fonts', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("font-src 'self' https://cdn.jsdelivr.net")
    })
  })

  describe('protective directives on all routes', () => {
    it('sets base-uri on API routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/test' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("base-uri 'self'")
    })

    it('sets form-action on API routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/test' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("form-action 'self'")
    })

    it('sets frame-ancestors to none on API routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/test' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("frame-ancestors 'none'")
    })

    it('sets base-uri on docs routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("base-uri 'self'")
    })

    it('sets form-action on docs routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("form-action 'self'")
    })

    it('sets frame-ancestors to none on docs routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toContain("frame-ancestors 'none'")
    })

    it('applies strict CSP to non-API routes outside docs scope', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' })
      const csp = response.headers['content-security-policy'] as string
      expect(csp).toBeDefined()
      expect(csp).not.toContain('unsafe-inline')
      expect(csp).not.toContain('cdn.jsdelivr.net')
    })
  })
})
