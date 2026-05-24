# 211 Analytics Tooling — Implementation Plan

Internal, admin-only natural-language analytics over 211 caller data, added to the
existing United Way of Merced chatbot. Structured AI-SDK tools (not text-to-SQL) over
a Neon Postgres model of the two source CSVs.

This plan is sequenced as **bite-sized Conventional Commits**, each touching **≤3 files**.
Two artifacts (`canonical-maps.ts`, `glossary.ts`) require **your sign-off** before they're
trusted — flagged with ⚠️ APPROVAL.

---

## Design recap (resolved)

- **3 tables**: `calls → needs → referrals`. Need-type/unmet are need-level (data-proven constant per `ReportNeedNum`); referrals hold only agency fields.
- **Two tools**: `queryCalls`, `queryServiceNeeds`. Metrics: `count_calls`, `count_needs`, `count_referrals`, `unmet_rate` (need-level), `avg|min|max_age`.
- **Filters**: enums for low-cardinality canonical fields; `agencyContains`/`taxonomyContains` ILIKE for high-cardinality; AND across fields, OR within a field, `groupBy` ≤3.
- **Dates** anchored to latest data date; complete calendar periods; resolved range echoed.
- **Structural honesty**: every tool result carries denominator + non-null count + coverage notes.
- **Field windows** computed on import into `field_coverage`; the Oct-2025 migration (deprecated/introduced columns) is handled by these windows, not hardcoding.
- **Canonicalize on import** (raw + canonical stored); unmapped future values pass through + loud report.
- **Import**: full-history → transactional truncate-and-reload via `pnpm db:import --calls <p> --referrals <p>`.
- **Surface**: `/admin/analytics` page + `/api/analytics` route, **admin-only, guarded in the route**. Stronger model, multi-step capped ~5. Public `/api/chat` untouched.
- **Verify**: golden-number regression script.

## Milestones (each is a usable checkpoint)

- **M1 — Data in DB** (end of Phase 3): rows queryable in Drizzle Studio; coverage table populated.
- **M2 — First answer end-to-end** (Phase 4 + minimal Phase 5): "how many calls last month" works via API.
- **M3 — Staff-usable UI** (end of Phase 6): analysts can ask questions at `/admin/analytics`.
- **M4 — Verified** (end of Phase 7): golden numbers green; all 8 example questions traced.

---

## Phase 0 — Scaffolding

- **`chore(deps): add csv-parse for streaming CSV import`**
  - `package.json`, `pnpm-lock.yaml`
- **`feat(config): add ANALYTICS_MODEL to env schema`**
  - `lib/env.mjs` — optional, defaults to the chosen stronger model id.

## Phase 1 — Database schema

- **`feat(db): add calls table schema`**
  - `lib/db/schema/calls.ts` — PK `call_report_num`; `entered_on`, `report_version`, `call_length`, geography, language/tele-interp, ethnicity/gender (raw + `_canonical`), `age` (raw) + `age_numeric`, children/seniors flags. (No `pregnant` — empty column dropped.) Indexes on `entered_on`, canonical demographics.
- **`feat(db): add needs and referrals table schemas`**
  - `lib/db/schema/needs.ts` — PK `report_need_num`, FK `call_report_num`, taxonomy L1–5, `airs_need_category`, `need_was_unmet` (bool), `reason_if_unmet`. Indexes on `airs_need_category`, `need_was_unmet`, `call_report_num`.
  - `lib/db/schema/referrals.ts` — synthetic PK, FK `report_need_num`, `resource_agency_num`, `agency_name_public`, parent agency. Index on `report_need_num`, `agency_name_public`.
- **`feat(db): add field_coverage metadata table`**
  - `lib/db/schema/fieldCoverage.ts` — `table_name`, `field`, `min_date`, `max_date`, `non_null_count`, `total_count`.
- **`feat(db): add analyticsTurns telemetry table`**
  - `lib/db/schema/analyticsTurns.ts` — question, tool calls + params (jsonb), resolved filters, row counts, coverage flags, latency/tokens/cost.
- **`chore(db): generate migration for analytics tables`**
  - `lib/db/migrations/*` (drizzle-kit generated). Run `pnpm db:generate`.

## Phase 2 — Domain config ⚠️ APPROVAL

- **`feat(config): add canonical value map`** ⚠️
  - `lib/data/canonical-maps.ts` — ethnicity merges ({African American/Black, Black or African American, African}, {Declined to answer, Caller Declined}, {Multi-ethnic, More than one ethnicity}, {Pacific Islander…}), typo fixes (`Native Amercian`), gender, language. **You review the merges before this is trusted.**
- **`feat(config): add query glossary`** ⚠️
  - `lib/data/glossary.ts` — term→filter: Parents→`hasChildren0to5`, ECM→`agencyContains:'ECM Support Services'`, Food pantry→`taxonomyContains:'Food Pantries'`, SNAP→`taxonomyContains:'SNAP'`, LIHEAP→`agencyContains:'LIHEAP'`, language assistance→non-English/tele-interp. **You confirm definitions.**

## Phase 3 — Import pipeline → **M1**

- **`feat(import): add Zod row schemas for both CSVs`**
  - `lib/import/schemas.ts`
- **`feat(import): add value normalizers (dates, age_numeric, booleans)`**
  - `lib/import/normalize.ts` — two date formats → `Date`; `100+`→100 / refusals→null for `age_numeric`; `"True"/"False"`→bool.
- **`feat(import): apply canonical map with unmapped tracking`**
  - `lib/import/canonicalize.ts` — raw→canonical, collect unmapped values.
- **`feat(import): parse CSVs with row validation + reject report`**
  - `lib/import/parse.ts` — streaming parse, lenient cells, skip bad-key/bad-date rows into a reject report.
- **`feat(import): transactional truncate-and-reload loader`**
  - `lib/import/load.ts` — one transaction: wipe + bulk insert calls→needs→referrals (dedupe 30 identical rows).
- **`feat(import): compute field_coverage on load`**
  - `lib/import/coverage.ts` — per-field min/max non-null date + counts.
- **`feat(import): add CLI entry and db:import script`**
  - `lib/import/index.ts`, `package.json` — `pnpm db:import --calls <p> --referrals <p>`; prints reject + unmapped reports.

## Phase 4 — Query builder + tools → (toward **M2**)

- **`feat(analytics): add shared filter + aggregate Zod schema`**
  - `lib/analytics/schema.ts` — filters (enums + `*Contains`, arrays = OR), aggregate (`metric`, `groupBy[]`, `orderBy`, `limit`), `dateRange`.
- **`feat(analytics): add data-anchored calendar date resolver`**
  - `lib/analytics/dates.ts` — preset → `{from,to}` using `max(entered_on)`; returns resolved range.
- **`feat(analytics): add core query builder (filters → Drizzle SQL)`**
  - `lib/analytics/builder.ts` — the black box; parameterized; joins calls↔needs↔referrals only when needed; result cap.
- **`feat(analytics): add denominator + coverage-note helpers`**
  - `lib/analytics/coverage.ts` — base/total counts, non-null counts, out-of-window notes from `field_coverage`.
- **`feat(analytics): add queryCalls and queryServiceNeeds tools`**
  - `lib/analytics/tools.ts` — AI-SDK tools wrapping the builder; structural-honesty return payload.

## Phase 5 — API route + prompt → **M2**

- **`feat(analytics): add system prompt builder`**
  - `lib/analytics/prompt.ts` — schema description + glossary + generated field-window summary + honesty + clarify-on-material-ambiguity rules.
- **`feat(api): add /api/analytics route (admin-guarded, multi-step tools)`**
  - `app/api/analytics/route.ts` — `requireRole('admin')` in-route, stronger model, `stopWhen: stepCountIs(5)`, streams.
- **`feat(analytics): log analytics turns`**
  - `lib/analytics/telemetry.ts`, `app/api/analytics/route.ts`.

## Phase 6 — UI surface → **M3**

- **`feat(admin): add /admin/analytics page (admin-only)`**
  - `app/admin/analytics/page.tsx` — server guard `requireRole('admin')`.
- **`feat(admin): add multi-turn analytics chat component`**
  - `app/admin/analytics/AnalyticsChat.tsx` — `useChat` against `/api/analytics`, full thread view.
- **`feat(admin): add evidence strip (range, filters, numbers)`**
  - `components/EvidenceStrip.tsx`, `app/admin/analytics/AnalyticsChat.tsx` — renders tool-result metadata; SQL behind dev toggle.
- **`feat(admin): link analytics from admin nav`**
  - `app/admin/AdminClient.tsx`.

## Phase 7 — Verification → **M4**

- **`test(analytics): add golden-number cases from CSV`**
  - `scripts/verify/cases.ts` — ~10–15 Q→known-answer pairs (incl. distinct-need vs row traps, unmet rate, canonical merges).
- **`test(analytics): add verify:queries runner`**
  - `scripts/verify/index.ts`, `package.json` — `pnpm verify:queries` asserts tools vs known answers.
- **`docs: document analytics commands and architecture`**
  - `CLAUDE.md`.

---

## Example questions → final interface

| Question | Call |
|---|---|
| People last month | `queryCalls{ metric:'count_calls', dateRange:'last_month' }` |
| Busiest day last week | `queryCalls{ 'count_calls', groupBy:['day'], orderBy:'metric_desc', dateRange:'last_week' }` |
| Parents last week | `queryCalls{ 'count_calls', hasChildren0to5:true, dateRange:'last_week' }` (coverage note: field since 2025-10) |
| ECM referrals last month | `queryServiceNeeds{ 'count_referrals', agencyContains:'ECM Support Services', dateRange:'last_month' }` |
| Avg age → LIHEAP | `queryCalls{ 'avg_age', agencyContains:'LIHEAP' }` (denominator = numeric ages) |
| Spanish + other language assist | `queryCalls{ 'count_calls', language:['Spanish','non_english'], groupBy:['language'] }` |
| Top food-pantry agencies, 3mo | `queryServiceNeeds{ 'count_referrals', taxonomyContains:'Food Pantries', groupBy:['agency'], orderBy:'metric_desc', limit:10, dateRange:'last_3_months' }` |
| SNAP cuts vs supply | `queryServiceNeeds{ 'count_needs', needCategory:['Food/Meals'], groupBy:['month'] }` + `{ unmet_rate, groupBy:['month','reasonIfUnmet'] }` across Jan–Apr |
