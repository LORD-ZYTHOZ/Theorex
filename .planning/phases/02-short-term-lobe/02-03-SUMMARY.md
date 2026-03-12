---
phase: 02-short-term-lobe
plan: "03"
subsystem: short-term-lobe
tags:
  - vector-embeddings
  - hybrid-search
  - reciprocal-rank-fusion
  - graceful-degradation
  - bm25
  - lm-studio
dependency_graph:
  requires:
    - "02-01 (store.ts - readShortTermFiles, ShortTermEntry)"
    - "02-02 (bm25.ts - buildBm25Index, bm25Search)"
  provides:
    - "embedText (LM Studio embedding client)"
    - "cosineSimilarity (large-vector safe)"
    - "reciprocalRankFusion (RRF k=60)"
    - "hybridSearch (BM25+vector or BM25-only)"
  affects:
    - "02-05 (CLI-05 will call hybridSearch as core query API)"
tech_stack:
  added:
    - "AbortController + setTimeout for fetch timeout (built-in Web APIs)"
  patterns:
    - "Null return as graceful degradation signal (never throw on infrastructure failure)"
    - "reduce() for vector magnitude to avoid Math.hypot spread stack limits"
    - "RRF k=60 fusion (Cormack et al. 2009 standard constant)"
    - "Promise + AbortSignal event listener for mock-testable timeout behavior"
key_files:
  created:
    - src/short-term/embedder.ts
    - src/short-term/rrf.ts
    - src/short-term/search.ts
    - tests/short-term/embedder.test.ts
    - tests/short-term/rrf.test.ts
    - tests/short-term/search.test.ts
  modified: []
decisions:
  - "embedText returns null for ALL failure modes (timeout, 4xx/5xx, network error) — never throws; hybridSearch interprets null as BM25-only fallback"
  - "cosineSimilarity uses reduce() not Math.hypot(...vec) spread — spread fails for >~1000 dimensions due to JS call stack limits; reduce() is O(n) heap"
  - "RRF formula: score(d) = sum(1/(60+rank_i(d))) — k=60 from Cormack et al. 2009; verified: rank-1 BM25-only entry scores 1/61 ≈ 0.016393"
  - "AbortController timeout mock requires signal.addEventListener('abort') — bun:test mock does not propagate signal.aborted automatically; test must register abort listener on RequestInit.signal"
metrics:
  duration: "3 min"
  tasks_completed: 2
  files_created: 6
  files_modified: 0
  tests_added: 15
  total_tests_passing: 252
  completed_date: "2026-03-10"
---

# Phase 2 Plan 3: Embedder, RRF, and Hybrid Search Summary

**One-liner:** Hybrid BM25+vector search via LM Studio embeddings with RRF fusion (k=60) and graceful BM25-only fallback when embedder is unreachable.

## What Was Built

Three new modules completing the STM search stack:

- **embedder.ts** — LM Studio embedding client with 3s AbortController timeout. Returns `number[] | null` (never throws). `cosineSimilarity()` uses `reduce()` for large-vector safety (tested with 2000-dim vectors).

- **rrf.ts** — Reciprocal Rank Fusion combiner. RRF formula: `score(d) = sum(1 / (60 + rank_i(d)))`. Accepts `null` for `vectorResults` to trigger BM25-only degradation. Formula verified at 4 decimal places: rank-1 entry scores `1/61 ≈ 0.01639`.

- **search.ts** — `hybridSearch()` entry point. Always runs BM25. Attempts vector embedding; if `embedText` returns `null`, passes `null` to RRF which returns BM25-only ranking. Same function, same call site, different code path — no error thrown.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | RED — embedder + rrf + search failing tests | fbf89cf | embedder.test.ts, rrf.test.ts, search.test.ts, stubs |
| 2 | GREEN — Implement embedder.ts, rrf.ts, search.ts | b0e532e | embedder.ts, rrf.ts, search.ts, test fix |

## Test Results

- 15 new tests added across 3 test files
- 252 total tests passing (up from 237), 0 failures
- 0 regressions in existing test suite

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AbortController timeout test mock required signal listener**
- **Found during:** Task 2 GREEN — timeout test timed out at bun:test 5s default rather than 50ms
- **Issue:** Mock returned `new Promise(() => {})` (never resolving), ignoring `AbortSignal`. The `AbortController.abort()` call fired but the mock didn't respond to it, so the await in `embedText` never resolved within the test timeout.
- **Fix:** Updated timeout mock to register an `abort` event listener on `opts?.signal` and reject with `DOMException("Aborted", "AbortError")` — the standard Web API pattern for abort-aware promises.
- **Files modified:** `tests/short-term/embedder.test.ts`
- **Commit:** b0e532e (included in GREEN commit)

## Requirements Satisfied

- **STM-04**: Vector search via LM Studio embeddings — `embedText` + `cosineSimilarity` implemented
- **STM-05**: Hybrid BM25+vector search with graceful degradation — `hybridSearch` uses RRF when embedder available, BM25-only when null

## Self-Check: PASSED

Files exist:
- FOUND: src/short-term/embedder.ts
- FOUND: src/short-term/rrf.ts
- FOUND: src/short-term/search.ts
- FOUND: tests/short-term/embedder.test.ts
- FOUND: tests/short-term/rrf.test.ts
- FOUND: tests/short-term/search.test.ts

Commits exist:
- FOUND: fbf89cf (RED phase)
- FOUND: b0e532e (GREEN phase)
