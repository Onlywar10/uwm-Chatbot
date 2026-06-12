# Ingestion Pipeline Port — uwm-Chatbot ← catapult-cms-chatbot

Porting the upstream **catapult** ingestion/retrieval stack into **uwm-Chatbot**.
Reference: catapult branch `feat/javascript-crawl` (= `main` + 22 commits of JS-render work),
<<<<<<< Updated upstream
fetched as git remote `catapult/*` and checked out as a worktree at `/tmp/catapult-ref`.

Working branch: **`v2_chatbot_system`**.
=======
checked out as a worktree at `/tmp/catapult-ref` and fetched as git remote `catapult/*`.
>>>>>>> Stashed changes

The two repos share **no git history** → no `merge`/`rebase`. Port mechanic is
`git checkout catapult/feat/javascript-crawl -- <path>` (copy file into working tree) + manual
reconciliation, with `git diff HEAD catapult/feat/javascript-crawl -- <path>` to inspect.

<<<<<<< Updated upstream
## Working conventions (user preferences)
- **Many small commits** — one commit per dependency group / schema file / ported module (50+ total).
- **Single-line commit messages** — no body, no Co-Authored-By trailer.
- **Schema: generate only, never push.** Edit Drizzle schema + `pnpm db:generate`. Do NOT run
  `db:push`/`db:migrate` — user applies migrations to Neon themselves at the end.

=======
>>>>>>> Stashed changes
## Scope decisions (confirmed with user)
- **Data model:** adopt catapult's `entityType ("district"|"school") + entityId` model. **Wipe existing crawl/resource/embedding data and re-crawl** — no backfill migration needed.
- **Recurring crawls:** YES — port cron + `crawl_schedule` + `crawl_runs` + run tracking.
- **JS rendering:** YES — port `/api/render` + Puppeteer + `@sparticuz/chromium-min`.
<<<<<<< Updated upstream
- **Chat route:** keep ours; only rewire retrieval + lift RAG-only prompt/formatting. No translation.

## Keep (uwm-only, must NOT be clobbered)
- **Clerk auth** (`lib/auth/guards.ts`, `proxy.ts`, sign-in). Do not import catapult auth.
=======

## Keep (uwm-only, must NOT be clobbered)
- **Clerk auth** (`lib/auth/guards.ts`, `proxy.ts`, sign-in). Catapult uses a different auth — do not import it.
>>>>>>> Stashed changes
- **211 analytics** (`lib/analytics/*`, `lib/import/*`, schema `calls`/`needs`/`referrals`/`fieldCoverage`/`analyticsTurns`, `/admin/analytics`, `pnpm db:import`/`verify:queries`).
- **widgetConfigs** table + widget config server actions.
- **Our `/api/chat` route** — keep it; only swap its retrieval call (see Phase 5).

## Exclude (catapult features we do NOT want)
<<<<<<< Updated upstream
- AI tools: `lib/ai/tools/announcements.ts`, `staffDirectory.ts` (+ types, env, chat-route hints).
=======
- AI tools: `lib/ai/tools/announcements.ts`, `staffDirectory.ts` (+ their types, env, regex hints in chat route).
>>>>>>> Stashed changes
- Portal / Google Drive folder picker / intranet ingestion.
- Email reporting (`resend`, `@react-email/*`, `emailSchedule`, `/api/cron/email`, `dailyMetrics`).
- PDF report generation (`@react-pdf/renderer`).
- `safeprompt` moderation, `googleapis`, `@tanstack/react-table`, `bcryptjs`, `streamdown`, `react-hot-toast`.
- Catapult-only schema unrelated to ingestion: `clients`, `districtTopics`, `dailyMetrics`, `devLogs`, `emailSchedule`.

---

## Phase 1 — Dependencies
Add (ingestion only):
- `turndown@^7.2.4`, `@types/turndown@^5.0.6`, `@truto/turndown-plugin-gfm@^1.0.2`
- `node-html-parser@^7.1.0`
- `@langchain/textsplitters@^1.0.1`, `@langchain/core@^1.1.48`
- `minisearch@^7.2.0`
- `pdf2md-ts@^1.1.1`
- `puppeteer-core@^25.1.0`, `@sparticuz/chromium-min@^149.0.0`; dev: `puppeteer@^25.1.0`
<<<<<<< Updated upstream

Remove after Phase 3 (only used by replaced crawl files): `jsdom`, `@mozilla/readability`.
Skip: resend, @react-email/*, @react-pdf/renderer, googleapis, @tanstack/react-table, bcryptjs, streamdown, safeprompt, react-hot-toast, linkedom (unless a ported file imports it).

## Phase 2 — Schema (generate only, do NOT push)
Adopt entityId model:
=======
- bump `jsdom` 24.1.3 → 27.4.0 (only if still referenced after Readability removal; otherwise drop)

Skip: resend, @react-email/*, @react-pdf/renderer, googleapis, @tanstack/react-table, bcryptjs, streamdown, safeprompt, react-hot-toast, linkedom (unless a ported file imports it).

## Phase 2 — Schema + migration (destructive, OK to wipe)
Replace/extend (adopt entityId model):
>>>>>>> Stashed changes
- `crawlSettings`: add `entityType` (pgEnum `entity_type`), `entityId`, `renderJavascript`; drop `schoolId`, `pagesProcessed`.
- `resources`: add `entityId`; drop `schoolId`.
- `embeddings`: add `metadata` jsonb, `parentId`, `resourceId`.
- `crawlJobs`: align with catapult (fileType enum, run linkage, snapshots).
- New: `parentChunks`, `crawlRuns`, `crawlSchedule`.

<<<<<<< Updated upstream
Keep untouched: districts, schools, users, sessions, chatTurns, chatFeedback, widgetConfigs, calls, needs, referrals, fieldCoverage, analyticsTurns. (`entityId` references school/district ids by convention — no FK to catapult `clients`.)

Then `pnpm db:generate` → review migration SQL. **Stop. User applies it.**

## Phase 3 — Crawl pipeline + extraction
`git checkout catapult/feat/javascript-crawl --` these, then reconcile auth (→ Clerk guards) + entity model:
=======
Keep untouched: districts, schools, users, sessions, chatTurns, chatFeedback, widgetConfigs, calls, needs, referrals, fieldCoverage, analyticsTurns. (`entityId` references school/district ids by convention — no FK to catapult's `clients`.)

Then `pnpm db:generate` → review migration → `pnpm db:push` (wipe + recreate crawl/resource/embedding tables).

## Phase 3 — Crawl pipeline + extraction
`git checkout catapult/feat/javascript-crawl --` these, then reconcile auth (`requireAuth`/`requireRole` → our Clerk guards) and entity model:
>>>>>>> Stashed changes
- `lib/actions/crawl/{crawlRun,crawlSchedule,crawlSettings,processCrawlJob,publish,start,turndown,utils,render,renderPage,clearCrawlData,decodeCatapultEmail,crawlJobs}.ts`
- `lib/actions/crawl/handlers/{handler,html,pdf,google}.ts`
- `lib/actions/resources.ts`
- routes: `app/api/crawl/route.ts`, `app/api/render/route.ts`, `app/api/cron/crawl/route.ts`
<<<<<<< Updated upstream
- DELETE legacy `lib/actions/crawl/crawl.ts`.
=======
- DELETE our legacy `lib/actions/crawl/crawl.ts` (unused in-process crawler).
>>>>>>> Stashed changes

## Phase 4 — Chunking + embedding + retrieval
- `lib/ai/embedding.ts` (parent/child chunking + hybrid `findRelevantContent`)
- `lib/ai/retrieval/bm25.ts`, `lib/ai/keywordRanking.ts`
- `lib/ai/url.ts`, `lib/ai/tokens.ts` (reconcile vs ours)
<<<<<<< Updated upstream
- embeddings `Metadata` type + `lib/types/crawl.ts`

## Phase 5 — Chat route integration (MINIMAL)
Keep `app/api/chat/route.ts`. Change only:
- retrieval call → new hybrid `findRelevantContentForDomain` / `findRelevantContentForDomains`
- consume new `RetrievalHit` shape: `{ name, parentId, similarity, metadata.sourceUrl }`
- lift `composerSystemPromptRagOnly` + `[#n score=…]\n[Source: url]\n{name}` formatting + hit dedup.

## Phase 6 — Env + config + middleware
- `lib/env.mjs`: add `APP_URL`, `CRON_SECRET`, optional `RENDERER_URL`/`RENDERER_AUTH_TOKEN`/`CHROMIUM_PACK_URL`/`VERCEL_AUTOMATION_BYPASS_SECRET`. NOT staff/announce/email/safeprompt/calendar.
- `vercel.json`: add cron `/api/cron/crawl` (`0 * * * *`); `/api/render` 4 GB + maxDuration 120. Skip `/api/cron/email`.
- `proxy.ts`: add `/api/render(.*)` + `/api/cron/crawl(.*)` to public matcher.

## Phase 7 — Admin crawl UI
Update crawl-settings UI to new fields (`entityType`, `entityId`, `renderJavascript`); surface schedule/run status if desired.

## Phase 8 — Verify
- `pnpm lint`, `pnpm build`
- (User applies migration, then) run a one-shot crawl; confirm resources/parent_chunks/embeddings populate.
- Confirm `/api/chat` grounded answers; regression-check 211 analytics + Clerk auth.
=======
- `lib/db/schema/embeddings.ts` `Metadata` type + `lib/types/crawl.ts`

## Phase 5 — Chat route integration (MINIMAL — do not port catapult's route)
Decision confirmed: **keep our `app/api/chat/route.ts`** (229 lines). Catapult's 948-line route is
~700 lines of excluded features (announcements/staff tools, moderation/safeprompt, chat cache,
dev/eval logging, topic classification, entity/clients context). The retrieval *intelligence* lives
in `embedding.ts` (Phase 4), not the route. No translation.

Changes to our route:
- retrieval call → new hybrid `findRelevantContentForDomain` / `findRelevantContentForDomains`
- consume new `RetrievalHit` shape: `{ name, parentId, similarity, metadata.sourceUrl }` (parent-chunk content)
- **lift** catapult's `composerSystemPromptRagOnly` (from `lib/ai/prompts.ts`) as our system prompt
- **lift** catapult's context formatting: `[#n score=…]\n[Source: url]\n{name}` per hit + hit dedup
- adapt to entity model if route currently keys off `schoolId` (it keys off `domain` — likely fine).

## Phase 6 — Env + config + middleware
- `lib/env.mjs`: add `APP_URL`, `CRON_SECRET`, `VERCEL_AUTOMATION_BYPASS_SECRET?`, `RENDERER_URL?`, `RENDERER_AUTH_TOKEN?`, `CHROMIUM_PACK_URL?`. (QStash signing keys read by `@upstash/qstash` directly.) Do NOT add staff/announcement/email/safeprompt/calendar vars.
- `vercel.json`: add cron `/api/cron/crawl` (`0 * * * *`). Skip `/api/cron/email`. Configure `/api/render` function memory (4 GB) + maxDuration 120.
- `proxy.ts`: add `/api/render(.*)` and `/api/cron/crawl(.*)` to public route matcher (cron uses Bearer `CRON_SECRET`; render uses `x-renderer-token`).

## Phase 7 — Admin crawl UI
Update crawl-settings admin UI to the new fields (`entityType`, `entityId`, `renderJavascript`) and surface schedule/run status if desired.

## Phase 8 — Verify
- `pnpm lint`, `pnpm build`
- Run a one-shot crawl on a sample domain; confirm resources/parent_chunks/embeddings populate.
- Confirm `/api/chat` returns answers grounded in parent-chunk context.
- Confirm 211 analytics + Clerk auth still work (regression).
>>>>>>> Stashed changes
