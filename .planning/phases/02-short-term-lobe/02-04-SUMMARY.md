---
phase: 02-short-term-lobe
plan: 04
subsystem: short-term-lobe
tags: [graduation, consecutive-days, long-term-promotion, immutable, tdd]
dependency_graph:
  requires:
    - 02-01  # ShortTermEntry type and JSONL store
    - 01-02  # parseMemory + serializeMemory (Phase 1 parser)
    - 01-01  # writeMemoryAtomic + readMemory (Phase 1 writer)
  provides:
    - STM-06  # Short-term to long-term graduation
  affects:
    - src/short-term/graduate.ts
    - tests/short-term/graduate.test.ts
tech_stack:
  added: []
  patterns:
    - consecutive-run detection via sorted date comparison
    - immutable ParsedMemory update via spread pattern
    - atomic MEMORY.md writes via writeMemoryAtomic
key_files:
  created:
    - src/short-term/graduate.ts
    - tests/short-term/graduate.test.ts
  modified: []
decisions:
  - "hasConsecutiveRun resets run counter to 1 (not 0) on gap — current day is start of new run"
  - "byConceptId accumulates into same Set reference (Set.add is safe, no Map rebuild needed)"
  - "Idempotency check uses rawBody.includes(subsectionHeading) — reliable for fixed-format headings"
metrics:
  duration: 2 min
  completed_date: "2026-03-10"
  tasks_completed: 2
  files_changed: 2
---

# Phase 2 Plan 4: STM-06 Graduation Logic Summary

**One-liner:** Consecutive-day detection with idempotent MEMORY.md promotion using Phase 1 parser + atomic writer.

## What Was Built

`src/short-term/graduate.ts` implements the full STM-06 graduation pipeline:

- **`hasConsecutiveRun(dateStrings, minDays)`** — Pure function. Sorts YYYY-MM-DD strings, walks consecutive pairs, tracks run length. Returns true when run >= minDays at any point.
- **`findGraduateCandidates(entries, minDays=7)`** — Groups ShortTermEntry records by concept_id, collects unique calendar dates per concept, delegates to hasConsecutiveRun, returns the most-recent entry per qualifying concept.
- **`graduateToLongTerm(candidates, memoryPath)`** — Reads MEMORY.md via readMemory, parses with parseMemory, appends "## Short-Term Graduates / ### ConceptName" subsections immutably, writes via writeMemoryAtomic.

## Tests

14 tests across 3 describe blocks covering:
- `hasConsecutiveRun`: 6 cases (7 consecutive, 6 consecutive, gap=1 day, gap with 8-run, empty, single)
- `findGraduateCandidates`: 4 cases (qualifying concept, non-qualifying, two concepts mixed, most-recent selection)
- `graduateToLongTerm`: 4 cases (empty MEMORY.md, append to existing section, idempotency, no candidates no-op)

All 14 tests pass. Full suite: 237 tests pass, 0 failures (was 223 before plan 02, 237 after plan 04).

## Deviations from Plan

None — plan executed exactly as written.

The plan note about the redundant byConceptId loop was applied: used `set.add(entry.date); byConceptId.set(entry.concept_id, existing)` pattern directly (no Map rebuild).

## Self-Check: PASSED

Files verified:
- FOUND: src/short-term/graduate.ts
- FOUND: tests/short-term/graduate.test.ts

Commits verified:
- 5a18892 — test(02-04): add failing tests for graduation logic
- ffacee2 — feat(02-04): implement graduation logic for short-term to long-term promotion
