---
phase: 05-moment-nodes
plan: 03
subsystem: moments
tags: [moments, capture, inject, cli, bm25, processText, graphology]

# Dependency graph
requires:
  - phase: 05-01
    provides: MomentNode type, createMoment, readMoments, MOMENTS_DIR
  - phase: 05-02
    provides: searchMoments BM25 over moments
  - phase: 03-flash-hooks
    provides: injectContext function (extended here with moments block)
  - phase: 00-significance-engine
    provides: processText pipeline (used by extractConceptIds)
provides:
  - src/moments/capture.ts with captureCodeRefs, extractConceptIds, runMoment
  - injectContext extended with third try/catch block for moment overlap (MOM-04)
  - src/config.ts momentsDir field (default: data/moments)
  - theorex moment <story> CLI subcommand dispatches correctly (CLI-07)
affects:
  - 06-ai-family
  - 07-code-reading

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "captureCodeRefs wraps Bun.$ git diff in try/catch — returns [] on any failure"
    - "extractConceptIds is a pure function: processText output filtered by knownIds Set"
    - "injectContext third try/catch block: activeIds hoisted before block 1 for moments access"
    - "mergeCodeRefs deduplicates by file:line string key — explicit refs take priority by first-wins"

key-files:
  created:
    - src/moments/capture.ts
    - tests/moments/capture.test.ts
  modified:
    - src/config.ts
    - src/flash/inject.ts
    - src/cli/index.ts
    - tests/flash/inject.test.ts

key-decisions:
  - "captureCodeRefs accepts optional gitFn override for testing — avoids Bun.$ in unit tests"
  - "extractConceptIds is pure (no I/O) — filters processText by knownIds Set with dedup via Set"
  - "activeIds hoisted before first try/catch in injectContext — moments block references it independently"
  - "mergeCodeRefs uses last-colon split for file:line parsing — handles paths containing colons"
  - "processText called with positional args (text, sourceWeight, nodeType, timestamp) matching actual compose.ts API"

patterns-established:
  - "Pattern: captureCodeRefs optional gitFn injection for unit-test isolation from Bun.$ shell"
  - "Pattern: injectContext options extended backward-compatibly — readMoments is optional"

requirements-completed: [MOM-01, MOM-02, MOM-03, MOM-04, CLI-07]

# Metrics
duration: 5min
completed: 2026-03-11
---

# Phase 5 Plan 03: Moment Capture + Context Injection Summary

**`theorex moment <story>` CLI command writes atomic MomentNode JSON; injectContext extended with concept_id overlap section for relevant moments at SessionStart**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-11T08:06:33Z
- **Completed:** 2026-03-11T08:11:00Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 5 (1 new source, 1 new test, 3 modified)

## Accomplishments
- Implemented `captureCodeRefs` — git diff capture wrapped in try/catch, accepts optional override for test isolation
- Implemented `extractConceptIds` — pure function using processText pipeline, filtered by axon known concept IDs
- Implemented `runMoment` — loads axon, builds knownIds, extracts concept_ids, captures git refs, writes atomic moment JSON
- Extended `injectContext` with third independent try/catch block for moment overlap (concept_id intersection with ACTIVE-tier nodes)
- Wired `theorex moment <story>` CLI dispatch with `--ref file:line` flag parsing
- Added `momentsDir` field to Config interface and DEFAULT_CONFIG

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — Write failing tests for capture and inject** - `9391be4` (test)
2. **Task 2: GREEN — Implement capture.ts, extend inject.ts + config.ts + cli/index.ts** - `94a9557` (feat)

**Plan metadata:** (created after state update)

_Note: TDD tasks — RED commit then GREEN commit_

## Files Created/Modified
- `src/moments/capture.ts` - captureCodeRefs, extractConceptIds, runMoment exports
- `src/config.ts` - momentsDir field added (Config interface + DEFAULT_CONFIG)
- `src/flash/inject.ts` - third try/catch block for moments; activeIds hoisted; readMoments option added
- `src/cli/index.ts` - moment case dispatch + rawRefs --ref flag parsing + runMoment import
- `tests/moments/capture.test.ts` - 8 tests for captureCodeRefs, extractConceptIds, runMoment
- `tests/flash/inject.test.ts` - 3 new moment overlap tests (MOM-04)

## Decisions Made
- `captureCodeRefs` accepts optional `gitFn?: () => Promise<string>` override for unit-test isolation — avoids real Bun.$ shell calls in tests
- `processText` is called with positional arguments matching the actual `compose.ts` API (text, sourceWeight, nodeType, timestamp), not the object form shown in plan interfaces
- `activeIds` hoisted as `let activeIds = new Set<number>()` before the first try/catch so the moments block can use it even when the axon block fails
- `mergeCodeRefs` uses last-colon split (`lastIndexOf(":")`) for file:line parsing — handles file paths containing colons (Windows paths, URLs in tool names)
- Explicit refs passed to `runMoment` come first in concat — first-wins dedup ensures explicit overrides git refs

## Deviations from Plan

None — plan executed exactly as written. One minor adaptation: `processText` API uses positional arguments in the actual codebase (not object form shown in plan's interface block), handled automatically.

## Issues Encountered
- Plan interface block showed `processText({ text, sourceWeight, nodeType, timestamp })` (object form) but `src/compose.ts` uses positional args — corrected without user input (Rule 1: bug in plan spec, not in code).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Phase 5 (Moment Nodes) COMPLETE — all 3 plans executed
- All 5 Phase 5 requirements satisfied: MOM-01 (store), MOM-02 (capture + fields), MOM-03 (structural immunity), MOM-04 (SessionStart injection), CLI-07 (moment subcommand)
- Ready to plan Phase 6 (AI Family)

---
*Phase: 05-moment-nodes*
*Completed: 2026-03-11*
