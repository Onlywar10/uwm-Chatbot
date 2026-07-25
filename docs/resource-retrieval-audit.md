# Resource Retrieval — State of the Tool

> Audit dated 2026-07-24. Every number below was measured against the live Neon
> directory (1,278 rows / 962 programs) by running the real `searchDirectory` code
> path, not by reading it. Reproduce with a probe script that calls
> `searchDirectory()` and decomposes the score components.

---

## Headline

The retrieval system has **four independent defects** that compound. In order of impact:

1. **Ranking is driven by noise, not relevance.** The vector-similarity spread across top candidates is ~0.04, while the BM25 and location-boost terms swing up to 0.22 combined. The tie-breakers are 3–5× larger than the signal they are supposed to break ties on.
2. **Recall is truncated before ranking.** A 40-row cap is applied before dedup and before rescoring. A realistic query loses **208 of 238 matching programs** to that cap.
3. **104 of 1,278 rows (8%) are structurally invisible** — unreachable by any query, ever. They include every cooling center in both counties.
4. **The conversation design invites redundant questions**, mostly from two contradictory prompt regimes and a missing "location already known" state signal.

All three of your reported symptoms are explained by these, and each is fixable independently.

---

## How the system works today

### Pipeline position

```
POST /api/chat
  ├─ abuse gates (rate limit, origin, BotID, input shape, widget token)
  ├─ crisis keyword screen            ← deterministic, pre-model
  ├─ query-gen LLM call (gpt-4o-mini) ← for the WEBSITE KB, runs on every turn
  ├─ site-RAG retrieval               ← website chunks, runs on every turn
  └─ streamText(gpt-5, stopWhen=5 steps)
        └─ tools: searchResources / getResourceDetails   ← only if widget.enableResourceSearch
```

Resource search is **additive**: the website RAG prefetch runs for every turn whether or not the question is about a resource. Tool results are the only path by which directory data reaches the model.

### The search itself (`lib/directory/search.ts`)

1. `resolveUserLocation()` turns city/zip/county into coverage tokens (`city:merced`, `county:merced`, `state:ca`). No location → the whole two-county region.
2. One SQL query: `arrayOverlaps(service_areas, tokens)` **AND** `similarity > 0.22`, ordered by similarity, **`LIMIT 40`**.
3. If the pool is empty or top similarity `< 0.32`, return `noGoodMatch`.
4. Rescore the 40: `0.7·vector + w·BM25 + locationBoost`, where `w` is 0.3 for needs ≤4 words and 0.12 for longer ones.
5. `rankByKeyword` re-sorts for exact/substring name hits.
6. Dedup to one row per program; siblings become `otherLocations`.
7. Slice `[offset, offset+3]`. **Three cards, always.**

---

## Defect 1 — Ranking is dominated by its own tie-breakers

Measured decomposition, `"free clothes for my kids"` in Merced:

```
final  =0.7*sim  +bm25   +boost   program
0.465   0.266    0.099   0.100    Game Night for Kids      [merced]   ← shown
0.399   0.264    0.120   0.015    BrightLife Kids          [-]        ← shown
0.399   0.254    0.044   0.100    Caring Kids              [merced]   ← shown
0.394   0.272    0.021   0.100    Clothing Closet          [merced]   ← NOT shown
```

`Clothing Closet` is the correct answer **and ranks #1 on raw vector similarity**. It finishes 4th and is never displayed, because `PAGE_SIZE` is 3.

The mechanism: the vector term spans just **0.234–0.272** across the top eight — a 0.038 range. BM25 contributes up to 0.120 and the city boost a flat 0.100. Anything with the token "kids" in its name gets promoted over the semantically correct match.

Same pattern for `"help paying my utility bill"` in Atwater:

```
0.514   0.335    0.079   0.100    WATER DISCONTINUATION POLICY [atwater]  ← shown
0.502   0.367    0.120   0.015    REACH/Match My Payment       [merced]
0.418   0.333    0.071   0.015    LIHEAP                       [merced]  ← rank 5, never shown
```

A **City of Atwater policy document** outranks the actual utility-assistance programs, purely on the +0.1 same-city boost. LIHEAP — arguably the single most relevant program for this need — is rank 5.

**Root cause:** cosine similarity between a short conversational query and a ~700-character document blob is compressed into a narrow band, so it barely discriminates. The boosts were sized as if the vector spread were wide. They were tuned (per the commit message) against nine golden searches, which was not enough to expose this.

## Defect 2 — Recall is truncated before ranking

`CANDIDATE_LIMIT = 40` is applied to **rows**, before dedup and before any rescoring:

| Query | Above floor | After cap(40) | Programs lost |
|---|---|---|---|
| free clothes for my kids | 306 rows / 238 programs | 40 rows / 30 programs | **208** |
| I need food for my family | 150 rows / 115 programs | 40 rows / 29 programs | **86** |
| help paying my utility bill | 101 rows / 78 programs | 40 rows / 31 programs | **47** |

Two compounding effects:

- **BM25 and keyword ranking can only ever see the top 40 by raw vector.** If the right program sits at vector rank 45, no amount of keyword matching can rescue it. The hybrid search is not actually hybrid — it is vector-recall with keyword re-ordering.
- **Multi-site programs eat the budget.** The max is 17 sites for a single program, and 29 programs have more than 3. For the food query, `Emergency Food Assistance Program` occupies 4 of the top 6 slots. Dedup runs *after* the cap, so those duplicates have already displaced other programs.

`totalMatches` and `moreCount` are computed from the capped pool, so the model tells users "there are 26 more options" when there are actually 200+. Paging with `offset` can only walk the same ~30.

## Defect 3 — 104 rows are unreachable by any query

`serviceAreaTokens()` in `transform.ts` derives tokens **only** from iCarol's structured `coverage[]`. When that field is absent it returns `[]`, and `arrayOverlaps` never matches an empty array. The row is invisible forever, regardless of query.

What is in there:

- **All 18 Merced County Cooling Zones** — Atwater, Delhi, Dos Palos, Gustine, Hilmar, Le Grand, Livingston, Los Banos, Merced, Planada, Santa Nella, Snelling
- **All 5 Mariposa Cooling Zones** — Mariposa, Greeley Hill, Wawona, Cathey's Valley
- **The Trevor Project** (LGBTQ youth crisis services)
- Merced County Workforce Investment business services, Alpha Pregnancy Help Center, Mariposa Community Foundation

Confirmed live: `"I need a cooling center, it is too hot"` from Mariposa returns **noGoodMatch**. During a heat emergency this system cannot surface a single cooling center in either county.

The gate behaved *correctly* there — top similarity was 0.267, below the 0.32 threshold, so it refused to recommend "Summer Camp" — but only because the real answers had already been filtered out at the SQL level.

**Fix direction:** fall back to `city:`/`county:` tokens derived from the row's own address when `coverage[]` is empty. A program with a Merced address almost certainly serves Merced.

## Defect 4 — Redundant questions

Four contributing mechanisms, in rough order of impact:

**a. Two contradictory prompt regimes.** The base website-QA prompt says *"Be a direct Q&A assistant, not an intake interview… Do NOT ask the user to share their situation, eligibility, health plan, location, or other personal details as a prerequisite."* `REFERRAL_PROMPT_SECTION` is appended after it and says *"If you don't yet know their city or zip code, ask for it."* The referral section tries to reconcile this in its first paragraph, but the model must classify each turn into one of two regimes before it knows which rule applies — and ambiguous openers ("do you help with rent?") sit exactly on the boundary.

**b. `citiesRepresented` creates a second ask.** It is populated only when no city was given. Prompt rule 4 then tells the model to ask which city. So a model that searches first and asks second produces: *user asks → search → "which city are you in?"* — after already showing cards. A model that follows rule 1 asks first. Both paths exist and it can do both in one turn.

**c. No positive "location is known" signal.** `locationNote` is `null` on the happy path. There is no field saying *location resolved: merced*. Rule 1's "Never re-ask what they already told you" is a prompt patch over missing state — the model has to re-derive location from conversation history every turn.

**d. `stopWhen: stepCountIs(5)`** permits search → ask → search within a single turn, and rule 3 explicitly invites "at most one follow-up question."

## Also worth knowing

- **`ALL` grounding conflict.** The base prompt says *"Answer the user's question using ONLY the Context below"*, where Context is website chunks. Resource facts arrive via tool results, which are **not** in Context. The model is simultaneously told to use only Context and to use tool results. This likely contributes to occasional "Sorry, I couldn't find…" on resource questions.
- **Every turn pays for website retrieval.** A pure resource request still runs a `gpt-4o-mini` query-gen call plus pgvector retrieval against the website KB — roughly a second of fixed latency and cost, discarded.
- **Statewide programs compete unweighted.** 46 rows carry `state:ca`. `Golden State Start` (Baby2Baby, **Los Angeles**) is the top vector hit for "diapers and formula for a newborn" at 0.466, beating local `Maternity & Baby Resources` at 0.377. There is no penalty for being non-local.
- **158 rows have a `lastVerifiedOn` older than one year**; 1 was never verified.
- **Almost no production signal exists.** Of 135 logged chat turns, only 8 carry referral tool data. There is essentially no real usage history to tune against — which is an argument for building an offline evaluation set before tuning anything.

---

## Suggested order of work

Ordered by impact-per-unit-risk, not by difficulty.

1. **Build a golden set first.** ~40–60 real needs with expected programs. Nothing below can be verified without it, and the current nine-case tuning is what allowed these defects. This is the highest-leverage item even though it ships no user-visible change.
2. **Fix the invisible rows** (`transform.ts` address fallback). One-line-ish, recovers 8% of the directory including every cooling center. Requires a re-sync.
3. **Raise the candidate cap and dedup in SQL.** Pull ~200–300 rows, or dedup to best-row-per-program in the query via `DISTINCT ON`, so the 40 slots hold 40 *programs*.
4. **Re-tune the score.** Options: normalize similarity within the candidate set before blending, cut the boosts to ~⅓, or drop BM25 for long conversational queries entirely. The golden set decides.
5. **Show more than 3 cards, or make rank-4 reachable.** Correct answers are landing at rank 4.
6. **Add a location-resolved signal to the tool result** and collapse the two prompt regimes into one referral-aware prompt.
7. **Penalize non-local statewide rows**, or surface them only when local matches are thin.
8. **Skip website retrieval when the turn is clearly a resource request** — latency and cost win, and removes the grounding conflict.
