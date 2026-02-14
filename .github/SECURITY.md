# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository
2. Click "Security" tab
3. Click "Report a vulnerability"
4. Fill in the details

Or email: security@barazo.forum

We will respond within 72 hours with next steps.

## Security Scope for This Repo

barazo-api is the AppView backend -- it handles authentication, user input, database access, and firehose ingestion. The following areas are in scope for security reports:

### Authentication & Authorization
- **OAuth bypass** -- circumventing AT Protocol OAuth flows, session hijacking, token leakage
- **Authorization escalation** -- accessing admin/moderator endpoints without the required role
- **Session management** -- JWT/session token weaknesses, missing expiration, replay attacks

### Input Validation & Injection
- **SQL injection** -- any path that bypasses Drizzle ORM parameterized queries
- **NoSQL/command injection** -- Valkey command injection via unsanitized input
- **Content injection** -- storing malicious content that bypasses DOMPurify sanitization
- **Zod schema bypass** -- requests that circumvent Zod validation on API endpoints

### AT Protocol & Firehose
- **Firehose record manipulation** -- crafted AT Protocol records that exploit indexing logic
- **DID spoofing** -- forging identity claims through manipulated DIDs or handles
- **Cross-community data leaks** -- accessing data from communities the user is not authorized to view
- **Deletion event bypass** -- circumventing GDPR deletion propagation via firehose replay

### Rate Limiting & Abuse
- **Rate limit bypass** -- circumventing per-endpoint or per-user rate limits
- **Burst detection evasion** -- evading anti-spam burst detection thresholds
- **First-post queue bypass** -- new accounts posting without moderation review
- **Resource exhaustion** -- requests that cause excessive CPU, memory, or database load

### Data Security
- **BYOK key exposure** -- leaking user-provided AI API keys (encrypted with AES-256-GCM at rest)
- **Backup data exposure** -- unencrypted PII in backup outputs
- **Logging PII** -- personal data appearing in Pino structured logs
- **Database role escalation** -- application role gaining DDL privileges reserved for the migration role

## Security Practices

- Strict TypeScript (`strict: true`, no `any`, no `@ts-ignore`)
- All API endpoints validate input with Zod schemas
- All user-generated content sanitized with DOMPurify
- Drizzle ORM with parameterized queries only (no raw SQL)
- Helmet middleware for security headers (CSP, HSTS, X-Frame-Options)
- Rate limiting on all endpoints
- Three-role database separation (migrator, app, readonly)
- BYOK API keys encrypted at rest (AES-256-GCM)
- Dependencies updated weekly via Dependabot
- CodeQL security scanning on every PR
- Structured logging via Pino (no `console.log` in production)

## Disclosure Policy

We follow responsible disclosure:
- 90 days before public disclosure
- Credit given to reporter (if desired)
- CVE assigned when applicable
