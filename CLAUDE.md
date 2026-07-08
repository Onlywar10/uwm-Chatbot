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

# 211 Analytics (internal)
pnpm db:import --calls <master.csv> --referrals <unmet_met.csv>      # Truncate-reload analytics tables
pnpm verify:queries --calls <master.csv> --referrals <unmet_met.csv> # Golden-number regression check

pnpm db:seed-widget   # Seed a demo widget config (scripts/seed-demo-widget.ts)
```

The 211 source CSVs live outside this repo at `../csvData/` (the working tree parent, `uwm-Chatbot/`, also holds the raw 7-file iCarol export that is not imported).

No test framework is configured; `pnpm verify:queries` cross-checks analytics numbers against the CSVs.

## Tech Stack

- **Next.js 16** (App Router, React 19, React Compiler enabled)
- **Vercel AI SDK 6** — models referenced by bare string IDs (e.g., `"openai/gpt-5"`, `"text-embedding-3-small"`), routed via AI Gateway in prod or directly to OpenAI when `OPENAI_API_KEY` is set (`lib/analytics/model.ts`)
- **Drizzle ORM** on **Neon PostgreSQL** (serverless HTTP driver) with pgvector for embeddings
- **Upstash QStash** for async crawl job processing via webhooks
- **Biome** for linting and formatting (not ESLint/Prettier). Line width: 100
- **shadcn/ui** + Tailwind CSS 4 + Framer Motion
- **TypeScript** strict mode. Path alias `@` maps to project root
- **pnpm** (>=10.28.0), Node 24.x

## Architecture

### RAG Chat Pipeline (`app/api/chat/route.ts`)
1. Resolve tenant: `widgetId` in the request body → widget's configured domain list; otherwise domain parsed from the request referer
2. Generate 1-3 retrieval queries via `generateText()` with JSON output (`openai/gpt-4o-mini`)
3. Hybrid retrieval per query (`lib/ai/embedding.ts` → `findRelevantContentBase`): pgvector cosine search over child embeddings (threshold 0.3, top 30 candidates, joined to their parent chunks), rescored as `0.7·vector + 0.3·BM25` (MiniSearch over title/headers/categories, `lib/ai/retrieval/bm25.ts`), then keyword-boosted (`lib/ai/keywordRanking.ts`); top 10 parent chunks per query, deduplicated to 8 across queries
4. Stream answer with `openai/gpt-5`; CORS allowlist in the route governs which external origins may call it
5. Record turn telemetry (latency, tokens, cost, retrieval stats) to `chatTurns` table

### Content Ingestion (`lib/actions/crawl/`)
- QStash publishes crawl jobs → `POST /api/crawl` webhook processes them
- Handles HTML (Readability), PDFs (unpdf), Google Docs, Google Drive files
- JS-heavy pages: crawl settings can enable "Render JavaScript", which calls the headless-Chromium renderer at `POST /api/render` (puppeteer + Sparticuz Chromium, guarded by `RENDERER_AUTH_TOKEN`; needs the 4GB "Performance" function size on Vercel)
- Parent/child chunking: markdown split into ~2000-char parent chunks (`parent_chunks` table), each re-split into ~700-char children; only children are embedded (`text-embedding-3-small`, 1536 dims) but retrieval returns the parent's full content
- Embeddings stored with HNSW index, domain-scoped
- Scheduled recrawls: `crawlSchedule`/`crawlRuns` tables, driven by `GET /api/cron/crawl` (Vercel cron, `CRON_SECRET` bearer auth)

### Embeddable Widget (`app/widget/[id]/`)
- Public chat UI served in an iframe, configured per-tenant via the `widget_configs` table (name, domain list, greeting, suggested questions, accent color, enabled flag); managed through server actions in `lib/actions/widgetConfigs.ts`
- A widget aggregates content across all of its configured domains (`findRelevantContentForDomains`); its chat turns are recorded under the pseudo-domain `widget:<id>`
- `test-widget.html` at the repo root is a local embed harness

### Auth (`lib/auth/`)
- **Clerk** is the identity provider (`@clerk/nextjs` v7). `ClerkProvider` wraps the app in `app/layout.tsx`; `clerkMiddleware()` in `proxy.ts` protects every route except the public surface (`/sign-in`, `/api/chat`, `/api/crawl`, `/widget`). Sign-in UI is Clerk's prebuilt `<SignIn/>` at `/sign-in`; logout is `<SignOutButton>` in `components/LogoutButton.tsx`.
- Single access level: any signed-in user can access all protected routes (no role tiers). Guards `requireAuth()` / `requireRole()` in `lib/auth/guards.ts` both resolve to "is signed in?" via Clerk `auth()`; `requireRole`'s argument is ignored and kept only for call-site compatibility.
- The legacy `users`/`sessions` tables are no longer used by auth (Clerk owns identity + sessions); they remain in the schema pending an optional cleanup migration.

### Database Schema (`lib/db/schema/`)
Core tables: `users`, `sessions`, `districts`, `schools`, `resources` (crawled content with contentHash dedup), `parentChunks`, `embeddings` (pgvector, child chunks referencing a parent), `crawlSettings`, `crawlJobs`, `crawlRuns`, `crawlSchedule`, `widgetConfigs`, `chatTurns`, `chatFeedback`

Analytics tables: `calls` → `needs` → `referrals` (3-level grain from the 211 CSVs), `field_coverage` (per-field availability windows), `analytics_turns` (telemetry).

### 211 Analytics Tooling (internal, admin-only)
- **Data** (`lib/import/`): `pnpm db:import` parses the two 211 CSVs, normalizes/canonicalizes (`lib/data/canonical-maps.ts`), and truncate-reloads `calls`/`needs`/`referrals`, recomputing `field_coverage`. Three-level grain: one call → many needs → many agency referrals. "Calls", "needs", and "referrals" are distinct counts.
- **Tools** (`lib/analytics/`): two AI-SDK tools, `queryCalls` + `queryServiceNeeds`, over one Drizzle builder (`builder.ts`). Filters are enums (low-card) + ILIKE (`agencyContains`/`taxonomyContains`); dates anchor to `max(entered_on)`. Every result carries denominator + coverage notes (structural honesty). Term→filter glossary in `lib/data/glossary.ts`.
- **Surface**: `/admin/analytics` page + `/api/analytics` route, guarded by `requireRole('admin')` in the route. Model from `ANALYTICS_MODEL`, multi-step (`stopWhen` 5). Public `/api/chat` is untouched.
- **Verify**: `pnpm verify:queries` cross-checks builder output against the CSVs.

### Key Patterns
- **Server Actions** (`lib/actions/`) preferred over API routes for mutations
- **Domain scoping**: resources, embeddings, and chat turns all partitioned by domain string
- **Dev mode**: `dev_referer` cookie or `x-dev-referer` header overrides domain detection
- Models use Vercel AI Gateway (bare string IDs resolved automatically via `ai` package)

## Environment Variables

Validated at startup via `lib/env.mjs` (t3-env + Zod):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk (browser) |
| `CLERK_SECRET_KEY` | Yes | Clerk (server) |
| `QSTASH_TOKEN`, `QSTASH_URL` | Yes | Crawl job queue |
| `APP_URL` | Yes | Public base URL; builds QStash/renderer callback URLs |
| `ANALYTICS_MODEL` | No | Defaults to `openai/gpt-5` |
| `OPENAI_API_KEY` | No | When set, analytics chat bypasses AI Gateway and talks to OpenAI directly (local dev) |
| `RENDERER_URL`, `RENDERER_AUTH_TOKEN`, `CHROMIUM_PACK_URL` | No | Headless-render service; `RENDERER_URL` defaults to `${APP_URL}/api/render` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | No | Lets internal callbacks reach deployment-protected environments |
| `CRON_SECRET` | No | Bearer token for `/api/cron/crawl` (read from `process.env` directly, not `lib/env.mjs`) |
| `NODE_ENV` | No | Defaults to `development` |

