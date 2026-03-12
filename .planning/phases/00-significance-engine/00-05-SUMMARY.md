---
phase: 00-significance-engine
plan: 05
subsystem: significance-engine
tags: [typescript, bun, tdd, gate, frequency, log-normalization]

# Dependency graph
requires:
  - phase: 00-significance-engine/00-02
    provides: types.ts — GatedConcept and ScoredConcept interfaces used as I/O types
  - phase: 00-significance-engine/00-04
    provides: IdentifiedConcept type — input to importanceGate()

provides:
  - isImportant() — pure 6-rule gate function with strict rule ordering
  - importanceGate() — filters IdentifiedConcept[] → GatedConcept[] (never mutates)
  - amplifyFrequency() — scores GatedConcept[] with log-normalized frequency: 1+ln(n)
  - IMPORTANT_TAGS and STOP_CONCEPTS exported constants
  - Full 100% test coverage via TDD cycle

affects:
  - Phase 0 plan 06 (pipeline assembly — imports importanceGate and amplifyFrequency)
  - All downstream phases that consume ScoredConcept[]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Gate-before-amplify enforced by TypeScript types (GatedConcept vs IdentifiedConcept)
    - 6-rule isImportant() with rejection rules first, then acceptance rules
    - Log-normalized frequency: 1+ln(n) yields f(1)=1.0, f(10)=3.302, f(1000)=7.908
    - Important-tag override on Rule 1 (short words with Acronym/Person/etc. still pass)

key-files:
  created:
    - src/gate.ts
    - src/amplify.ts
    - tests/gate.test.ts
    - tests/amplify.test.ts
  modified: []

key-decisions:
  - "Formula is 1+Math.log(n) not 1+Math.log1p(n) — the spec said log1p but the required values f(1)=1.0/f(10)=3.302/f(1000)=7.908 require ln(n), corrected to match expected values"
  - "Rule 1 short-word rejection has an important-tag exception — concepts with Acronym, Person, Place, Organization, Value, ProperNoun tags bypass the length check (ML, 42 etc. pass correctly)"

patterns-established:
  - "Gate-first invariant enforced by GatedConcept type — amplifyFrequency() cannot accept IdentifiedConcept[] at compile time"
  - "isImportant() is a pure function — no mutation, no I/O, deterministic"
  - "All frequency regex escaping via str.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') before RegExp construction"

requirements-completed: [SIG-02, SIG-04]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 0 Plan 05: importanceGate + amplifyFrequency Summary

**Type-enforced gate-first pipeline: 6-rule importance gate filters IdentifiedConcept[] to GatedConcept[], then log-normalized amplifier (1+ln(n)) scores frequency — compile error if called out of order**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T08:31:08Z
- **Completed:** 2026-03-10T08:34:10Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 4 (gate.ts, amplify.ts, gate.test.ts, amplify.test.ts)

## Accomplishments

- 6-rule importance gate with strict ordering: rejection rules (1 short-word, 2 stop-concepts) before acceptance rules (3 named entities, 4 multi-word, 5 acronyms, 6 proper nouns)
- Log-normalized frequency amplifier 1+ln(n) yields f(1)=1.0, f(10)≈3.302, f(1000)≈7.908 — sublinear bounded growth
- Type system enforces gate-before-frequency ordering: amplifyFrequency() only accepts GatedConcept[], not IdentifiedConcept[]
- 100% line and function coverage on both implementation files; 69 tests pass across both test files

## Task Commits

1. **Task 1: RED — failing tests** - `5531281` (test)
2. **Task 2: GREEN — implementation** - `4dd85ed` (feat)

## Files Created/Modified

- `src/gate.ts` — isImportant() (6 rules), importanceGate(), IMPORTANT_TAGS, STOP_CONCEPTS exports
- `src/amplify.ts` — amplifyFrequency() with regex escaping, 1+ln(n) formula, floor-to-1 fallback
- `tests/gate.test.ts` — 58 tests covering all 6 rules, importanceGate behavior, constants, immutability
- `tests/amplify.test.ts` — 11 tests covering f(1)/f(10)/f(1000) values, regex edge cases, immutability, empty array

## Decisions Made

- **Formula correction:** The plan spec said `1 + Math.log1p(n)` but the must-have values (f(1)=1.0, f(10)≈3.3, f(1000)≈7.9) require `1 + Math.log(n)`. Used Math.log (natural log) to match the authoritative numeric spec.
- **Rule 1 important-tag exception:** The plan's behavior spec requires "ML" (Acronym, 2 chars) and "42" (Value, 2 chars) to pass. Rule 1's short-word rejection must not apply when the concept has an important tag. Added `!tags.some(t => IMPORTANT_TAGS.has(t))` guard to Rule 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] frequencyAmplifier formula mismatch — spec said log1p but values require log**
- **Found during:** Task 2 (GREEN — implementing amplify.ts)
- **Issue:** Plan implementation spec wrote `1 + Math.log1p(frequencyCount)` but the must-have truths state f(1)=1.0, f(10)≈3.3, f(1000)≈7.9. Math.log1p(1) = ln(2) ≈ 0.693, so 1+log1p(1) ≈ 1.693, not 1.0. The numeric expected values require Math.log (natural log), where ln(1)=0, so 1+ln(1)=1.0.
- **Fix:** Used `1 + Math.log(frequencyCount)` in implementation. Updated test expectations to use `Math.log` to match the corrected formula.
- **Files modified:** src/amplify.ts, tests/amplify.test.ts
- **Verification:** f(1)=1.0, f(10)≈3.302, f(1000)≈7.908 confirmed by tests
- **Committed in:** 4dd85ed (Task 2 feat commit)

**2. [Rule 1 - Bug] Rule 1 short-word rejection blocked valid Acronym and Value concepts**
- **Found during:** Task 2 (GREEN — running gate tests)
- **Issue:** Rule 1 rejected "ml" (Acronym, 2 chars) and "42" (Value, 2 chars) before Rules 5 and 3 could accept them. The plan's behavior spec says Acronym and Value always pass.
- **Fix:** Added `!tags.some(t => IMPORTANT_TAGS.has(t))` guard to Rule 1 so concepts with any important tag are not short-circuit rejected.
- **Files modified:** src/gate.ts
- **Verification:** All 58 gate tests pass including "ML with Acronym" and "Value tag returns true"
- **Committed in:** 4dd85ed (Task 2 feat commit)

---

**Total deviations:** 2 auto-fixed (2 bugs — spec inconsistencies between formula description and expected values)
**Impact on plan:** Both fixes align implementation with the authoritative expected output values. No scope creep.

## Issues Encountered

None beyond the two auto-fixed spec inconsistencies above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- gate.ts and amplify.ts are complete and fully tested
- importanceGate() and amplifyFrequency() ready to be imported by plan 06 (pipeline assembly)
- Type constraint (GatedConcept) ensures amplify can only be called after gate in all future code
- No blockers

---
*Phase: 00-significance-engine*
*Completed: 2026-03-10*
