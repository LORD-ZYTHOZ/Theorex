---
phase: 03-flash-hooks
plan: 01
subsystem: storage
tags: [flash, ring-buffer, atomic-write, token-ceiling, bun, typescript]

# Dependency graph
requires:
  - phase: 02-short-term-lobe
    provides: "Short-term store pattern (atomic writes, JSONL per-day), type conventions"
provides:
  - FlashEvent and FlashBuffer types (readonly, immutable)
  - enforceRingBuffer: 50-event ring cap with 4000-token ceiling (min 1 retained)
  - estimateTokens: pure token estimation function
  - readFlash: reads data/flash/{sessionId}.json, ENOENT-safe
  - writeFlash: atomic write via tmpdir+rename, auto-creates data/flash/ directory
affects: [03-flash-hooks, future hook consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic file write via tmpdir+rename (same as Phase 1 LTM-04)"
    - "Ring buffer with dual eviction: count cap + token ceiling"
    - "ENOENT-safe read returning empty buffer (no throw on missing file)"
    - "Immutable return types (readonly FlashEvent[], readonly FlashBuffer)"

key-files:
  created:
    - src/flash/store.ts
    - tests/flash/store.test.ts
  modified: []

key-decisions:
  - "enforceRingBuffer applies ring cap first (slice to 50), then trims for token ceiling — order matters for correctness"
  - "Minimum 1 event always retained in enforceRingBuffer even if over 4000-token ceiling — single large event never purged"
  - "readFlash uses node:fs/promises readFile (not Bun.file) for ENOENT code inspection"
  - "writeFlash uses node:fs/promises (not Bun.write) to enable atomic rename pattern consistent with Phase 1"
  - "estimateTokens formula: Math.ceil(JSON.stringify(events).length / 4) — character-based token approximation"

patterns-established:
  - "Flash store pattern: enforceRingBuffer(existing, incoming) returns new readonly array, never mutates"
  - "Atomic flash write: mkdir(recursive) → writeFile(tmpdir) → rename(final) — same as LTM-04"

requirements-completed: [FLH-01, FLH-02, FLH-03]

# Metrics
duration: 2min
completed: 2026-03-11
---

# Phase 3 Plan 01: Flash Store Summary

**Ring buffer store for per-session flash events: 50-event cap, 4000-token ceiling, atomic write via tmpdir+rename, ENOENT-safe reads**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T01:04:53Z
- **Completed:** 2026-03-11T01:06:36Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- FlashEvent and FlashBuffer types with all required readonly fields
- enforceRingBuffer implements dual eviction: 50-event ring cap + 4000-token ceiling with guaranteed minimum 1 event
- estimateTokens pure function for token estimation (Math.ceil(JSON.stringify(events).length / 4))
- readFlash ENOENT-safe — returns empty buffer on missing file, never throws
- writeFlash atomic via tmpdir+rename pattern, auto-creates data/flash/ directory
- 11 tests covering all three requirements (FLH-01, FLH-02, FLH-03) — 275 total tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — Write failing flash store tests** - `0a09db0` (test)
2. **Task 2: GREEN — Implement flash store** - `c069354` (feat)

_Note: TDD tasks have two commits (test → feat). One auto-fix applied to test file (see Deviations)._

## Files Created/Modified
- `src/flash/store.ts` - FlashEvent/FlashBuffer types, enforceRingBuffer, estimateTokens, readFlash, writeFlash
- `tests/flash/store.test.ts` - 11 tests covering FLH-01 (ring cap), FLH-02 (atomic I/O), FLH-03 (token ceiling)

## Decisions Made
- enforceRingBuffer applies MAX_EVENTS ring eviction first, then token ceiling — ensures count invariant before trimming
- Minimum 1 event always retained regardless of token count — prevents complete buffer erasure on a single large event
- node:fs/promises used for both readFlash and writeFlash (not Bun APIs) to enable atomic rename pattern and ENOENT code inspection
- Token estimate: JSON.stringify character length / 4 — same rough heuristic as plan spec

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertion for fs.access() resolved value**
- **Found during:** Task 2 (GREEN phase, running tests)
- **Issue:** `expect(access(path)).resolves.toBeUndefined()` failed because Bun's `fs/promises access()` resolves with `null` not `undefined`
- **Fix:** Changed assertion to `.resolves.toBeDefined()` — semantics preserved (file exists = no error), matches Bun runtime behavior
- **Files modified:** tests/flash/store.test.ts
- **Verification:** All 11 tests pass, 275 total test suite green
- **Committed in:** c069354 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor test assertion correction for Bun runtime behavior. No scope creep.

## Issues Encountered
- None — implementation matched plan spec exactly. The only issue was a test assertion variance between Node.js docs (undefined) and Bun runtime (null) for fs.access resolved value.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Flash store primitive is complete and tested. Ready for Phase 3 Plan 02 (hooks/event capture).
- data/flash/ directory is created on first writeFlash — no manual setup required.
- enforceRingBuffer is the key primitive that all hook logic will call.

---
*Phase: 03-flash-hooks*
*Completed: 2026-03-11*
