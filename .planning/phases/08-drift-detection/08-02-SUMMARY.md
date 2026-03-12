---
phase: 08-drift-detection
plan: "02"
subsystem: drift-scorer
tags: [drift, scoring, pure-functions, jaccard, tdd]
dependency_graph:
  requires: []
  provides: [computeDriftScore, detectInstability, detectSentimentFlips, classifyTrend]
  affects: [src/cli/index.ts (runDrift), 08-03-PLAN.md (CLI integration)]
tech_stack:
  added: []
  patterns: [pure-function, jaccard-similarity, rolling-window-filter]
key_files:
  created:
    - src/audit/scorer.ts
    - tests/audit/scorer.test.ts
  modified: []
decisions:
  - "detectSentimentFlips tracks only the `to` field (outcome sentiment) per in-window event — the `from` field reflects prior state which may predate the window, so including it would misattribute out-of-window sentiments as in-window observations"
  - "computeDriftScore empty-moment guard returns 1.0 (no anchors = no evidence of drift, not zero) — semantically correct: a missing snapshot cannot indicate drift"
  - "scorer.ts defines local minimal AuditEvent type alias rather than importing from logger.ts — preserves zero-I/O invariant and allows parallel execution with Plan 01"
metrics:
  duration: "4 min"
  completed: "2026-03-11"
  tasks: 2
  files: 2
requirements_satisfied: [DRF-02, DRF-03, DRF-04, DRF-05]
---

# Phase 08 Plan 02: Pure Drift Scorer Summary

**One-liner:** Jaccard drift score + instability/sentiment-flip detection via pure rolling-window math with no I/O.

## What Was Built

`src/audit/scorer.ts` — a pure math module with four exported functions:

- **`computeDriftScore(momentConceptIds, activeConceptIds)`** — Jaccard overlap: `|intersection| / |union|`. Edge guards: empty moment → `1.0`; empty active → `0.0`.
- **`detectInstability(events, windowDays, nowMs?)`** — Filters `tier_change` events where `from === "ACTIVE"` and `to !== "ACTIVE"` within the rolling window. Returns `InstabilityFlag[]`.
- **`detectSentimentFlips(events, windowDays, nowMs?)`** — Detects concepts that appear with both `"PREFERRED"` and `"DISPREFERRED"` as outcome sentiments (`to` field) within the window. Returns `SentimentFlipFlag[]`.
- **`classifyTrend(currentScore, instabilityCount)`** — Precedence chain: `recovering` (score ≥ 0.7 AND instability > 0) → `drifting` (score < 0.5 OR instability ≥ 3) → `stable`.

## TDD Execution

| Phase | Commit | Result |
|-------|--------|--------|
| RED | 7c0899d | 27 tests fail with "Cannot find module" |
| GREEN | 8967584 | 27 tests pass, 0 failures |

## Test Coverage

27 test cases across 4 functions:
- `computeDriftScore`: 6 cases (empty sets, identical, disjoint, partial overlap, single element)
- `detectInstability`: 6 cases (empty, ACTIVE→MILD, ACTIVE→LESS, non-ACTIVE from, outside window, non-tier_change)
- `detectSentimentFlips`: 5 cases (flip detected, only PREFERRED, only DISPREFERRED, outside window, mixed window)
- `classifyTrend`: 9 cases (all threshold boundaries and precedence combinations)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed sentiment flip detection to use `to` field only**
- **Found during:** Task 2 (GREEN) — test "mixed in-window and out-of-window events → only in-window counted" failed
- **Issue:** Initial implementation added both `event.from` and `event.to` to the `seen` set. This caused false positives when an in-window event had `from: "PREFERRED"` (inherited from prior out-of-window state), triggering a flip flag even though only DISPREFERRED was actually observed in-window.
- **Fix:** Changed to record only `event.to` (the outcome sentiment) per in-window event. The `from` value reflects prior state that may predate the window.
- **Files modified:** `src/audit/scorer.ts`
- **Commit:** 8967584 (part of GREEN phase)

## Self-Check: PASSED

- [x] `src/audit/scorer.ts` exists with all 4 exports
- [x] `tests/audit/scorer.test.ts` exists with 27 tests
- [x] Commits 7c0899d and 8967584 verified in git log
- [x] `scorer.ts` contains zero I/O calls (no appendFile, no Bun.file, no fetch)
- [x] Pre-existing `runPrune` failure is unrelated to this plan (verified by stash check)
- [x] Full suite: 384 pass, 1 fail (runPrune pre-existing) → no regressions
