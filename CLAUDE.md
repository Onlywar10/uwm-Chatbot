# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Catapult CMS Chatbot — a Next.js app that embeds an AI chatbot on school district websites. Uses RAG (Retrieval-Augmented Generation) over crawled website content with multi-language support. Multi-tenant: all data is scoped by domain.

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build
pnpm lint             # Biome check (lint + format check)
pnpm format           # Biome format --write

# Database
pnpm db:generate      # Generate migrations from schema changes
pnpm db:migrate       # Run migrations (tsx lib/db/migrate.ts)
pnpm db:push          # Push schema directly to database
pnpm db:studio        # Open Drizzle Studio UI
```

No test framework is configured.

## Tech Stack

- **Next.js 16** (App Router, React 19, React Compiler enabled)
- **Vercel AI SDK 6** with `@ai-sdk/gateway` — models referenced by bare string IDs (e.g., `"gpt-4o-mini"`, `"text-embedding-3-small"`)
- **Drizzle ORM** on **Neon PostgreSQL** (serverless HTTP driver) with pgvector for embeddings
- **Upstash QStash** for async crawl job processing via webhooks
- **Biome** for linting and formatting (not ESLint/Prettier). Line width: 100
- **shadcn/ui** + Tailwind CSS 4 + Framer Motion
- **TypeScript** strict mode. Path alias `@` maps to project root
- **pnpm** (>=10.28.0), Node 24.x

## Architecture

### RAG Chat Pipeline (`app/api/chat/route.ts`)
1. Extract domain from request referer (multi-tenant scoping)
2. Generate 1-3 retrieval queries via `generateText()` with JSON output
3. Vector similarity search against pgvector embeddings (`lib/ai/embedding.ts`) — cosine distance, threshold 0.3, top-K=4, deduplicated to 8 unique chunks
4. Stream LLM response with context
5. Record turn telemetry (latency, tokens, cost, retrieval stats) to `chatTurns` table

### Content Ingestion (`lib/actions/crawl/`)
- QStash publishes crawl jobs → `POST /api/crawl` webhook processes them
- Handles HTML (Readability), PDFs (unpdf), Google Docs, Google Drive files
- Text chunked (900 char max, 120 char overlap) → embedded with `text-embedding-3-small` (1536 dims)
- Embeddings stored with HNSW index, domain-scoped

### Auth (`lib/auth/`)
- Session-based: SHA256-hashed tokens, 7-day expiry
- Two roles: `admin` (full access), `crawler` (crawl ops only)
- Guards: `requireAuth()`, `requireRole()` for server actions

### Database Schema (`lib/db/schema/`)
Core tables: `users`, `sessions`, `districts`, `schools`, `resources` (crawled content with contentHash dedup), `embeddings` (pgvector), `crawlSettings`, `crawlJobs`, `chatTurns`, `chatFeedback`

### Key Patterns
- **Server Actions** (`lib/actions/`) preferred over API routes for mutations
- **Domain scoping**: resources, embeddings, and chat turns all partitioned by domain string
- **Dev mode**: `dev_referer` cookie or `x-dev-referer` header overrides domain detection
- Models use Vercel AI Gateway (bare string IDs resolved automatically via `ai` package)

## Environment Variables

Validated at startup via `lib/env.mjs` (t3-env + Zod):

| Variable | Required |
|---|---|
| `DATABASE_URL` | Yes |
| `GOOGLE_CALENDAR_API_URL` | Yes |
| `GOOGLE_CALENDAR_API_KEY` | Yes |
| `QSTASH_TOKEN` | Yes |
| `NODE_ENV` | No (defaults to `development`) |

