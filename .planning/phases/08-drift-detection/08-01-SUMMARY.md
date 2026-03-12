---
phase: 08-drift-detection
plan: 01
subsystem: audit
tags: [jsonl, append-only, node:fs/promises, bun:test, tdd]

# Dependency graph
requires: []
provides:
  - appendAuditEvent() — append-only JSONL writer to data/events.jsonl using node:fs/promises appendFile
  - readAuditEvents() — filtered JSONL reader with type and sinceMs predicates
  - AuditEvent union type — 5 discriminated variants (tier_change, sentinel_flip, graduation, prune, moment_capture)
  - AuditEventType union type
  - EVENTS_PATH constant
  - AuditFilter interface
affects:
  - 08-02 (drift scorer reads audit log via readAuditEvents)
  - 08-03 (mutation wiring uses appendAuditEvent at tier/sentiment change sites)
  - 08-04 (CLI audit command queries via readAuditEvents)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - appendFile from node:fs/promises for true JSONL append semantics (Bun.write would replace)
    - Bun.file(path).text().catch(() => "") for ENOENT-tolerant file reads
    - mkdir({ recursive: true }) before appendFile for directory auto-creation
    - All AuditEvent interfaces use readonly on every field (immutability rule)
    - logger.ts imports only node:fs/promises and node:path — zero project imports (one-way dependency)

key-files:
  created:
    - src/audit/logger.ts
    - src/audit/reader.ts
    - tests/audit/logger.test.ts
    - tests/audit/reader.test.ts
  modified: []

key-decisions:
  - "appendFile from node:fs/promises mandated — Bun.write silently replaces file content (extends Phase 2 decision to audit subsystem)"
  - "logger.ts imports only node: builtins — axon imports audit, never reverse; one-way dependency enforced structurally"
  - "reader.ts uses Bun.file().text().catch(() => '') for ENOENT tolerance — consistent with existing codebase pattern"

patterns-established:
  - "Audit logger: mkdir-then-appendFile pattern for atomic directory+file creation"
  - "Audit reader: split-by-newline + try/catch per line for malformed-line resilience"

requirements-completed:
  - DRF-01
  - DRF-05

# Metrics
duration: 8min
completed: 2026-03-11
---

# Phase 08 Plan 01: Audit Infrastructure Summary

**Append-only JSONL audit log with filtered reader — 5 event types (tier_change, sentiment_flip, graduation, prune, moment_capture) using node:fs/promises appendFile with Bun.file ENOENT tolerance**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T11:50:21Z
- **Completed:** 2026-03-11T11:57:51Z
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 4

## Accomplishments

- TDD RED phase: 10 failing tests covering append idempotency, directory creation, 5 event type round-trips, ENOENT guard, malformed line skip, type filter, sinceMs filter
- TDD GREEN phase: logger.ts and reader.ts implemented; all 10 tests pass, 357 total suite pass
- logger.ts enforces one-way dependency — zero project imports; only node:fs/promises and node:path
- Confirmed pre-existing runPrune test 10 failure is unrelated to this plan's changes

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Write failing tests** - `900622a` (test)
2. **Task 2 (GREEN): Implement logger.ts and reader.ts** - `6413a95` (feat)

## Files Created/Modified

- `src/audit/logger.ts` — appendAuditEvent, EVENTS_PATH, all AuditEvent types and AuditEventType
- `src/audit/reader.ts` — readAuditEvents, AuditFilter
- `tests/audit/logger.test.ts` — TDD tests for append idempotency and no-overwrite invariant
- `tests/audit/reader.test.ts` — TDD tests for filter by type, sinceMs, and ENOENT guard

## Decisions Made

- appendFile from node:fs/promises is mandatory (not Bun.write) — Bun.write silently replaces file content; extends the Phase 2 decision to the audit subsystem
- logger.ts imports only node: builtins to enforce the one-way dependency invariant (axon imports audit, never reverse)
- reader.ts uses `Bun.file(path).text().catch(() => "")` for ENOENT tolerance, consistent with existing codebase patterns from short-term store and flash buffer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Pre-existing runPrune test 10 failure is unrelated (embedding-store.ts rename path issue in tests/cli/cli.test.ts, present before this plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `appendAuditEvent` and `readAuditEvents` are ready for Phase 08 Plan 02 (drift scorer) and Plan 03 (mutation wiring)
- No blockers. Both exports have full test coverage and clean type signatures.

---
*Phase: 08-drift-detection*
*Completed: 2026-03-11*

## Self-Check: PASSED

- FOUND: src/audit/logger.ts
- FOUND: src/audit/reader.ts
- FOUND: tests/audit/logger.test.ts
- FOUND: tests/audit/reader.test.ts
- FOUND: .planning/phases/08-drift-detection/08-01-SUMMARY.md
- FOUND commit: 900622a (test RED phase)
- FOUND commit: 6413a95 (feat GREEN phase)
- bun test tests/audit/ — 10 pass, 0 fail
