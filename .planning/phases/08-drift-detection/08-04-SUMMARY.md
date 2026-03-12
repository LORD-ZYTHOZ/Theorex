---
phase: 08-drift-detection
plan: "04"
subsystem: cli
tags: [drift, audit, cli, drift-detection, bun]

requires:
  - phase: 08-01
    provides: logger.ts (appendAuditEvent, EVENTS_PATH, AuditEventType), reader.ts (readAuditEvents, AuditFilter)
  - phase: 08-02
    provides: scorer.ts (computeDriftScore, detectInstability, detectSentimentFlips, classifyTrend)
  - phase: 08-03
    provides: wiring of audit events at all 5 mutation sites; config.eventsPath + driftWindowDays
provides:
  - runDrift exported handler in src/cli/index.ts (DRF-06)
  - runAudit exported handler in src/cli/index.ts (DRF-08)
  - runStatus extended with non-fatal drift summary line (DRF-07)
  - drift and audit dispatch cases in CLI switch
  - cli-drift.test.ts with 12 tests covering all handler behaviors
affects: [future-phases, user-facing-cli]

tech-stack:
  added: []
  patterns:
    - CLI handler export pattern extended with runDrift/runAudit
    - parseArgs re-parse from Bun.argv.slice(2) for subcommand flags (workaround for top-level parseArgs discarding option values)
    - events cast via unknown for scorer.ts local AuditEvent type compatibility (index signature mismatch)
    - Non-fatal try/catch wrapping for drift summary in runStatus (DRF-07 pattern)

key-files:
  created:
    - tests/cli/cli-drift.test.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "parseArgs re-parse uses Bun.argv.slice(2).filter(a => a !== subcommand) for audit flags — top-level parseArgs discards option values for options not declared in options:{}, so --type tier_change becomes a positional; must re-parse raw argv"
  - "AuditEvent cast uses (events as unknown as readonly ScorerEvent[]) — logger.ts union types lack [key: string]: unknown index signature required by scorer.ts local type; double cast via unknown resolves TS2345/TS2352"
  - "runAudit --since parses YYYY-MM-DD as UTC midnight using date + 'T00:00:00.000Z' suffix — avoids local-timezone midnight ambiguity (DRF-08 pitfall 4)"
  - "runStatus drift summary is non-fatal: wrapped in independent try/catch after moments block; drift failure never affects table output (DRF-07 invariant)"

patterns-established:
  - "runDrift: lazy tier correction (REL-03) via compositeScore+classifyTier at read time; no disk write"
  - "runAudit: display most recent events first (events.slice(-limit).reverse()); per-event-type format string"
  - "Subcommand flag re-parsing: Bun.argv.slice(2) + filter out subcommand token"

requirements-completed: [DRF-06, DRF-07, DRF-08, CLI-08, CLI-09]

duration: 8min
completed: "2026-03-11"
---

# Phase 8 Plan 04: CLI Drift and Audit Commands Summary

**`theorex drift` and `theorex audit` wired into CLI dispatch via runDrift/runAudit handlers; runStatus extended with non-fatal drift summary line using computeDriftScore+classifyTrend**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T12:38:07Z
- **Completed:** 2026-03-11T12:46:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `runDrift`: loads audit events, performs lazy tier correction (REL-03) to build ACTIVE set, unions moment anchor IDs, calls computeDriftScore + detectInstability + detectSentimentFlips + classifyTrend, prints score + flagged concepts
- `runAudit`: reads events with --type and --since filters, renders human-readable event log (most recent first, per-type format strings), handles invalid date with process.exit(1)
- `runStatus` extended: non-fatal drift summary block after moments section, outputs "Drift: X.XX — trend" line wrapped in try/catch
- CLI dispatch updated: drift and audit cases added; error message updated to include new commands
- 12 tests passing in cli-drift.test.ts covering all required behavioral specs

## Task Commits

1. **Task 1: Add runDrift, runAudit handlers and extend runStatus** - `590f0e1` (feat)
2. **Task 2: Write CLI drift and audit tests** - `18f3aa7` (test)

## Files Created/Modified

- `src/cli/index.ts` — added runDrift, runAudit exports; extended runStatus with drift summary; added drift/audit dispatch cases; updated error message
- `tests/cli/cli-drift.test.ts` — 12 unit tests covering runDrift (5 cases), runAudit (5 cases), runStatus drift summary (2 cases)

## Decisions Made

- **parseArgs re-parse for audit:** Top-level `parseArgs` with `strict: false` but no declared options discards `--type tier_change` as two positionals. Solution: re-parse `Bun.argv.slice(2).filter(a => a !== "audit")` for the audit case with proper option declarations.
- **AuditEvent type cast:** logger.ts's union types (TierChangeEvent, etc.) lack `[key: string]: unknown` index signature required by scorer.ts's local minimal `AuditEvent` type. Cast via `events as unknown as readonly ScorerEvent[]` resolves TS2345/TS2352 without unsafe `any`.
- **--since UTC midnight:** Parses YYYY-MM-DD as `date + "T00:00:00.000Z"` to ensure UTC interpretation regardless of local timezone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed parseArgs flag capture for audit subcommand**
- **Found during:** Task 1 (dispatch implementation)
- **Issue:** `--type tier_change` passed to inner `parseArgs` via `rest` array was receiving only `["tier_change"]` as a positional — the `--type` flag was consumed by the top-level `parseArgs` as an unknown option with its value discarded
- **Fix:** Re-parsed raw `Bun.argv.slice(2)` filtering out the subcommand token, allowing full `--type` and `--since` flag capture
- **Files modified:** src/cli/index.ts
- **Verification:** `theorex audit --type tier_change` correctly filters; `theorex audit --since 2026-01-01` correctly excludes old events
- **Committed in:** 590f0e1 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed TypeScript type mismatch between logger and scorer AuditEvent types**
- **Found during:** Task 1 (TypeScript type check)
- **Issue:** scorer.ts defines a local `AuditEvent` with `[key: string]: unknown` index signature; logger.ts's union types lack this, causing TS2345 errors on `detectInstability` and `detectSentimentFlips` calls
- **Fix:** Added `type ScorerEvent = { type: string; timestamp: string; [key: string]: unknown }` alias and cast `events as unknown as readonly ScorerEvent[]`
- **Files modified:** src/cli/index.ts
- **Verification:** `bun run --bun tsc --noEmit` reports no errors in src/cli/index.ts
- **Committed in:** 590f0e1 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both auto-fixes required for correctness — plan would have produced broken CLI dispatch and TypeScript build errors without them. No scope creep.

## Issues Encountered

- The pre-existing `runPrune test 10` failure in cli.test.ts was present before any changes (verified via git stash). Root cause: `deleteEmbedding` receives undefined path. Out of scope for this plan.
- Full `bun test` run crashes with Bun SIGABRT after WASM teardown — this is the known pre-existing Bun 1.3.10 bug (documented in STATE.md/decisions).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 8 (Drift Detection) is now fully complete: Plans 01-04 all executed
- All 10 requirement IDs (DRF-01 through DRF-08, CLI-08, CLI-09) satisfied across the four plans
- `theorex drift`, `theorex audit`, `theorex status` (with drift line) all functional
- 401 tests passing (excluding pre-existing ONNX/pruneAxon failures)

---
*Phase: 08-drift-detection*
*Completed: 2026-03-11*
