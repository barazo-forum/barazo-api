<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/barazo-forum/.github/main/assets/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/barazo-forum/.github/main/assets/logo-light.svg">
  <img alt="Barazo Logo" src="https://raw.githubusercontent.com/barazo-forum/.github/main/assets/logo-dark.svg" width="120">
</picture>

# barazo-api

**AppView backend for Barazo forums**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](https://opensource.org/licenses/AGPL-3.0)
[![Node.js](https://img.shields.io/badge/node-24%20LTS-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-885%20passing-brightgreen)](#testing)

</div>

---

## Status: Alpha

Core MVP implemented. 885 tests across 56 test files, all passing.

**Completed:** P1 (Core MVP) + P2.1 (User Experience) + P2.2 (Global Aggregator + Reputation)

**Next:** P2.3 (Age Declaration Revision + Community Onboarding Fields)

---

## What is this?

The barazo-api is the core engine that powers every Barazo forum. It:

- **Subscribes to the AT Protocol firehose** -- Indexes forum records in real-time via Tap
- **Exposes a REST API** -- All forum operations (topics, replies, reactions, search, moderation)
- **Manages authentication** -- OAuth integration with any AT Protocol PDS
- **Handles moderation** -- Forum-level and global content filtering
- **Enables cross-forum features** -- Reputation, aggregation, maturity filtering across instances

**Two operating modes:**
- **Single-forum mode** -- Indexes one community
- **Global mode** -- Aggregates ALL Barazo forums (like barazo.forum)

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 24 LTS, TypeScript (strict mode) |
| Framework | Fastify |
| Database | PostgreSQL 16 + pgvector (semantic search ready) |
| Cache | Valkey |
| Protocol | @atproto/api, @atproto/oauth-client-node, @atproto/tap |
| ORM | Drizzle |
| Validation | Zod |
| Testing | Vitest, Supertest |
| Logging | Pino |
| Monitoring | GlitchTip (Sentry-compatible) |

---

## Implemented Features

**14 route modules:**

| Route | Functionality |
|-------|--------------|
| `auth` | AT Protocol OAuth (sign in with any PDS) |
| `oauth-metadata` | OAuth discovery metadata |
| `health` | Health check endpoint |
| `topics` | CRUD, sorting (chronological/reactions/trending), cross-posting to Bluesky/Frontpage, self-labels |
| `replies` | CRUD threaded replies, self-labels |
| `categories` | CRUD with maturity ratings, parent/child hierarchy |
| `reactions` | Configurable reaction types per forum |
| `search` | Full-text search (PostgreSQL tsvector + GIN) |
| `profiles` | User profiles with PDS sync, cross-community reputation |
| `notifications` | In-app + email notifications |
| `moderation` | Lock, pin, delete, ban, content reporting, word/phrase blocklists, link spam detection |
| `admin-settings` | Community settings, maturity rating, branding |
| `block-mute` | Block/mute users (portable via PDS) |
| `setup` | Initial community setup |

**Core capabilities:**
- Firehose subscription via Tap (filtered for `forum.barazo.*` records)
- Content maturity filtering (SFW/Mature/Adult, forum + category level)
- Age gate (self-declaration endpoint)
- User preferences (global + per-community)
- Global aggregator mode (`COMMUNITY_MODE=global`)
- Cross-community reputation (activity counts across forums)
- Cross-posting to Bluesky (default ON, toggleable per-topic) + Frontpage (feature flag)
- Rich OpenGraph images for cross-posts (forum branding, topic title, category)
- Cross-post deletion lifecycle (topic deleted -> cross-posts deleted)
- Zod validation on all endpoints
- Pino structured logging
- Security headers (Helmet), rate limiting
- DOMPurify output sanitization

## Planned Features

- Semantic search (pgvector hybrid ranking) -- pgvector installed, not yet activated
- AI-assisted moderation (spam/toxicity flagging)
- Plugin system
- Stripe billing integration
- Multi-tenant support
- AT Protocol labeler integration
- Migration API endpoints

---

## Testing

```
885 tests across 56 test files -- all passing
```

```bash
pnpm test           # Run all tests
pnpm test:coverage  # With coverage report
pnpm lint           # ESLint
pnpm typecheck      # TypeScript strict mode
```

---

## Prerequisites

- Node.js 24 LTS
- pnpm
- Docker + Docker Compose (for PostgreSQL + Valkey)
- AT Protocol PDS access (Bluesky or self-hosted)

---

## Quick Start

**Clone and install:**
```bash
git clone https://github.com/barazo-forum/barazo-api.git
cd barazo-api
pnpm install
```

**Start dependencies:**
```bash
docker compose -f docker-compose.dev.yml up -d
```

**Configure environment:**
```bash
cp .env.example .env
# Edit .env with your settings
```

**Run development server:**
```bash
pnpm dev
```

**Run tests:**
```bash
pnpm test
pnpm lint
pnpm typecheck
```

---

## API Documentation

When running, interactive API docs are available at:

**Local:** `http://localhost:3000/docs`
**Production:** `https://api.barazo.forum/docs`

OpenAPI spec: `GET /api/openapi.json`

---

## Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) for:
- Branching strategy
- Commit message format
- Testing requirements
- Code review process

**Key standards:**
- TypeScript strict mode (no `any`, no `@ts-ignore`)
- All endpoints validate input (Zod schemas)
- All user content sanitized (DOMPurify)
- Test-driven development (TDD)
- Conventional commits enforced

---

## Deployment

**Production deployment via Docker:**
```bash
docker pull ghcr.io/barazo-forum/barazo-api:latest
```

See [barazo-deploy](https://github.com/barazo-forum/barazo-deploy) for full deployment templates.

---

## License

**AGPL-3.0** -- Protects the core. Competitors running hosted services must share their changes.

See [LICENSE](LICENSE) for full terms.

---

## Related Repositories

- **[barazo-web](https://github.com/barazo-forum/barazo-web)** -- Forum frontend (MIT)
- **[barazo-lexicons](https://github.com/barazo-forum/barazo-lexicons)** -- AT Protocol schemas (MIT)
- **[barazo-deploy](https://github.com/barazo-forum/barazo-deploy)** -- Deployment templates (MIT)
- **[Organization](https://github.com/barazo-forum)** -- All repos

---

## Community

- **Website:** [barazo.forum](https://barazo.forum) (coming soon)
- **Discussions:** [GitHub Discussions](https://github.com/orgs/barazo-forum/discussions)
- **Issues:** [Report bugs](https://github.com/barazo-forum/barazo-api/issues)

---

(c) 2026 Barazo. Licensed under AGPL-3.0.
