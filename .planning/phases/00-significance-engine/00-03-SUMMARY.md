---
phase: 00-significance-engine
plan: 03
subsystem: extraction-normalization
tags: [typescript, tdd, compromise, nlp, extraction, normalization, pure-functions]

# Dependency graph
requires:
  - "src/types.ts — RawConcept, NormalizedConcept interfaces (Plan 02)"
  - "compromise v14.15.0 — noun extraction and normalization"
provides:
  - "extractConcepts(): text → readonly RawConcept[] — noun phrase and named entity extraction"
  - "normalizeConcepts(): readonly RawConcept[] → readonly NormalizedConcept[] — canonical form mapping"
  - "parseCompromiseJson() internal validator — type-safe compromise .json() bridge"
affects:
  - 00-04-PLAN
  - 00-05-PLAN
  - 00-06-PLAN

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED-GREEN cycle per function — 4 commits total (2 RED, 2 GREEN)"
    - "parseCompromiseJson() internal validator — never trust compromise output as any; validate phrase-level {text, terms[]} structure"
    - "compromise .json() returns phrase-level objects — top-level text is the full phrase, terms[] holds per-token tags"
    - "toSingular() + normalize({verbs, case}) hybrid — .normalize({plurals:true}) does NOT singularize; nouns().toSingular() required"
    - "Immutable spread pattern — {...c, canonicalForm} never mutates input RawConcept"

key-files:
  created:
    - src/extract.ts
    - src/normalize.ts
    - tests/extract.test.ts
    - tests/normalize.test.ts
  modified: []

key-decisions:
  - "compromise .json() output is phrase-level: {text: string, terms: [{text, tags, ...}]} — tags must be collected from terms[], not top-level entry"
  - "nouns().toSingular() is required for plural singularization — .normalize({plurals: true}) does not singularize standalone nouns without full sentence context"
  - "Two-step normalization: nouns().toSingular() mutates the doc in-place then normalize({verbs, case, acronyms}) handles remaining transforms"

patterns-established:
  - "Internal validator pattern: parseCompromiseJson() validates unknown[] before casting to typed shape"
  - "Pure function guarantee: compromise creates a new doc per call, no shared state between invocations"

requirements-completed: [SIG-01]

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 0 Plan 03: Concept Extraction and Normalization Summary

**extractConcepts() and normalizeConcepts() implemented TDD-first — 26 tests, 100% line coverage, both files under 100 lines.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T08:25:51Z
- **Completed:** 2026-03-10T08:28:36Z
- **Tasks:** 4 (2 RED commits + 2 GREEN commits)
- **Files created:** 4

## Accomplishments

- Created `tests/extract.test.ts` — 12 tests covering proper nouns, named entities, deduplication, purity, structural validation, malformed input safety
- Created `src/extract.ts` — `extractConcepts()` calling `nlp().nouns().json()` + `nlp().topics().json()` through a type-safe `parseCompromiseJson()` validator; deduplicates by lowercased surface form via `Set<string>`
- Created `tests/normalize.test.ts` — 14 tests covering plural→singular, gerund→base, case normalization, empty fallback, immutability, purity
- Created `src/normalize.ts` — `normalizeConcepts()` using `nouns().toSingular()` + `normalize({verbs, case, acronyms})` hybrid; spreads input to new object
- 100% line coverage and 100% function coverage on both production files
- Both production files under 100 lines (extract.ts: 90 lines, normalize.ts: 35 lines)

## Task Commits

Each task was committed atomically:

1. **RED: tests/extract.test.ts (failing)** — `255c58c` (test)
2. **GREEN: src/extract.ts** — `0dc0e74` (feat)
3. **RED: tests/normalize.test.ts (failing)** — `862459f` (test)
4. **GREEN: src/normalize.ts** — `a4926b5` (feat)

## Files Created/Modified

- `tests/extract.test.ts` — 12 tests for extractConcepts including proper nouns, named entities, deduplication, purity, structural shape, empty/whitespace safety
- `src/extract.ts` — extractConcepts() pure function with internal parseCompromiseJson() validator; 90 lines
- `tests/normalize.test.ts` — 14 tests for normalizeConcepts including plural, gerund, case, fallback, immutability, purity
- `src/normalize.ts` — normalizeConcepts() pure function with toCanonical() helper; 35 lines

## Decisions Made

- **compromise .json() is phrase-level, not token-level**: `.json()` returns objects shaped `{text: string, terms: [{text, tags, ...}]}` where `text` is the full phrase and tags live in each term. The `parseCompromiseJson()` validator collects tags from `terms[]`, not the top level.
- **nouns().toSingular() required for plurals**: `.normalize({plurals: true})` does not singularize standalone nouns. `nlp('developers').nouns().toSingular().text()` produces `"developer"` correctly. This was verified by a live spike during GREEN phase.
- **Two-step normalization sequence**: `doc.nouns().toSingular()` mutates the doc in-place (compromise docs are mutable), then `doc.normalize({verbs, case, acronyms})` handles remaining transforms. This is the correct order — toSingular before verb normalization.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed parseCompromiseJson() to handle phrase-level .json() output**
- **Found during:** Task 2 (GREEN — extractConcepts)
- **Issue:** Initial implementation assumed compromise `.json()` returns `{text, tags}` at the top level. Actual output is `{text, terms: [{text, tags, ...}]}` — a phrase with per-token terms. Result: named entity extraction returning zero results.
- **Fix:** Updated `parseCompromiseJson()` to read `entry.text` for the phrase surface form and collect tags by iterating `entry.terms[].tags`
- **Files modified:** `src/extract.ts`
- **Commit:** `0dc0e74` (implementation contained the fix)

**2. [Rule 1 - Bug] Fixed plural normalization using nouns().toSingular()**
- **Found during:** Task 4 (GREEN — normalizeConcepts)
- **Issue:** `.normalize({plurals: true})` does not singularize standalone nouns in compromise v14 — `nlp('developers').normalize({plurals:true}).text()` returns `"developers"` unchanged.
- **Fix:** Added `doc.nouns().toSingular()` call before `.normalize()` in `toCanonical()`. Verified: `"developers" → "developer"`, `"dogs" → "dog"`.
- **Files modified:** `src/normalize.ts`
- **Commit:** `a4926b5` (implementation contained the fix)

## Issues Encountered

- compromise `.json()` structure required live inspection (`bun -e`) to determine the actual shape before fixing `parseCompromiseJson()`
- compromise `.normalize({plurals: true})` is misleadingly named — it does not singularize but the docs are unclear on this; `nouns().toSingular()` is the correct API

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `src/extract.ts` and `src/normalize.ts` are ready for immediate use by Plan 04 (synonyms/identify)
- Both functions are pure, so Plan 04 can call them in any order without state concerns
- The `parseCompromiseJson()` validator pattern should be reused by any future module that calls compromise `.json()` directly

## Self-Check: PASSED

- FOUND: src/extract.ts
- FOUND: src/normalize.ts
- FOUND: tests/extract.test.ts
- FOUND: tests/normalize.test.ts
- FOUND: commit 255c58c (test RED extractConcepts)
- FOUND: commit 0dc0e74 (feat GREEN extractConcepts)
- FOUND: commit 862459f (test RED normalizeConcepts)
- FOUND: commit a4926b5 (feat GREEN normalizeConcepts)
