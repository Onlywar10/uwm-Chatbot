# United Way of Merced — Product Vision & Current State

> Context primer. Drop this into a new conversation to explain what this system is,
> what it is becoming, and what is already known to be broken. Written 2026-07-24;
> all production numbers were verified against the live Neon database on that date.

---

## 1. The one-line definition

**One place to ask anything about what United Way of Merced does, sees, and offers — and get a sourced answer.**

Three verbs, deliberately chosen, because they map onto three different data domains with different audiences, freshness rhythms, and risk profiles:

| Verb | Meaning | Backing data | Primary audience |
|---|---|---|---|
| **Offers** | What help exists in Merced/Mariposa County | `directory_programs` — live iCarol mirror | Mostly external |
| **Sees** | What the community actually needs | `calls` → `needs` → `referrals` — 211 call history | Internal, curated for external |
| **Does** | UWM's programs, activity, and internal policy | Crawled website content; staff policy (does not exist yet) | Split |

### The framing trap to avoid

The instinctive description is "a repository for all useful analytical data UWM has access to." That defines the product by its **inputs**, which is how internal data platforms die: data goes in, nobody owns freshness, and within two years people trust a spreadsheet on someone's desktop more than the system.

Define it by **outputs** instead. Every new data source must earn its place by naming the questions it unlocks. If you cannot name three people who will ask a given question monthly, that source can wait.

---

## 2. What exists today

Three largely independent subsystems share one Next.js 16 codebase. Two are called "211" but are unrelated: one is a directory of *services to refer people to*, the other is a warehouse of *past calls*. They share no tables.

### Site RAG chat + crawling
Crawl → chunk → embed → answer, embedded on partner sites via an iframe widget.
Production scale is small: **267 embeddings over 112 parent chunks, across only 2 crawled domains.** Treat any crawl-scale assumption with suspicion.

### 211 resource referral (`lib/directory/`)
A nightly mirror of the live iCarol service directory, searched by the widget to recommend real programs.
**1,278 Program × Site rows over 962 programs; 2,288 AIRS taxonomy terms.**
Grain matters: a row is a concrete place a person can go or call.

### 211 caller analytics (`lib/analytics/`)
An internal admin chat over historical call data.
**21,305 calls / 28,565 needs / 38,880 referrals, spanning 2021-01 → 2026-06.**
Three-level grain: one call → many needs → many agency referrals. "Calls," "needs," "referrals," and "unique callers" are four different numbers.

### Delivery surfaces
- Public embeddable widget (currently **one** widget, `uwm-widget-001`, serving unitedwaymerced.org / 211merced.org / freetaxesmerced.com, with resource search enabled)
- Internal `/admin/analytics` AI chat
- `chat_turns` telemetry on every public turn; `analytics_turns` on every internal one

Whole database is ~95 MB. The 211 side dwarfs the crawled-content side.

---

## 3. The decision that defines everything: audience

"Serves internal staff and the external public" is doing a lot of quiet work in the vision. Three things change with audience — not just permissions:

**What's visible.** The auth model currently *cannot express this*. `requireRole()` in `lib/auth/guards.ts` ignores its argument and resolves to "is signed in?". Real scopes are a prerequisite, not a cleanup task, before the internal side holds anything sensitive.

**What honesty looks like.** The analytics tooling has structural honesty built in — denominators, coverage notes, "of the 446 calls where language was recorded." That is correct for staff and unusable for the public, who will not read the caveat and will screenshot the number.

**What a wrong answer costs.** A slightly-off resource referral is recoverable. A wrong staff-policy answer (PTO accrual, mandated reporter procedure) is an HR/legal problem. A wrong public statistic about community need is a press and funder problem.

### Recommended shape: one backend, two products

Shared ingestion, retrieval, and directory. The **public** surface stays deliberately narrow — *offers* and *does*. Anything from *sees* reaches the public only as a curated, human-approved artifact.

**Do not let a model improvise statistics to the public.**

---

## 4. The unique asset: Resource Health

Most organizations have one side of the ledger. UWM has both:

- A directory of what services **claim** to exist
- Call data on what people **actually needed** and whether they got it

The intersection is where the real product lives. `needs.reasonIfUnmet` is the key field — it distinguishes *"no such service exists"* (a directory/funding gap) from *"it exists but is full, ineligible, or closed"* (a capacity gap). Different problems, different fixes, different funders.

Questions that become answerable, that almost nobody else can answer:

- Which agencies absorb the most referrals, and what share come back unmet?
- Where are unmet needs a **directory gap** vs a **capacity gap**?
- Which directory entries have high referral volume but a stale `lastVerifiedOn`?
- Which programs sit in the directory but have never once been referred to — dead weight, or a search/discovery failure?
- Where are we sending people outside the county, and why?

**Why this matters strategically:** the third question produces a *prioritized work queue* for the resource team, not a chart. Data products that generate work get used. Ones that only generate charts get admired once and abandoned.

### The chatbot is an instrument, not just a channel

`chat_turns` is already collecting a demand signal independent of 211 call data. Triangulating **what the public asks the bot** × **what 211 callers need** × **what the directory contains** is a three-way read on community need that is genuinely novel and publishable.

---

## 5. Chat vs. dashboards: a pipeline, not a fork

These answer different question types. The common failure is building dashboards for questions asked once, and forcing chat for questions asked weekly.

**Operating principle: chat is the discovery layer; recurring questions get promoted into dashboards.**

This can be run empirically rather than by opinion — `chat_turns` and `analytics_turns` log every question asked. Cluster them quarterly; anything above a threshold becomes a fixed panel with a vetted number.

**Highest-value internal dashboard is probably funder and grant reporting** — recurring, painful, deadline-driven, currently manual.

---

## 6. Known blockers and sharp edges

Verified against code and the production database. These are real, not hypothetical.

### Blocking the vision
- **`requireRole('admin')` checks nothing.** Anyone with a Clerk account can read all 21k calls of 211 data. Whether that is a live exposure depends on Clerk sign-up restrictions (dashboard, not repo). Real role scopes are prerequisite to the internal/external split.
- **No staff policy content exists in the system.** The "Staff Policy Questions" pillar has no data behind it yet.

### Data quality
- **104 of 1,278 directory rows (8%) are unreachable by any search.** They have an empty `service_areas` array, and search prefilters with `arrayOverlaps`, which never matches an empty array. Root cause: `serviceAreaTokens()` in `lib/directory/transform.ts` returns `[]` when iCarol's `coverage[]` is absent, with no fallback to the row's own address. These are real local resources — The Trevor Project, six Mariposa cooling centers, Merced County Workforce Investment; 28 of them physically in Merced.
- **Field coverage is the whole ballgame for analytics honesty.** Most fields are partial and several only exist after an Oct-2025 questionnaire change: `language_canonical` 2,775/21,305; `children_under_5_count` 494; `health_insurance` 3,086 (2024-06 → 2025-10 only); `age_numeric` 9,942. Reporting a raw count off these without a denominator is the main way this system can lie.
- **"Unknown" ≠ missing.** In ethnicity/language, `Unknown` means the caller declined; a never-asked question is NULL. They must be reported separately.

### Operational
- **Freshness rhythms differ wildly** — directory nightly, call data monthly, website on a crawl schedule, policy ad-hoc. Every answer needs to carry its freshness, and staleness must be visible on the surface. Live example: the nightly directory sync silently never ran for two weeks because a middleware rule intercepted the cron.
- **`chat_turns` stores full prompts and responses forever**, including widget conversations that may carry crisis disclosures. No retention policy.
- **Migrations are abandoned.** Directory and analytics tables were applied via `db:push`; the migrations folder is stale.

### Recently hardened (2026-07-24)
Security work ported from the upstream `Catapult-CMS/catapult-cms-chatbot` product: SSRF guard on all outbound fetch/render paths, renderer endpoint failing closed, crawler retry/timeout, and five layers of abuse protection on the public chat endpoint (rate limit, origin allowlist, BotID, structural prefilter, per-widget token). Vitest introduced; 8 tests.

**Still required before deploy:** `RENDERER_AUTH_TOKEN` set in Vercel (app will not boot without it), and a WAF rule named `chat-turn` created in the Vercel dashboard (rate limiting no-ops until then).

---

## 7. Open questions

1. **Does staff policy content exist in ingestible form** — handbook documents, Google Drive — or is it currently in people's heads? This determines whether that pillar is an ingestion problem or a content-creation problem.
2. **For public dashboards: is the audience the general public, or funders and the board?** These look similar and are very different products with different tolerance for nuance.
3. What is the **data owner** for each of the four domains? "All useful data" with no named owner per source means nobody fixes the 104 unreachable rows.
4. Is there appetite to **publish** the triangulated community-need view, or is it internal-only?

---

## 8. Stack facts

Next.js 16 (App Router, React 19, React Compiler) · Vercel AI SDK 6 · Drizzle ORM on Neon Postgres with pgvector · Clerk auth · Upstash QStash for crawl jobs · Biome · pnpm, Node 24 · Vitest.

Deployed on Vercel. Repo: `Onlywar10/uwm-Chatbot`, project lives in `catapult-cms-chatbot/`.

**Related upstream product:** `Catapult-CMS/catapult-cms-chatbot` is a far more mature K-12 school-district sibling (better-auth, Sentry, evals, reporting/PDF, moderation, durable workflows). It is a *diverged cousin, not a merge target* — different product surface and stack (bun, better-auth, AI SDK 7). It is a proven source to cherry-pick hardening and reporting patterns from.

---

## 9. Suggested first vertical slice

Pick the one question this should answer better than anything else does today:

> **"Where is Merced County's help not matching Merced County's need?"**

It uses both sides of the ledger, serves staff and funders immediately, produces a work queue for the resource team, and has a public-safe curated version later.
