---
phase: 03-flash-hooks
plan: 03
subsystem: hooks
tags: [claude-code-hooks, flash, bun, cli, record, ring-buffer, significance-score]

# Dependency graph
requires:
  - phase: 03-flash-hooks/03-01
    provides: FlashEvent type, readFlash, writeFlash, enforceRingBuffer from store.ts
  - phase: 03-flash-hooks/03-02
    provides: flushFlash (flush to short-term) and injectContext (ACTIVE-tier context)

provides:
  - PostToolUse hook records tool events to flash ring buffer (async, non-blocking)
  - SessionEnd hook flushes significant events to short-term (blocking)
  - SessionStart hook injects ACTIVE-tier context into conversation
  - buildFlashEvent: parse hook stdin JSON, compute significance_score via processText
  - recordFlashEvent: append to ring buffer atomically
  - CLI subcommands: flash-write, flash-flush/flush, flash-inject
  - Project-scoped .claude/settings.json (never touches global ~/.claude/settings.json)

affects:
  - 04-rag-bootstrap
  - 05-moment-nodes

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hook dispatcher pattern: shell script always exits 0, uses absolute bun path, belt-and-suspenders project check"
    - "Async hook via async:true in settings.json + & in shell (belt-and-suspenders non-blocking)"
    - "Significance scoring on hook input: processText(tool_name + tool_input JSON).composite_score"

key-files:
  created:
    - src/flash/record.ts
    - tests/flash/record.test.ts
    - .claude/settings.json
    - .claude/hooks/theorex-hook.sh
  modified:
    - src/cli/index.ts
    - CLAUDE.md
    - .gitignore

key-decisions:
  - "Empty tool_name + empty tool_input → textToScore=' {}' → processText returns [] → significance_score=0 (verified)"
  - "Hook script always exits 0 via trap and final exit 0 — never blocks Claude Code regardless of Bun errors"
  - ".claude/settings.json committed (project-scoped hooks are intentional); .claude/settings.local.json gitignored"
  - "PostToolUse uses async:true in settings.json AND & in shell as belt-and-suspenders for non-blocking"
  - "flush alias added alongside flash-flush as SessionEnd /exit bug workaround (HKS-02 fallback)"

patterns-established:
  - "Hook dispatcher pattern: minimal shell glue, all logic in TypeScript CLI subcommands"
  - "CLI handler export pattern extended to flash lobe: runFlashWrite, runFlashFlush, runFlashInject"

requirements-completed: [HKS-01, HKS-04, HKS-05, HKS-06]

# Metrics
duration: 8min
completed: 2026-03-11
---

# Phase 3 Plan 03: Flash Hooks Integration Summary

**Claude Code hook wiring via project-scoped .claude/settings.json and theorex-hook.sh dispatcher, connecting PostToolUse/SessionEnd/SessionStart to Bun CLI flash subcommands — full end-to-end hooks system live**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-11T01:13:08Z
- **Completed:** 2026-03-11T01:21:00Z
- **Tasks:** 3 (RED tests, GREEN implementation, hooks config)
- **Files modified:** 6

## Accomplishments

- TDD RED/GREEN cycle for `buildFlashEvent` (field mapping, significance scoring, preview truncation) and `recordFlashEvent` (ring-buffer round-trip) — 11 new tests, all pass
- `src/flash/record.ts` implements `buildFlashEvent` (parses PostToolUse stdin, scores via processText) and `recordFlashEvent` (atomic ring-buffer write)
- `src/cli/index.ts` extended with `runFlashWrite`, `runFlashFlush`, `runFlashInject` handlers and `flash-write`, `flush`, `flash-inject` dispatch cases
- `.claude/settings.json` registers all three hooks project-scoped (PostToolUse async:true, SessionEnd blocking, SessionStart blocking)
- `.claude/hooks/theorex-hook.sh` dispatcher: always exits 0, absolute bun path, project identity check, stdout isolation
- Full test suite: 297 tests pass (was 286; +11 record tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — Failing tests for buildFlashEvent and recordFlashEvent** - `252f015` (test)
2. **Task 2: GREEN — record.ts + CLI subcommands** - `0a7890a` (feat)
3. **Task 3: Hook configuration files** - `c66ec59` (feat)

## Files Created/Modified

- `src/flash/record.ts` - buildFlashEvent (parse + score) and recordFlashEvent (ring-buffer write)
- `tests/flash/record.test.ts` - 11 tests covering field mapping, significance scoring, truncation, round-trip
- `src/cli/index.ts` - runFlashWrite, runFlashFlush, runFlashInject handlers + 3 dispatch cases
- `.claude/settings.json` - Project-scoped hook registration (PostToolUse/SessionEnd/SessionStart)
- `.claude/hooks/theorex-hook.sh` - Bun CLI dispatcher, exits 0, absolute path, project identity guard
- `CLAUDE.md` - Hook prerequisites (jq), /exit limitation, hook behavior documented
- `.gitignore` - Added .claude/settings.local.json exclusion

## Decisions Made

- **Empty significance case:** `tool_name=""` + `tool_input={}` → textToScore=`" {}"` → processText returns [] → score=0. Test fixture corrected from `tool_name:"x"` (which scored 1.0) to `tool_name:""`.
- **flush alias:** Added `flush` as alias for `flash-flush` — workaround for Claude Code bug #17885 where SessionEnd doesn't fire on `/exit`.
- **Belt-and-suspenders async:** PostToolUse uses both `async:true` in settings.json AND `&` at end of shell command to ensure non-blocking regardless of settings.json behavior.
- **Project identity guard:** Hook checks `package.json` for `"name": "theorex"` as secondary scoping beyond settings.json project-scoping.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed significance_score=0 test fixture**
- **Found during:** Task 1 (RED tests confirmed to fail but wrong reason — significance_score was 1.0 not 0 for tool_name:"x")
- **Issue:** Test used `tool_name:"x"` for zero-concept case but processText("x {}") returns composite_score=1.0 (single-char inputs pass the significance gate)
- **Fix:** Changed test fixture to `tool_name:""` — empty string produces textToScore=" {}" which processText correctly returns [] for
- **Files modified:** tests/flash/record.test.ts
- **Verification:** All 11 tests pass after fix; score=0 case confirmed via bun -e check
- **Committed in:** 0a7890a (Task 2 commit — test updated alongside implementation)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test fixture)
**Impact on plan:** Test correctness restored. No scope creep.

## Issues Encountered

- bun not in PATH for bash commands — used absolute path `/Users/eoh/.bun/bin/bun` throughout (expected: non-interactive shell behavior documented in hook script itself)

## User Setup Required

None - hooks activate automatically when Claude Code session is started from `/Users/eoh/theorex/`. Prerequisite: `brew install jq`.

## Next Phase Readiness

- Phase 3 complete: Flash store + flush/inject + hook wiring all delivered
- HKS-01, HKS-04, HKS-05, HKS-06 satisfied; FLH-01 through FLH-05 and HKS-02/HKS-03 satisfied in prior plans
- Ready for Phase 4: RAG Bootstrap (ONNX compatibility spike required first)

## Self-Check: PASSED

All files exist: src/flash/record.ts, tests/flash/record.test.ts, .claude/settings.json, .claude/hooks/theorex-hook.sh, src/cli/index.ts
All commits exist: 252f015, 0a7890a, c66ec59

---
*Phase: 03-flash-hooks*
*Completed: 2026-03-11*
