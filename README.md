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

</div>

---

## 🚧 Status: Pre-Alpha Development

This is the AppView backend for Barazo - community forums built on the AT Protocol.

**Current phase:** Planning complete, implementation starting Q1 2026

---

## What is this?

The barazo-api is the core engine that powers every Barazo forum. It:

- **Subscribes to the AT Protocol firehose** - Indexes forum records in real-time
- **Exposes a REST API** - All forum operations (topics, replies, reactions, search, moderation)
- **Manages authentication** - OAuth integration with AT Protocol PDS providers
- **Handles moderation** - Forum-level and global content filtering
- **Enables cross-forum features** - Reputation, aggregation, search across instances

**Two operating modes:**
- **Single-forum mode** - Indexes one community
- **Global mode** - Aggregates ALL Barazo forums (like barazo.forum)

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 24 LTS, TypeScript (strict mode) |
| Framework | Fastify |
| Database | PostgreSQL 16 + pgvector (semantic search) |
| Cache | Valkey |
| Protocol | @atproto/api, @atproto/oauth-client-node, @atproto/tap |
| ORM | Drizzle |
| Validation | Zod |
| Testing | Vitest, Supertest |
| Logging | Pino |
| Monitoring | Sentry |

---

## Key Features (Planned MVP)

- **Firehose subscription** - Tap-based subscription to Bluesky relay, filtered for `forum.barazo.*` records
- **Real-time indexing** - Topics, replies, reactions indexed to PostgreSQL
- **OAuth authentication** - Works with any AT Protocol PDS (Bluesky, self-hosted, etc.)
- **Full-text + semantic search** - PostgreSQL tsvector + pgvector hybrid search
- **Content maturity filtering** - Age-appropriate defaults, user preferences, per-forum overrides
- **Cross-posting** - Share topics to Bluesky/Frontpage automatically
- **Moderation tools** - Lock/pin/delete, ban users, moderation logs
- **API documentation** - Auto-generated OpenAPI spec served at `/docs`

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

## Documentation

- **API Reference:** Served at `/docs` (auto-generated from code)
- **User Guides:** [barazo.forum/docs](https://barazo.forum/docs) (coming soon)
- **Architecture:** [PRD](https://github.com/barazo-forum/barazo-api/blob/main/docs/prd.md)

---

## License

**AGPL-3.0** - Protects the core. Competitors running hosted services must share their changes.

See [LICENSE](LICENSE) for full terms.

---

## Related Repositories

- **[barazo-web](https://github.com/barazo-forum/barazo-web)** - Forum frontend (Next.js)
- **[barazo-lexicons](https://github.com/barazo-forum/barazo-lexicons)** - AT Protocol schemas
- **[barazo-deploy](https://github.com/barazo-forum/barazo-deploy)** - Deployment templates
- **[Organization](https://github.com/barazo-forum)** - All repos

---

## Community

- 🌐 **Website:** [barazo.forum](https://barazo.forum) (coming soon)
- 💬 **Discussions:** [GitHub Discussions](https://github.com/orgs/barazo-forum/discussions)
- 🐛 **Issues:** [Report bugs](https://github.com/barazo-forum/barazo-api/issues)

---

© 2026 Barazo. Licensed under AGPL-3.0.
