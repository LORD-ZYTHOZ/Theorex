---
phase: 08-drift-detection
plan: 03
subsystem: audit
tags: [audit, instrumentation, drift-detection, events-jsonl, fire-and-forget]

# Dependency graph
requires:
  - phase: 08-01
    provides: appendAuditEvent + readAuditEvents API from src/audit/logger.ts
  - phase: 01-long-term-lobe
    provides: scanAxon, pruneAxon, propagateSentiment, graduateToLongTerm
  - phase: 05-moment-nodes
    provides: createMoment from src/moments/store.ts
provides:
  - Config.driftWindowDays (default 7) and Config.eventsPath (default data/events.jsonl) in interface + DEFAULT_CONFIG
  - scanAxon emits tier_change events only when relevance_tier actually changes
  - pruneAxon emits prune events per dropped node after archive write
  - propagateSentiment emits sentiment_flip events only when sentiment actually changes
  - graduateToLongTerm emits graduation events after successful writeMemoryAtomic
  - createMoment emits moment_capture events after atomic rename
  - tests/audit/wiring.test.ts with 5 integration tests verifying events.jsonl receives correct events
affects: [08-04, drift-scorer, drift-cli]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget audit pattern: void appendAuditEvent(...).catch(() => {}) — mutation sites never fail due to audit write failure"
    - "oldValue capture before mutation — capture old tier/sentiment BEFORE setNodeAttribute to detect actual changes"
    - "Nullish coalescing fallback for eventsPath: config.eventsPath ?? 'data/events.jsonl' — tolerates partial test configs"

key-files:
  created:
    - tests/audit/wiring.test.ts
  modified:
    - src/config.ts
    - src/axon/scan.ts
    - src/axon/prune.ts
    - src/axon/propagate.ts
    - src/short-term/graduate.ts
    - src/moments/store.ts

key-decisions:
  - "void ...().catch(() => {}) is the universal fire-and-forget pattern for all audit calls — never throw, never await, never block"
  - "Nullish coalescing fallback (config.eventsPath ?? 'data/events.jsonl') for scan/prune config param — partial test configs omit eventsPath"
  - "propagateSentiment and graduateToLongTerm use default EVENTS_PATH (no config override param) — they are not scheduled jobs"
  - "oldTier/oldSentiment captured before mutation — required for correct no-op guard (cannot compare against already-mutated value)"

patterns-established:
  - "Instrumentation pass pattern: import logger, capture old value, mutate, conditionally emit — zero logic changes"

requirements-completed: [DRF-01]

# Metrics
duration: 15min
completed: 2026-03-11
---

# Phase 8 Plan 03: Audit Wiring Instrumentation Pass Summary

**All five mutation sites (scan, prune, propagate, graduate, createMoment) wired to emit typed audit events via fire-and-forget appendAuditEvent; Config extended with driftWindowDays and eventsPath; 5 integration tests verify events.jsonl receives correct events from each site**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-11T12:19:55Z
- **Completed:** 2026-03-11T12:34:10Z
- **Tasks:** 2
- **Files modified:** 7 (6 source files + 1 new test file)

## Accomplishments
- Extended Config interface and DEFAULT_CONFIG with driftWindowDays (7) and eventsPath ("data/events.jsonl")
- Instrumented scanAxon with tier_change events — guard ensures no-op events are never emitted
- Instrumented pruneAxon with prune events — emitted per node after archive write, before embedding cleanup
- Instrumented propagateSentiment with sentiment_flip events — only when sentiment actually changes
- Instrumented graduateToLongTerm with graduation events — one per candidate after writeMemoryAtomic
- Instrumented createMoment with moment_capture events — after atomic rename, includes first 60 chars of story
- Created tests/audit/wiring.test.ts with 5 integration tests; all pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Config and wire scan.ts + prune.ts audit events** - `c649d99` (feat)
2. **Task 2: Wire propagate.ts + graduate.ts + moments/store.ts + wiring integration test** - `b93e9f1` (feat)

## Files Created/Modified
- `src/config.ts` - Added driftWindowDays (7) and eventsPath ("data/events.jsonl") to Config interface and DEFAULT_CONFIG
- `src/axon/scan.ts` - Added appendAuditEvent import; oldTier capture before scoring; tier_change event with no-op guard
- `src/axon/prune.ts` - Added appendAuditEvent import; prune event emitted per dropped node after graph.dropNode()
- `src/axon/propagate.ts` - Added appendAuditEvent import; oldSentiment capture; sentiment_flip event with no-op guard
- `src/short-term/graduate.ts` - Added appendAuditEvent import; graduation event per candidate after writeMemoryAtomic
- `src/moments/store.ts` - Added appendAuditEvent import; moment_capture event after rename()
- `tests/audit/wiring.test.ts` - 5 integration tests verifying each mutation site writes correct event type to events.jsonl

## Decisions Made
- void ...().catch(() => {}) is the universal fire-and-forget pattern — audit write failure must never propagate to callers
- Nullish coalescing fallback (config.eventsPath ?? "data/events.jsonl") used in scan/prune because test fixtures use partial Config objects without eventsPath
- propagateSentiment and graduateToLongTerm use default EVENTS_PATH from logger (no config param) — consistent with their existing API signatures
- oldTier captured before `compositeScore` call (not just before setNodeAttribute) because the scoring changes the score first; oldSentiment captured immediately before setNodeAttribute

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Pre-existing test failure in `tests/cli/cli.test.ts` (runPrune test 10) was observed during full suite run. Confirmed pre-existing by reverting changes via git stash: failure existed in prior commit. Cause: test's partial DEFAULT_CFG does not include ragEmbeddingStorePath, causing undefined path in deleteEmbedding. This is out of scope for this plan (not caused by plan's changes). Logged as pre-existing.

Test count: 384 (before) → 389 pass (5 new wiring tests), 1 pre-existing fail.

## Next Phase Readiness
- All mutation sites now emit typed events to data/events.jsonl
- Config has driftWindowDays and eventsPath ready for 08-04 CLI consumption
- events.jsonl is populated by organic system usage; drift scorer (08-02) can now be applied to real event history
- DRF-01 satisfied: audit log receives events from every mutation site

---
*Phase: 08-drift-detection*
*Completed: 2026-03-11*
