---
phase: 05-moment-nodes
plan: 01
subsystem: moments
tags: [tdd, store, moments, atomic-write, readonly-types]
dependency_graph:
  requires: []
  provides: [MomentNode, CodeRef, MOMENTS_DIR, createMoment, readMoments, loadMoment]
  affects: [05-02, 05-03, 05-04]
tech_stack:
  added: []
  patterns: [atomic-write (tmp+rename), ENOENT-guard via .catch, write-once JSON files]
key_files:
  created:
    - src/moments/store.ts
    - tests/moments/store.test.ts
  modified: []
key_decisions:
  - "MomentNode all fields readonly; code_refs and concept_ids are readonly arrays — type system enforces immutability"
  - "createMoment uses Bun.write(tmp) + rename(tmp, final) matching LTM-04 atomic write invariant"
  - "readMoments uses readdir().catch(() => []) for ENOENT guard — cold-start safe"
  - "loadMoment returns null for all failure modes (ENOENT, invalid JSON) — consistent with Phase 2 embedText pattern"
  - "MOMENTS_DIR = data/moments — lives outside axon graph directory, providing structural immunity to pruneAxon/scanAxon"
metrics:
  duration: 2 min
  completed: "2026-03-11"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 5 Plan 1: MomentNode Store Summary

**One-liner:** Write-once MomentNode JSON store with atomic write (tmp+rename), ENOENT guard, and fully readonly TypeScript interfaces.

## What Was Built

`src/moments/store.ts` — the foundation for Phase 5 moment nodes. Implements:

- **MomentNode** — fully readonly interface with id, timestamp, story, code_refs, concept_ids
- **CodeRef** — readonly file+line pair for code reference anchoring
- **MOMENTS_DIR** — constant `"data/moments"` for default storage path
- **createMoment** — atomic write using `Bun.write(tmp) + rename(tmp, final)`, creates directories recursively
- **readMoments** — reads all valid JSON moment files, skips .tmp files and invalid JSON, returns [] on ENOENT
- **loadMoment** — reads single moment by id, returns null on missing file or parse error

## TDD Execution

**RED:** `tests/moments/store.test.ts` written with 20 tests covering all specified behaviors. Tests failed with "Cannot find module" as expected.

**GREEN:** `src/moments/store.ts` implemented. All 20 tests pass with 41 expect() calls.

**No REFACTOR needed** — implementation matches plan spec exactly.

## Test Coverage

```
20 pass | 0 fail | 41 expect() calls
```

Tests cover:
- MomentNode and CodeRef shape validation
- MOMENTS_DIR constant export
- createMoment: round-trip equality, mkdir-p, atomic write (.tmp gone), valid JSON, multiple files
- readMoments: ENOENT guard, all valid moments, skips .tmp, skips non-JSON, skips invalid JSON, empty dir
- loadMoment: by id, null on missing, null on missing dir, correct moment when multiple exist

## Deviations from Plan

None — plan executed exactly as written.

## Verification Checklist

- [x] `bun test tests/moments/store.test.ts` — 20 pass, 0 fail
- [x] `src/moments/store.ts` exports: MomentNode, CodeRef, MOMENTS_DIR, createMoment, readMoments, loadMoment
- [x] All MomentNode fields typed `readonly`
- [x] No imports from src/rag/ (avoids SIGABRT crash from Phase 4 WASM teardown)
- [x] Atomic write pattern uses Bun.write(tmp) + rename(tmp, final) matching LTM-04 invariant
- [x] Structural immunity confirmed: moments live outside axon graph at data/moments/

## Commits

| Hash | Message |
|------|---------|
| 5bb0832 | test(05-01): add failing store tests for MomentNode |
| cb64ee6 | feat(05-01): implement MomentNode store with atomic write |

## Self-Check: PASSED
