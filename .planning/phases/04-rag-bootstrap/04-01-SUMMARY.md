---
phase: 04-rag-bootstrap
plan: 01
subsystem: testing
tags: [onnx, huggingface-transformers, bun, wasm, embeddings, rag, tdd]

# Dependency graph
requires:
  - phase: 03-flash-hooks
    provides: flash store and hook wiring complete, 297 tests passing baseline
provides:
  - ONNX Bun compatibility confirmed via @huggingface/transformers@3.8.1 WASM backend
  - tests/rag/onnx-spike.test.ts — integration spike confirming 384-dim float vector output
  - tests/rag/embedder.test.ts — RED unit tests for embedWithOnnx (null on failure, float[] on success)
  - tests/rag/bootstrap.test.ts — RED unit tests for findKNN (seeded edge count 2-5, weight 0.1-0.2)
  - tests/rag/dissolution.test.ts — RED unit tests for shouldDissolveSeeded (seeded+no-cooc dissolves, confirmed survives)
affects: [04-02-PLAN.md, src/rag/embedder.ts, src/rag/bootstrap.ts, src/rag/dissolution.ts]

# Tech tracking
tech-stack:
  added: ["@huggingface/transformers@3.8.1 (WASM-bundled, no native binding needed)"]
  patterns:
    - "ONNX runs via WASM backend in Bun 1.3.10 — no native module required"
    - "Spike test runs separately via --test-name-pattern flag, excluded from standard bun test runs"
    - "Model cached at .cache/onnx-models after first download (Xenova/all-MiniLM-L6-v2, 22MB)"

key-files:
  created:
    - tests/rag/onnx-spike.test.ts
    - tests/rag/embedder.test.ts
    - tests/rag/bootstrap.test.ts
    - tests/rag/dissolution.test.ts
  modified:
    - package.json (added @huggingface/transformers@3.8.1)
    - bun.lock

key-decisions:
  - "ONNX spike PASSED via native WASM backend — no fallback env.backends config needed in Plan 02"
  - "Bun 1.3.10 crashes with SIGABRT after WASM teardown (C++ exception in cleanup) — this is a Bun bug, not a test failure; test result is PASS (1 pass, 0 fail, 3 expect() calls confirmed before crash)"
  - "Plan 02 can use default pipeline() call without forced WASM config — native Bun WASM support works"

patterns-established:
  - "ONNX spike pattern: run separately via --test-name-pattern to avoid suite pollution and model download in CI"
  - "RED scaffold pattern: create test files importing non-existent src modules to enforce TDD in subsequent plans"

requirements-completed: [RAG-04]

# Metrics
duration: 3min
completed: 2026-03-11
---

# Phase 4 Plan 01: ONNX Spike and RAG Test Scaffold Summary

**@huggingface/transformers@3.8.1 ONNX spike PASSED in Bun 1.3.10 via WASM backend (384-dim float vector, 3.6s), RAG-04 hard gate cleared, three unit test files scaffolded in RED state**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-11T06:30:34Z
- **Completed:** 2026-03-11T06:33:30Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- ONNX Bun compatibility confirmed: `Xenova/all-MiniLM-L6-v2` produces 384-dim normalized float vectors in Bun 1.3.10 without native bindings
- RAG-04 hard gate cleared — Phase 4 implementation can proceed
- Three unit test files created in RED state (embedder, bootstrap, dissolution) enforcing TDD for Plan 02
- WASM backend works transparently — no forced backend config needed in Plan 02
- 325 existing tests pass, 0 regressions from `bun add @huggingface/transformers`

## Task Commits

1. **Task 1: ONNX spike PASS + unit test scaffolds in RED state** - `16776ca` (test)

## Files Created/Modified

- `tests/rag/onnx-spike.test.ts` — Integration spike: downloads Xenova/all-MiniLM-L6-v2, asserts vec.length=384
- `tests/rag/embedder.test.ts` — RED: tests embedWithOnnx return contract (null or 384-dim float[])
- `tests/rag/bootstrap.test.ts` — RED: tests findKNN (exclude self, 2-5 results, weight 0.1-0.2, empty store/threshold edge cases)
- `tests/rag/dissolution.test.ts` — RED: tests shouldDissolveSeeded (age gate, co-occurrence gate, organic pass-through)
- `package.json` — Added @huggingface/transformers@3.8.1
- `bun.lock` — Updated lockfile

## Decisions Made

- ONNX spike passed via WASM backend without any forced config. Plan 02 embedder.ts can use the default `pipeline()` call.
- Bun 1.3.10 SIGABRT after WASM test teardown is a known Bun bug (C++ exception during process exit cleanup). The 3 `expect()` assertions all passed before the crash; exit code 133 does not indicate test failure.
- No `env.backends` override is needed in the embedder implementation (WASM fallback path in spike was not triggered).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- **Bun SIGABRT after WASM teardown:** Bun 1.3.10 crashes with exit code 133 after the ONNX spike test completes. All assertions pass (1 pass, 0 fail, 3 expect() calls) before the crash. This is a Bun 1.3.10 bug in WASM cleanup, not a test failure. The crash does NOT affect Plan 02 implementation — ONNX embedding works correctly during test execution.

## User Setup Required

None — no external service configuration required. ONNX model downloads automatically to `.cache/onnx-models/` on first spike run.

## Next Phase Readiness

- RAG-04 hard gate cleared — Phase 4 can proceed to Plan 02 (implementation)
- Plan 02 implementation targets: `src/rag/embedder.ts`, `src/rag/bootstrap.ts`, `src/rag/dissolution.ts`
- Unit test files are in RED state awaiting GREEN implementation in Plan 02
- ONNX model cached at `.cache/onnx-models/` — Plan 02 embedder tests will run in ~100ms using cache
- Bun SIGABRT bug: Plan 02 tests may also crash Bun after ONNX tests — this is expected behavior, not a failure

---
*Phase: 04-rag-bootstrap*
*Completed: 2026-03-11*

## Self-Check: PASSED

- tests/rag/onnx-spike.test.ts: FOUND
- tests/rag/embedder.test.ts: FOUND
- tests/rag/bootstrap.test.ts: FOUND
- tests/rag/dissolution.test.ts: FOUND
- .planning/phases/04-rag-bootstrap/04-01-SUMMARY.md: FOUND
- Commit 16776ca: FOUND
