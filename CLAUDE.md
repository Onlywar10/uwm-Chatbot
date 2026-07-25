# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Catapult CMS Chatbot — a Next.js app that embeds an AI chatbot on school district and nonprofit websites. Uses RAG (Retrieval-Augmented Generation) over crawled website content with multi-language support. Multi-tenant: all data is scoped by domain.

Three largely independent subsystems share the codebase:
1. **Site RAG chat + crawling** — the original product (`/api/chat`, `lib/actions/crawl/`, `lib/ai/`)
2. **211 resource referral** — a mirrored 211 service directory the widget can search and recommend from (`lib/directory/`), opt-in per widget
3. **211 caller analytics** — an internal admin-only chat over historical iCarol call data (`lib/analytics/`, `lib/import/`)

Subsystems 2 and 3 are unrelated despite both being "211": (2) is a live directory of *services to refer people to*, (3) is a warehouse of *past calls*. They share no tables.

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build
pnpm lint             # Biome check (lint + format check) — currently red, see Sharp Edges
pnpm format           # Biome format --write
pnpm test             # Vitest (lib/**/*.test.ts)

# Database
pnpm db:generate      # Generate migrations from schema changes
pnpm db:migrate       # Run migrations (tsx lib/db/migrate.ts)
pnpm db:push          # Push schema directly to database
pnpm db:studio        # Open Drizzle Studio UI

# 211 resource directory (live iCarol mirror)
pnpm db:sync-directory   # Full sync from the iCarol Resource API (also runs nightly via cron)

# 211 caller analytics (internal)
pnpm db:import --calls <master.csv> --referrals <unmet_met.csv>      # TRUNCATE-reload analytics tables
pnpm exec tsx scripts/upsert-analytics.ts \
  --calls <master.csv> --referrals <unmet_met.csv> [--raw <CallReports.csv>]  # Idempotent upsert
pnpm verify:queries --calls <master.csv> --referrals <unmet_met.csv> # Golden-number regression check

pnpm db:seed-widget   # Seed a demo widget config (scripts/seed-demo-widget.ts)
```

The 211 CSVs live outside this repo at `../csvData/`.

**Loading a new monthly analytics export: use `upsert-analytics.ts`, not `db:import`.** `db:import` truncates, so it drops history the newer export's window no longer covers (the 2026-07 export starts at 2022 and would delete 2021 from Neon) and wipes `calls.caller_key`. The upsert script preserves both, re-derives canonical values for *all* rows against the current `lib/data/canonical-maps.ts`, and recomputes `field_coverage` from the full post-upsert DB. Pass `--raw <iCarolExport-…-CallReports-*.csv>` to (re)populate `caller_key`; it reads only `CallReportNum` + `PhoneNumberFull` and stores a salted hash, never the number.

No test framework is configured. `pnpm verify:queries` is the closest thing: it replays golden cases against the CSVs. It compares the builder to the *files you pass it*, so after an upsert that kept older history the counts legitimately diverge — run it against a truncate-reloaded DB, or read failures as "DB has more than this CSV" before treating them as bugs.

## Tech Stack

- **Next.js 16** (App Router, React 19, React Compiler enabled)
- **Vercel AI SDK 6** — models referenced by bare string IDs (e.g., `"openai/gpt-5"`, `"text-embedding-3-small"`), routed via AI Gateway in prod or directly to OpenAI when `OPENAI_API_KEY` is set (`lib/analytics/model.ts`)
- **Drizzle ORM** on **Neon PostgreSQL** (serverless HTTP driver) with pgvector for embeddings
- **Upstash QStash** for async crawl job processing via webhooks (signature-verified)
- **iCarol Resource API** — upstream system of record for the 211 service directory (`lib/directory/icarol.ts`)
- **Biome** for linting and formatting (not ESLint/Prettier). Line width: 100
- **shadcn/ui** + Tailwind CSS 4 + Framer Motion
- **TypeScript** strict mode. Path alias `@` maps to project root
- **pnpm** (>=10.28.0), Node 24.x

## Architecture

### RAG Chat Pipeline (`app/api/chat/route.ts`)
1. Resolve tenant: `widgetId` in the request body → widget's configured domain list; otherwise domain parsed from the request referer
2. Generate 1-3 retrieval queries via `generateText()` with JSON output (`openai/gpt-4o-mini`)
3. Hybrid retrieval per query (`lib/ai/embedding.ts` → `findRelevantContentBase`): pgvector cosine search over child embeddings (threshold 0.3, top 30 candidates, joined to their parent chunks), rescored as `0.7·vector + 0.3·BM25` (MiniSearch over title/headers/categories, `lib/ai/retrieval/bm25.ts`), then keyword-boosted (`lib/ai/keywordRanking.ts`); top 10 parent chunks per query, deduplicated to 8 across queries
4. If the widget has `enableResourceSearch`, run the deterministic crisis keyword screen (`lib/directory/crisis.ts`) **before** the model, append `REFERRAL_PROMPT_SECTION` to the system prompt, and register the referral tools with `stopWhen(stepCountIs(5))`
5. Stream answer with `openai/gpt-5`; CORS allowlist in the route governs which external origins may call it
6. Record turn telemetry (latency, tokens, cost, retrieval stats, referral tool calls) to `chatTurns` table

The site-RAG prefetch in steps 2–3 runs for **every** tenant, referral-enabled or not — resource search is additive, never a replacement.

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
- `enableResourceSearch` (default off) is the per-widget switch for the 211 referral tools below. Prod currently has exactly one widget, `uwm-widget-001`, with it **on**, serving `unitedwaymerced.org`, `211merced.org`, and `freetaxesmerced.com`.

### 211 Resource Directory & Referral (`lib/directory/`)
A searchable mirror of the live 211 Merced/Mariposa service directory, used by the widget to recommend real programs. Independent of the caller-analytics tables.

- **Sync** (`index.ts` → `icarol.ts` → `transform.ts` → `load.ts`): sweeps Active programs from the iCarol Resource API, fetches program/site/fallback-agency detail, resolves AIRS taxonomy codes through the append-only `directory_taxonomy` cache, flattens to **one row per Program × Site**, and embeds with content-hash reuse so an unchanged nightly run costs no embedding calls. `loadDirectory` is a transactional truncate-reload — a failed sync leaves yesterday's data intact. Runs via `pnpm db:sync-directory` or `GET /api/cron/directory-sync` (nightly 09:00 UTC).
- **Grain matters**: a row is a concrete place you can go or call. Programs with no Site get one row with a null location, falling back to the agency's address when public. Confidential contacts are stripped at import — nothing private is stored.
- **`service_areas`** holds normalized coverage tokens (`city:atwater`, `county:merced`, `zip:95365`, `state:ca`) derived from iCarol's structured `coverage[]`. The GIN-indexed array is the hard prefilter for every search, so **a row with no tokens can never be returned** (see Sharp Edges).
- **Search** (`search.ts`): one SQL query combines the service-area prefilter with pgvector cosine similarity (floor 0.22, 40 candidates), then rescores `0.7·vector + BM25` — BM25 weight drops 0.3 → 0.12 for needs longer than 4 words, since fuzzy hits leapfrog the vector ranking on conversational phrasing. Then keyword ranking, coverage-tier boosts (site-in-city > covers-city > covers-county), and dedup to one row per program. `MIN_TOP_SIMILARITY` (0.32) is an honesty gate: below it, return `noGoodMatch` rather than noise. `PAGE_SIZE` is 3, capped in the tool rather than the prompt so display stays deterministic.
- **Region** (`region.ts`): a hardcoded Merced/Mariposa city/zip → county map. Unknown city or zip degrades to a region-wide search *with a note* the model is told to relay.
- **Tools** (`tools.ts`): `searchResources` + `getResourceDetails`, following the `lib/analytics` conventions (shared log array, error sentinel that tells the user to dial 2-1-1).
- **UI**: `app/widget/[id]/ResourceCards.tsx` renders at most 3 cards from the last `searchResources` tool part; `CrisisCard.tsx` is a static 988/911/2-1-1 card shown when the `crisis` message-metadata flag is set. The prompt tells the model the cards own the facts — it must not restate phone numbers, addresses, or hours.

### Abuse Protection (public surface)
Ported from the upstream `Catapult-CMS/catapult-cms-chatbot` product, which hardened these paths first. `POST /api/chat` is public and unauthenticated, and every turn spends a `gpt-4o-mini` query-gen plus a `gpt-5` completion, so it is gated in this order:

1. **Rate limit** — `checkRateLimit("chat-turn")` (`@vercel/firewall`) before any work. **Requires a WAF rule named `chat-turn` in the Vercel dashboard**; until that exists the SDK no-ops, so local dev is never blocked. Fails open.
2. **Origin allowlist** — `originAllowed()`. The widget iframe is served by this app, so a legitimate POST carries our own Origin or one of `ALLOWED_ORIGINS`. A present-but-foreign Origin is rejected; an absent one falls through to the next two layers.
3. **BotID** — `checkBotId()` (`botid/server`), with the client proof attached by `initBotId` in `instrumentation-client.ts` and the first-party challenge rewrites added by `withBotId` in `next.config.ts`. Fails open; a no-op locally.
4. **Structural prefilter** — `checkInputShape()` (`lib/ai/inputShape.ts`): empty, >2000 chars, >5 URLs, or repetitive spam is rejected with **zero** network calls.
5. **Per-widget token** — `widget_configs.widget_token`, rendered by the widget page and echoed by its client on every POST. Not a secret (it ships to the browser); it stops a guessed widget id alone from driving the bot and gives a revocation handle — rotate one row to cut off an abused embed instead of taking the endpoint down.

Outbound requests are guarded too: `lib/net/ssrf.ts` (`assertUrlAllowed`) rejects non-http(s) schemes and any host resolving to loopback/private/link-local/CGNAT/metadata space. It is applied in `fetchWithRetry`, in `renderPage` (including each in-browser navigation hop, so a redirect can't steer Chromium internally), and in `/api/render`. `lib/net/ssrf.test.ts` covers it — run with `pnpm test`.

### Auth (`lib/auth/`)
- **Clerk** is the identity provider (`@clerk/nextjs` v7). `ClerkProvider` wraps the app in `app/layout.tsx`; `clerkMiddleware()` in `proxy.ts` protects every route except the public surface listed in `isPublicRoute` (`/sign-in`, `/api/chat`, `/api/crawl`, `/api/render`, `/api/cron/crawl`, `/widget`). Sign-in UI is Clerk's prebuilt `<SignIn/>` at `/sign-in`; logout is `<SignOutButton>` in `components/LogoutButton.tsx`.
- `/widget` is excluded from the middleware `matcher` entirely, not just from protection: `clerkMiddleware()` issues a dev-browser handshake 307 on every matched route, which navigates the cross-site iframe to `clerk.accounts.dev` and renders it blank. Do not re-add it.
- **Adding a machine-called route (cron, webhook) means adding it to `isPublicRoute`.** Its own bearer/signature check is the real guard; the middleware entry is what lets the request reach it at all.
- Single access level: any signed-in user can access all protected routes (no role tiers). Guards `requireAuth()` / `requireRole()` in `lib/auth/guards.ts` both resolve to "is signed in?" via Clerk `auth()`; `requireRole`'s argument is ignored and kept only for call-site compatibility.
- The legacy `users`/`sessions` tables are no longer used by auth (Clerk owns identity + sessions); they remain in the schema pending an optional cleanup migration.

### Database Schema (`lib/db/schema/`)
Core tables: `users`, `sessions`, `districts`, `schools`, `resources` (crawled content with contentHash dedup), `parentChunks`, `embeddings` (pgvector, child chunks referencing a parent), `crawlSettings`, `crawlJobs`, `crawlRuns`, `crawlSchedule`, `widgetConfigs`, `chatTurns`, `chatFeedback`

Directory tables: `directory_programs` (Program × Site rows, pgvector embedding, GIN-indexed `service_areas`), `directory_taxonomy` (append-only AIRS term cache).

Analytics tables: `calls` → `needs` → `referrals` (3-level grain from the 211 CSVs), `field_coverage` (per-field availability windows), `analytics_turns` (telemetry).

Rough production shape (July 2026, ~95 MB): 21.3k calls / 28.6k needs / 38.9k referrals spanning 2021-01 → 2026-06; 1,278 directory rows over 962 programs; 2,288 taxonomy terms; 267 embeddings over 112 parent chunks across only 2 crawled domains; 1 widget. The crawled-content side is far smaller than the 211 side — treat crawl-scale assumptions with suspicion.

### 211 Caller Analytics (internal, admin-only)
- **Data** (`lib/import/`, `scripts/upsert-analytics.ts`): parses the two curated 211 CSVs, normalizes/canonicalizes (`lib/data/canonical-maps.ts`), and loads `calls`/`needs`/`referrals`, recomputing `field_coverage`. Three-level grain: one call → many needs → many agency referrals. "Calls", "needs", and "referrals" are distinct counts, and so is "unique callers".
- **`caller_key`**: a salted SHA-256 of the caller's normalized phone, enriched only from the **raw** iCarol `CallReports` export (the curated CSVs are de-identified). It backs `count_unique_callers`. The salt in `upsert-analytics.ts` must never change or every caller gets a new identity. Coverage is 2022+ (19,057 of 21,305 calls; 12,305 distinct callers) — 2021 has none, and the tool prompt requires saying so.
- **Tools** (`lib/analytics/`): two AI-SDK tools, `queryCalls` + `queryServiceNeeds`, over one Drizzle builder (`builder.ts`). Filters are enums (low-card) + ILIKE (`agencyContains`/`taxonomyContains`); dates anchor to `max(entered_on)`. Every result carries denominator + coverage notes (structural honesty). Term→filter glossary in `lib/data/glossary.ts` — **read it before adding a metric**, it encodes what each business term is allowed to mean.
- **Field coverage is the whole ballgame.** Most fields are partial and several only exist after an Oct-2025 questionnaire change: `language_canonical` 2,775/21,305 (2025-10+), `children_under_5_count` 494 (2025-10+), `seniors_60_plus_count` 2,127 (2025-10+), `health_insurance` 3,086 (2024-06 → 2025-10 only), `age_numeric` 9,942, `ethnicity_canonical` 11,695. Reporting a raw count off these without the denominator is the main way this tool lies.
- **`timeOfDay`**: `business_hours` = Mon–Fri 08:00–16:59 on `entered_on`, per the United Way deliverables definition. `entered_on` is naive **local** time (the hour histogram peaks 09:00–15:00), so this comparison is only correct as long as iCarol keeps exporting local time.
- **"Unknown" ≠ missing**: in ethnicity/language, `Unknown` means the caller declined; a never-asked question is NULL. The prompt requires reporting them separately.
- **Surface**: `/admin/analytics` page + `/api/analytics` route, guarded by `requireRole('admin')` in the route (which, see Auth, means "any signed-in user"). Model from `ANALYTICS_MODEL`, multi-step (`stopWhen` 5). Public `/api/chat` is untouched.
- **Verify**: `pnpm verify:queries` replays golden cases (`scripts/verify/cases.ts`) against the CSVs.

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
| `ICAROL_API_KEY` | No | 211 directory sync; sync fails fast with a clear error when unset |
| `ICAROL_DB_ID` | No | Defaults to `65861` (United Way of Merced County) |
| `ANALYTICS_MODEL` | No | Defaults to `openai/gpt-5` |
| `OPENAI_API_KEY` | No | When set, analytics chat bypasses AI Gateway and talks to OpenAI directly (local dev) |
| `RENDERER_AUTH_TOKEN` | **Yes** | Guards `POST /api/render`. Required on purpose: as `.optional()` an unset value silently disabled the auth check on an SSRF-capable endpoint |
| `RENDERER_URL`, `CHROMIUM_PACK_URL` | No | Headless-render service; `RENDERER_URL` defaults to `${APP_URL}/api/render` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | No | Lets internal callbacks reach deployment-protected environments |
| `CRON_SECRET` | No | Bearer token for both cron routes (read from `process.env` directly, not `lib/env.mjs`) |
| `NODE_ENV` | No | Defaults to `development` |

Also read directly from `process.env` (not declared in `lib/env.mjs`): `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`, used by `verifySignatureAppRouter` on `/api/crawl`.

## Scheduled Jobs (`vercel.json`)

| Cron | Schedule | Route |
|---|---|---|
| Crawl due schedules | hourly (`0 * * * *`) | `GET /api/cron/crawl` |
| 211 directory sync | nightly 09:00 UTC | `GET /api/cron/directory-sync` |

`app/api/render/route.ts` is pinned to 3009 MB. Both cron routes authenticate with `Bearer ${CRON_SECRET}` and return 401 when the secret is unset — they fail closed.

## Sharp Edges

Verified against the code and the production database; fix or confirm before relying on any of these.

- **104 of 1,278 directory rows have an empty `service_areas` array and are unreachable by any search.** `searchDirectory` prefilters with `arrayOverlaps(service_areas, tokens)`, which never matches an empty array. The cause is `serviceAreaTokens()` in `transform.ts` returning `[]` when iCarol's `coverage[]` is absent, with no fallback to the site's own address. These are real local resources — The Trevor Project, six Mariposa cooling centers, Merced County Workforce Investment — 28 of them physically in Merced. A fallback to `city:`/`county:` from the row's own address would recover them.
- **`requireRole('admin')` does not check a role.** It resolves to "is signed in?" — so anyone with a Clerk account in this instance can read all 21k calls of 211 data through `/admin/analytics`, and `/api/analytics` is the same. Whether that is a real exposure depends entirely on Clerk's sign-up restrictions, which live in the Clerk dashboard, not this repo. Upstream's `lib/auth/guards.ts` (`requirePlatformAdmin` / `requirePlatformOwner`, role read fresh from the DB) is the shape to copy when this is fixed.
- **`addTurn()` in `lib/actions/dev.ts` is an unguarded `"use server"` action** that inserts caller-supplied JSON into `chat_turns`.
- **`chat_turns` stores full prompts and responses forever**, including widget conversations that may carry crisis disclosures. There is no retention policy and `clearTurns()` is manual.
- **The legacy `users` table still holds a real admin email and `password_hash`** even though Clerk owns identity. Dead credential; drop it.
- **`region.ts` has `"catheys valley"` but the directory data has `"cathey's valley"`** — the apostrophe form never matches the city map.
- **`pnpm lint` is red (122 errors), and the working tree has mixed line endings.** Roughly 100 are Biome formatter diagnostics: some files are CRLF, some LF, so neither `formatter.lineEnding` setting makes it clean (setting `crlf` drops it to 61 by breaking the other half). The real fix is a one-time normalization — add `.gitattributes` with `* text=auto eol=lf`, re-checkout, then `pnpm format` once — done deliberately on a clean tree, not mixed into a feature branch. Genuine lint findings underneath are small: `useTemplate` ×10, `useArrowFunction` ×9, `noDocumentCookie` ×2, plus single `noExplicitAny` / `noNonNullAssertion` / `useExhaustiveDependencies`.

