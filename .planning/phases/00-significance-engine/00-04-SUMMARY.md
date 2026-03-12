---
phase: 00-significance-engine
plan: "04"
subsystem: pipeline
tags: [bun, compromise, synonym-resolution, hashing, wyhash, tdd]

requires:
  - phase: 00-01
    provides: "Spike confirming compromise v14 Strategy C API for alias registration"
  - phase: 00-02
    provides: "NormalizedConcept and IdentifiedConcept types from src/types.ts"

provides:
  - "src/synonyms.ts: ALIASES dictionary, resolveAlias(), registerAliases()"
  - "src/identify.ts: assignIds() — deterministic ID assignment via wyhash 53-bit"
  - "tests/synonyms.test.ts and tests/identify.test.ts: 22 tests, 100% line coverage"

affects:
  - "All downstream pipeline stages that consume IdentifiedConcept"
  - "Phase 1+ long-term storage (conceptId is the graph node key)"

tech-stack:
  added: []
  patterns:
    - "resolveAlias called before hashing to collapse synonym forms before ID assignment"
    - "Bun.hash.wyhash with explicit 0n seed for cross-process determinism"
    - "53-bit BigInt mask (& MAX_SAFE_INTEGER as BigInt) to guarantee safe integer range"
    - "Strategy C compromise plugin format: nlp.extend({ words: { abbr: 'Acronym' } })"
    - "Module-level registerAliases() call — one-time initialization acceptable side effect"

key-files:
  created:
    - src/synonyms.ts
    - src/identify.ts
    - tests/synonyms.test.ts
    - tests/identify.test.ts
  modified: []

key-decisions:
  - "wyhash output masked to 53 bits (& MAX_SAFE_INTEGER) — raw 64-bit values exceed MAX_SAFE_INTEGER, causing precision loss on Number() cast"
  - "registerAliases() uses compromise Strategy C (verified in Plan 01 spike), called once at module load"
  - "resolveAlias is pure with no side effects; compromise registration is separate one-time module init"

patterns-established:
  - "Alias collapse before hash: resolveAlias(canonicalForm) must be called before Bun.hash.wyhash() in any future ID assignment"
  - "wyhash determinism gate: explicit seed 0n is mandatory — seedless wyhash uses random per-process seed"
  - "Safe integer contract: always mask wyhash BigInt result before Number() conversion"

requirements-completed:
  - SIG-03

duration: 2min
completed: "2026-03-10"
---

# Phase 0 Plan 04: Synonym Resolution and Stable ID Assignment Summary

**Case-insensitive alias dictionary (ml→machine learning, ai→artificial intelligence, etc.) with wyhash 53-bit deterministic IDs ensuring synonym-collapsed concepts always hash to the same conceptId**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T00:25:41Z
- **Completed:** 2026-03-10T00:27:37Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 4 created

## Accomplishments

- Implemented `resolveAlias()` — case-insensitive alias lookup, pure function with no side effects
- Implemented `registerAliases()` via Strategy C (`nlp.extend({ words: {...} })`), verified by Plan 01 spike
- Implemented `assignIds()` with deterministic wyhash + 53-bit mask ensuring safe integer range
- 22 tests pass, 100% line coverage on both implementation files

## Task Commits

1. **RED: Failing tests** - `17eeaca` (test)
2. **GREEN: Implementations** - `18db6fd` (feat)

## Files Created/Modified

- `src/synonyms.ts` — ALIASES dict, resolveAlias() (pure), registerAliases() (module init)
- `src/identify.ts` — assignIds() with wyhash 53-bit mask for safe integer range
- `tests/synonyms.test.ts` — 13 tests covering alias lookup, case insensitivity, idempotency
- `tests/identify.test.ts` — 9 tests covering determinism, alias collapse, immutability, safe integers

## Decisions Made

- Masked wyhash to 53 bits: `Bun.hash.wyhash(resolved, 0n) & BigInt(Number.MAX_SAFE_INTEGER)`. Raw 64-bit wyhash values (e.g., `16607456738776325395`) exceed `Number.MAX_SAFE_INTEGER = 9007199254740991`, causing silent precision loss on `Number()` cast. The mask preserves collision resistance for practical vocabulary sizes.
- Used Strategy C for registerAliases() as confirmed by Plan 01 spike (Strategy B also verified, Strategy C is canonical v14 format).
- Module-level `registerAliases()` call at bottom of synonyms.ts — one-time side effect acceptable for compromise global lexicon registration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Masked wyhash to 53-bit safe integer range**
- **Found during:** GREEN phase (failing test: "all conceptIds are finite safe integers")
- **Issue:** `Number(Bun.hash.wyhash(resolved, 0n))` produces values exceeding `Number.MAX_SAFE_INTEGER` for most inputs. Example: `typescript` hashes to BigInt `16607456738776325395` which silently rounds to `16607456738776326000` — precision loss, and > MAX_SAFE_INTEGER.
- **Fix:** Applied 53-bit mask: `Number(Bun.hash.wyhash(resolved, 0n) & BigInt(Number.MAX_SAFE_INTEGER))`
- **Files modified:** `src/identify.ts`
- **Verification:** All test values confirmed safe integers, `ml` and `machine learning` still produce identical IDs after masking
- **Committed in:** `18db6fd` (feat(00-04) commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix was necessary for correctness — the plan's must_haves explicitly required safe integers. Mask preserves all key properties (determinism, alias collapse, no collision in test set).

## Issues Encountered

None beyond the auto-fixed bug above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `assignIds()` is ready for integration into the full pipeline (Plan 05 or 06)
- conceptId is the stable graph node key; downstream phases can rely on it being a safe positive integer
- `resolveAlias()` is available for any future synonym expansion needs

---
*Phase: 00-significance-engine*
*Completed: 2026-03-10*
