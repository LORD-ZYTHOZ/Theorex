---
phase: 05-moment-nodes
plan: "02"
subsystem: moments
tags: [bm25, search, cli, moment-nodes, wink-bm25]
dependency_graph:
  requires: [05-01]
  provides: [MOM-04]
  affects: [src/cli/index.ts, src/moments/search.ts]
tech_stack:
  added: []
  patterns: [wink-bm25-text-search CJS interop via createRequire, sentinel padding for 3-doc minimum]
key_files:
  created:
    - src/moments/search.ts
    - tests/moments/search.test.ts
  modified:
    - src/cli/index.ts
decisions:
  - "fldWeights: { story: 3 } with bm25Params k1=1.2 b=0.75 for moment BM25 scoring"
  - "Moment results in runSearch wrapped in try/catch — failure is non-fatal (non-blocking CLI)"
  - "runStatus moment section is non-fatal — partial data still produces status output"
  - "Sentinel padding: push objects with id='' and sentinel=true when moments.length < 3"
  - "Filter sentinel results by checking uniqueId >= moments.length OR moment.id === ''"
metrics:
  duration_seconds: 245
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 5 Plan 02: Moment Node BM25 Search Summary

BM25 search over moment story text using wink-bm25-text-search CJS interop pattern, with CLI integration surfacing moment results in `theorex search` and moment count in `theorex status`.

## What Was Built

### src/moments/search.ts
- `buildMomentBm25Index(moments)` — creates wink BM25 engine with `fldWeights: { story: 3 }` and bm25Params `{ k1: 1.2, b: 0.75 }`. Pads corpus with sentinel objects when `moments.length < 3` to satisfy wink's 3-doc minimum for `consolidate()`. Returns consolidated engine.
- `searchMoments(moments, query, limit)` — builds index, runs `engine.search(query, limit * 2)`, maps integer indices back to `MomentNode`, filters sentinel results (id === ""), sorts descending by score, returns first `limit` results as `MomentSearchResult[]`.
- `MomentSearchResult` interface: `{ id, story, score, timestamp }` (all readonly).

### src/cli/index.ts updates
- `runSearch()`: After existing short-term results table, appends `\n--- Moment Nodes ---` section with `[MOMENT] {story.slice(0,80)} ({timestamp.slice(0,10)})` lines. Only printed when `momentResults.length > 0`. Wrapped in try/catch — moment failure is non-fatal.
- `runStatus()`: After the existing concept table, appends `Moment Nodes — N permanent (never pruned)` section listing up to 20 moments (date + story.slice(0,60)). Shows `... and N more` when count exceeds 20. Wrapped in independent try/catch.

### tests/moments/search.test.ts (8 tests)
- Empty array returns `[]`
- 1 moment below 3-doc minimum — no crash (sentinel padding)
- 2 moments below 3-doc minimum — no crash, no sentinel IDs in output
- Result shape: `{ id, story, score, timestamp }` all correct types
- Ranking: story-matching query ranks higher than non-matching entries
- Limit enforcement: at most `limit` results returned
- No sentinel results (id === "") appear in output
- Results sorted descending by score

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 (RED) | Failing tests for moment BM25 | 327e6ae |
| Task 2 (GREEN) | search.ts + CLI integration | 8b07c5a |

## Verification

- `bun test tests/moments/search.test.ts` — 8 pass, 0 fail
- Full suite: 336 pass, 1 fail (pre-existing `runPrune > 10` failure confirmed present before these changes via git stash)
- `src/moments/search.ts` uses `createRequire(import.meta.url)` CJS interop
- Sentinel padding applied when `moments.length < 3`
- No import of `src/rag/` in any moments module (SIGABRT prevention preserved)
- `runSearch` appends moment section only when `momentResults.length > 0`
- `runStatus` shows moment count section only when `moments.length > 0`

## Deviations from Plan

None — plan executed exactly as written.

## Notes

The pre-existing `runPrune > 10` test failure was present before this plan's changes (verified by stashing changes and running the test suite). It is not caused by any modifications in this plan. Documented in deferred-items.

## Self-Check: PASSED

- [x] src/moments/search.ts exists
- [x] tests/moments/search.test.ts exists
- [x] src/cli/index.ts contains "Moment Nodes"
- [x] commits 327e6ae and 8b07c5a exist in git log
- [x] 8 moment search tests pass
- [x] MOM-04 satisfied: moments are searchable and surface in CLI output
