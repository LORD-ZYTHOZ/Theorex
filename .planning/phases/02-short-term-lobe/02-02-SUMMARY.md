---
phase: 02-short-term-lobe
plan: "02"
subsystem: search
tags: [bm25, wink-bm25-text-search, keyword-search, cjs, createRequire, short-term]

# Dependency graph
requires:
  - phase: 02-short-term-lobe/02-01
    provides: ShortTermEntry interface and JSONL store (appendEntry, rotateStm, readShortTermFiles)
provides:
  - buildBm25Index(entries: ShortTermEntry[]) — consolidates wink engine with surface_form weight 3
  - bm25Search(engine, entries, query, limit?) — returns BM25SearchResult[] sorted by descending score
  - BM25SearchResult interface { id: string; score: number }
affects:
  - 02-03 (hybrid search combiner — BM25 is the keyword half)

# Tech tracking
tech-stack:
  added:
    - wink-bm25-text-search 3.1.2 (CJS package, loaded via createRequire)
  patterns:
    - createRequire(import.meta.url) for CJS interop in Bun ESM modules
    - Sentinel doc padding (pad to min 3 docs) for wink consolidation requirement
    - Integer uniqueId → entries array index for id mapping in wink results

key-files:
  created:
    - src/short-term/bm25.ts
    - tests/short-term/bm25.test.ts
  modified:
    - package.json (added wink-bm25-text-search dependency)
    - bun.lock

key-decisions:
  - "wink-bm25-text-search requires minimum 3 docs to consolidate; buildBm25Index pads with empty sentinel docs (surface_form: empty string, id: __sentinel_N__) when entries.length < 3"
  - "createRequire(import.meta.url) pattern confirmed working with Bun 1.3.10 for CJS wink package"
  - "uniqueId in wink is the integer index passed as second arg to addDoc; bm25Search maps it back to entries[uniqueId].id"
  - "fldWeights: { surface_form: 3 } boosts surface_form matches 3x in BM25 scoring"

patterns-established:
  - "CJS interop pattern: const require = createRequire(import.meta.url); const pkg: () => any = require('pkg-name')"
  - "Sentinel padding: pad corpus to PAD_TO=3 with empty sentinel docs before consolidate() when small corpus"

requirements-completed:
  - STM-03

# Metrics
duration: 2min
completed: "2026-03-10"
---

# Phase 2 Plan 02: BM25 Keyword Search Summary

**BM25 keyword search over short-term entries using wink-bm25-text-search 3.1.2 (CJS) via createRequire, with surface_form field weight 3 and sentinel-padding for small corpora**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T21:06:22Z
- **Completed:** 2026-03-10T21:08:15Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 4 (src/short-term/bm25.ts, tests/short-term/bm25.test.ts, package.json, bun.lock)

## Accomplishments

- buildBm25Index accepts ShortTermEntry[] and returns a consolidated wink BM25 engine with surface_form field weighting (3x)
- bm25Search maps wink's integer uniqueId results back to entry ids, returning BM25SearchResult[] sorted by descending score
- createRequire CJS interop pattern confirmed and tested in Bun 1.3.10
- 8 tests passing: import smoke test, empty corpus, single match, ranking, field weighting, no result, result shape, most relevant first
- 223 total tests passing, 0 failures (no regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — BM25 search failing tests (install wink + write stubs)** - `30a486b` (test)
2. **Task 2: GREEN — Implement bm25.ts** - `ef7804c` (feat)

_Note: TDD tasks — test stub commit then implementation commit_

## Files Created/Modified

- `src/short-term/bm25.ts` — buildBm25Index + bm25Search implementation; BM25SearchResult interface; createRequire CJS interop; sentinel padding for small corpora
- `tests/short-term/bm25.test.ts` — 8 unit tests: import, empty corpus, single match, ranking, field weighting, no result, result shape, most relevant first
- `package.json` — added wink-bm25-text-search 3.1.2 dependency
- `bun.lock` — updated lockfile

## Decisions Made

- **wink minimum 3 docs:** wink-bm25-text-search throws if `totalDocs < 3` at consolidation time. Fix: pad with empty sentinel entries when corpus is smaller, using indices >= entries.length so they don't collide with real id lookups in bm25Search.
- **Integer uniqueId mapping:** wink returns `[[uniqueId, score]]` where uniqueId is the integer passed as second arg to addDoc. The implementation uses the array index as uniqueId, then maps back via `entries[uniqueId].id` in bm25Search.
- **bm25Search takes entries parameter:** Required to resolve the uniqueId → id mapping. Both buildBm25Index and bm25Search share the same entries array to maintain this mapping.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] wink-bm25-text-search minimum 3 document consolidation requirement**
- **Found during:** Task 2 (GREEN — Implement bm25.ts)
- **Issue:** wink throws `winkBM25S: document collection is too small for consolidation; add more docs!` when fewer than 3 documents are added before consolidate(). This caused empty corpus test and single-entry test to throw rather than returning results.
- **Fix:** Added sentinel doc padding in buildBm25Index: pads corpus to minimum 3 docs using entries with `surface_form: ""` and `id: __sentinel_N__`. Empty surface_form sentinels do not match real queries. Sentinel indices >= entries.length safely return `String(uniqueId)` in bm25Search if accidentally hit.
- **Files modified:** src/short-term/bm25.ts
- **Verification:** All 8 tests pass including empty corpus and single-entry tests
- **Committed in:** ef7804c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Auto-fix required for correctness with small corpora. No scope creep. All plan artifacts delivered as specified.

## Issues Encountered

- wink-bm25-text-search 3.1.2 enforces a minimum corpus size of 3 documents for BM25 statistics to be meaningful. Handled via sentinel padding (see Deviations).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BM25 keyword search pipeline complete and tested — ready for Plan 02-03 (hybrid search combiner)
- buildBm25Index + bm25Search are the keyword half of the hybrid combiner
- BM25SearchResult interface is the input contract for the hybrid scoring plan

---
*Phase: 02-short-term-lobe*
*Completed: 2026-03-10*
