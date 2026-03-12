---
phase: 01-long-term-lobe
plan: "03"
subsystem: scoring
tags: [graphology, bun, tdd, exponential-decay, log-normalization, propagation, sentiment]

requires:
  - phase: 01-01
    provides: AxonStore with typed AxonNodeAttrs/AxonEdgeAttrs and graph.neighbors() API

provides:
  - "recencyScore: exponential decay with configurable half-life (default 14 days)"
  - "frequencyScore: log-normalized count (Math.log(1+n)/Math.log(101))"
  - "coOccurrenceScore: average neighbor edge strength"
  - "compositeScore: 0.40 × recency + 0.35 × frequency + 0.25 × coOccurrence"
  - "classifyTier: maps score to ACTIVE/MILD/LESS using Config thresholds"
  - "propagateActivation: one-hop activation spread with 0.5 dampening"
  - "propagateSentiment: one-hop sentiment influence on importance_weight only"
  - "loadConfig: config.json loader with DEFAULT_CONFIG fallback"

affects:
  - 01-04
  - 01-05
  - cli

tech-stack:
  added: []
  patterns:
    - "Injectable clock (nowMs parameter) for deterministic pure function testing"
    - "Collect neighbors before mutating — never forEachNeighbor with in-place graph mutations"
    - "ScoringConfig = Pick<Config, ...> — type-safe config subset without full Config dependency"
    - "Relevance tier and sentiment tier are fully independent — never coupled in propagation"

key-files:
  created:
    - src/config.ts
    - src/axon/scorer.ts
    - src/axon/propagate.ts
    - tests/axon/scorer.test.ts
    - tests/axon/propagate.test.ts
  modified: []

key-decisions:
  - "frequencyScore uses Math.log(1+n)/Math.log(101) not Math.log1p — base 101 ensures count=100 → exactly 1.0"
  - "ScoringConfig is a Pick<Config> subset — scorer.ts never imports Config directly, only the needed fields"
  - "propagateSentiment nudges importance_weight only — sentiment_tier propagation is intentionally blocked (SNT-04 invariant)"
  - "neighbors collected into array before any mutation loop — forEachNeighbor with graph mutations is unsafe in graphology"

patterns-established:
  - "Injectable clock: all time-sensitive functions accept nowMs: number for testability"
  - "One-hop only: propagation functions explicitly stop after one iteration, no recursion"
  - "Config fallback: loadConfig() catches all Bun.file errors and returns DEFAULT_CONFIG copy"

requirements-completed:
  - AXN-04
  - REL-01
  - REL-02
  - REL-05
  - SNT-02
  - SNT-03
  - SNT-04

duration: 2min
completed: "2026-03-10"
---

# Phase 1 Plan 03: Composite Scorer + One-Hop Propagation Engine Summary

**Pure scoring engine (recency/frequency/coOccurrence composite) and one-hop graph propagation with sentiment independence, all TDD-verified with injectable clocks**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T09:32:40Z
- **Completed:** 2026-03-10T09:34:53Z
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 5 created (3 src, 2 test)

## Accomplishments
- Pure scoring functions with exponential decay recency (14-day half-life), log-normalized frequency, and coOccurrence averaging
- compositeScore combining all three at 0.40/0.35/0.25 weights with classifyTier mapping to ACTIVE/MILD/LESS
- propagateActivation: increments frequency, updates last_seen, spreads importance_weight to direct neighbors only (0.5 dampened, clamped 1.0)
- propagateSentiment: sets sentiment_tier on target, nudges neighbor importance_weight ±0.05 without touching neighbor sentiment_tier (SNT-04 invariant)
- loadConfig with config.json merge and DEFAULT_CONFIG fallback — no throws on missing file
- 22 tests passing (0 failures)

## Task Commits

1. **Task 1 (RED): Failing tests for scorer and propagate** - `be8dc41` (test)
2. **Task 2 (GREEN): Implement scorer, config, propagate** - `aca8ed8` (feat)

## Files Created/Modified
- `src/config.ts` - Config interface, DEFAULT_CONFIG, loadConfig() with Bun.file fallback
- `src/axon/scorer.ts` - Pure scoring functions: recencyScore, frequencyScore, coOccurrenceScore, compositeScore, classifyTier; ScoringConfig type
- `src/axon/propagate.ts` - propagateActivation(), propagateSentiment() — one-hop only, collect-before-mutate pattern
- `tests/axon/scorer.test.ts` - 11 tests covering all scoring functions with injected clock values
- `tests/axon/propagate.test.ts` - 11 tests covering activation propagation, second-hop isolation, sentiment independence

## Decisions Made
- frequencyScore uses Math.log(1+n)/Math.log(101) — base 101 chosen so count=100 produces exactly 1.0 cap naturally
- ScoringConfig is `Pick<Config, "halfLifeDays" | "activeThreshold" | "mildThreshold">` — scorer.ts has no dependency on full Config type, only the fields it needs
- propagateSentiment nudges only importance_weight on neighbors — propagating sentiment_tier itself would violate SNT-04 (ACTIVE + DISPREFERRED must coexist independently)
- neighbors collected into `const neighbors = g.neighbors(nodeKey)` array before mutation loop — forEachNeighbor with graph.updateNodeAttribute inside is unsafe in graphology

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- All scoring and propagation primitives ready for Plan 01-04 (prune/decay sweep)
- compositeScore and classifyTier are the input to relevance_tier updates in pruning
- propagateActivation ready for CLI ingest commands to call after mergeNode
- loadConfig ready to wire into CLI entry point

---
*Phase: 01-long-term-lobe*
*Completed: 2026-03-10*
