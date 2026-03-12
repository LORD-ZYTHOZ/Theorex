---
phase: 02-short-term-lobe
plan: 01
subsystem: storage
tags: [jsonl, bun, short-term-memory, config, filesystem]

# Dependency graph
requires:
  - phase: 01-long-term-lobe
    provides: Config interface and ConceptEvent type (src/config.ts, src/types.ts)

provides:
  - ShortTermEntry interface (id, concept_id, surface_form, composite_score, source_weight, timestamp, date)
  - appendEntry: JSONL append writer to data/short-term/YYYY-MM-DD.jsonl
  - rotateStm: 14-day rotation deleting old JSONL files by date-prefix string comparison
  - readShortTermFiles: all-files reader returning entries in ascending date order
  - STM_DIR constant
  - Config extended with stmRetentionDays, stmGraduateDays, lmStudioUrl, lmStudioEmbedModel, lmStudioTimeoutMs

affects:
  - 02-02 (BM25 indexer — needs ShortTermEntry + readShortTermFiles)
  - 02-03 (embedder — needs lmStudioUrl, lmStudioEmbedModel, lmStudioTimeoutMs from Config)
  - 02-04 (graduate — needs rotateStm + stmGraduateDays)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JSONL append-only writes via node:fs/promises appendFile (not Bun.write which replaces)"
    - "Date comparison via ISO 8601 string ordering (YYYY-MM-DD lexicographic sort is chronological)"
    - "readdir().catch(() => []) idiom for absent-directory safety"

key-files:
  created:
    - src/short-term/store.ts
    - tests/short-term/store.test.ts
  modified:
    - src/config.ts

key-decisions:
  - "appendFile from node:fs/promises is mandatory for JSONL appends — Bun.write silently replaces file content"
  - "rotateStm uses string date comparison (dateStr < cutoffStr) — YYYY-MM-DD lexicographic order is chronological, no Date parsing needed"
  - "14-day cutoff is exclusive (strictly older than 14 days deleted, exactly 14-day-old files kept)"

patterns-established:
  - "Short-term store pattern: one JSONL file per day, named YYYY-MM-DD.jsonl, in data/short-term/"
  - "Rotation pattern: string date comparison against cutoff, no Date() parsing in hot path"
  - "Absent-directory safety: readdir().catch(() => []) returns empty array — callers never throw on missing dir"

requirements-completed: [STM-01, STM-02]

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 02 Plan 01: Short-Term Store Foundation Summary

**JSONL append writer, 14-day rotation, and all-files reader for short-term memory backed by one YYYY-MM-DD.jsonl file per day, with Config extended for LM Studio embedding and STM graduation fields.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T21:01:31Z
- **Completed:** 2026-03-10T21:03:37Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments

- ShortTermEntry interface defined with all required fields (id, concept_id, surface_form, composite_score, source_weight, timestamp, date)
- appendEntry writes JSONL lines using node:fs/promises appendFile — verified two-call append (not replace) test passes
- rotateStm deletes files strictly older than 14 days using ISO 8601 string comparison — boundary conditions (exactly 14 days) explicitly tested
- readShortTermFiles returns entries from all JSONL files sorted by date, empty array on absent directory
- Config interface extended with 5 Phase 2 fields (stmRetentionDays, stmGraduateDays, lmStudioUrl, lmStudioEmbedModel, lmStudioTimeoutMs)
- 215 total tests pass, 0 regressions from 213 baseline

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — ShortTermEntry type + store.ts failing tests** - `e9686d7` (test)
2. **Task 2: GREEN — Implement store.ts + extend Config** - `64d6b68` (feat)

_Note: TDD plan — RED commit followed by GREEN commit._

## Files Created/Modified

- `src/short-term/store.ts` — ShortTermEntry interface, appendEntry, rotateStm, readShortTermFiles, STM_DIR constant
- `tests/short-term/store.test.ts` — 7 unit tests covering all store functions including boundary cases and absent-directory safety
- `src/config.ts` — Config interface and DEFAULT_CONFIG extended with 5 Phase 2 fields

## Decisions Made

- **appendFile mandatory:** Bun.write replaces file content — node:fs/promises appendFile is the only correct primitive for JSONL append semantics. This is a footgun worth calling out explicitly in the file header.
- **String date comparison for rotation:** ISO 8601 date strings (YYYY-MM-DD) are lexicographically ordered, so `dateStr < cutoffStr` correctly identifies old files without Date() parsing overhead.
- **Exclusive boundary for 14 days:** A file exactly 14 days old is kept (not deleted). The cutoff is computed as `today - 14 days` and the comparison is strict less-than (`<`).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ShortTermEntry type and store API are fully implemented and tested — ready for 02-02 (BM25 indexer) and 02-03 (embedder)
- Config now carries lmStudioUrl/lmStudioEmbedModel/lmStudioTimeoutMs — 02-03 can consume directly
- stmRetentionDays and stmGraduateDays available for 02-04 (graduate) without further config changes
- No blockers

---
*Phase: 02-short-term-lobe*
*Completed: 2026-03-10*

## Self-Check: PASSED

- src/short-term/store.ts — FOUND
- tests/short-term/store.test.ts — FOUND
- src/config.ts — FOUND
- .planning/phases/02-short-term-lobe/02-01-SUMMARY.md — FOUND
- Commit e9686d7 — FOUND
- Commit 64d6b68 — FOUND
