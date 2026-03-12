---
phase: 00-significance-engine
plan: 01
subsystem: testing
tags: [bun, compromise, nlp, spike, alias, acronym]

# Dependency graph
requires: []
provides:
  - "Bun 1.3.10 project scaffold with compromise v14.15.0 installed"
  - "Verified compromise v14 alias registration API (two confirmed working strategies)"
  - "src/spike/alias-api.test.ts with spike result documented for Plan 04 reference"
affects:
  - "00-04-synonyms (direct: use nlp.extend({ words: {...} }) pattern)"
  - "00-normalize (uses compromise normalization pipeline)"

# Tech tracking
tech-stack:
  added:
    - "bun 1.3.10 (runtime, test runner, package manager)"
    - "compromise 14.15.0 (NLP library)"
    - "@types/bun 1.3.10 (TypeScript types for Bun globals)"
    - "typescript 5.9.3 (via peerDependency)"
  patterns:
    - "Spike-first: verify uncertain API shapes in isolated test before writing production code"
    - "bun test with bun:test imports — zero-config TypeScript test runner"

key-files:
  created:
    - "package.json — Bun project manifest with test script"
    - "tsconfig.json — TypeScript config for Bun (bundler mode, strict, allowImportingTsExtensions)"
    - "src/spike/alias-api.test.ts — compromise alias API spike with verified results"
    - "bun.lock — Bun lockfile"
    - ".gitignore — standard Bun project gitignore"
    - "index.ts — project entry point (stub)"
    - "CLAUDE.md — Bun project conventions"
  modified: []

key-decisions:
  - "Strategy C (nlp.extend({ words: {...} })) is the canonical v14 plugin format — use in synonyms.ts"
  - "Strategy A (callback form) did NOT register the Acronym tag reliably — do not use"
  - "nlp.addWords({ abbr: 'TagName' }) also works as a simpler alternative to extend()"
  - "Lexicon values are tag name strings (e.g. 'Acronym'), not arrays — single string per word"
  - "normalize({ acronyms: true }) does NOT expand abbreviations to full form — only affects casing"
  - "Alias resolution for ML → machine learning requires a Map lookup BEFORE hashing, not via compromise normalization"

patterns-established:
  - "Spike test pattern: test strategies in isolation, log results, assert on discovery not correctness"
  - "Compromise JSON output: use { terms: { tags: true, text: true } } to get per-term tag arrays"

requirements-completed:
  - SIG-03

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 0 Plan 01: Compromise v14 Alias API Spike Summary

**Verified two working strategies for compromise v14 word-to-tag registration: nlp.extend({ words }) (canonical) and nlp.addWords() (direct), with alias normalization gap documented for Plan 04**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T08:20:30Z
- **Completed:** 2026-03-10T08:22:48Z
- **Tasks:** 1
- **Files modified:** 7 created

## Accomplishments

- Bun 1.3.10 project initialized with compromise v14.15.0 and TypeScript configured
- 5-test spike confirmed Strategies B and C register 'ml' as Acronym tag successfully
- Strategy A (callback plugin form) tested — did not reliably produce the tag on first parse
- Critical discovery documented: `normalize({ acronyms: true })` does NOT expand abbreviations — alias resolution requires a pre-hashing Map lookup, not compromise normalization
- Verified API pattern recorded in top-of-file comment block for Plan 04 (synonyms.ts) to reference

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Bun project and run compromise alias spike** - `d579238` (feat)

**Plan metadata:** _(pending final docs commit)_

## Files Created/Modified

- `package.json` — Bun project manifest with `"test": "bun test"` script, compromise + @types/bun deps
- `tsconfig.json` — TypeScript config: bundler moduleResolution, allowImportingTsExtensions, strict mode
- `src/spike/alias-api.test.ts` — 5 spike tests exploring 3 alias registration strategies; spike result in comment block
- `bun.lock` — Bun lockfile (compromise 14.15.0, @types/bun 1.3.10, typescript 5.9.3)
- `.gitignore` — Standard Bun project ignores
- `index.ts` — Project entry stub (from bun init)
- `CLAUDE.md` — Bun project conventions (from bun init)

## Decisions Made

- **nlp.extend({ words: { abbr: 'TagName' } }) is the canonical v14 pattern.** Confirmed by source inspection of `src/API/extend.js` line 117-119: `if (plugin.words) { nlp.addWords(plugin.words) }`. Use this in synonyms.ts.
- **Lexicon values are single tag name strings.** `{ ml: "Acronym" }` not `{ ml: ["Acronym"] }`. The `Lexicon` type in misc.d.ts is `{ [key: string]: string }`.
- **Alias expansion is NOT compromise's job.** `normalize({ acronyms: true })` only adjusts casing, it does not expand "ML" to "machine learning". Plan 04 must implement `resolveAlias()` as a Map lookup applied before `Bun.hash.wyhash()` hashing.
- **Strategy A skipped for production.** The callback form `nlp.extend((_Doc, world) => { world.addWords(...) })` did not tag "ML" as Acronym in test ordering — likely because the callback mutates a world copy, not the global lexicon.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bun not installed — installed automatically**
- **Found during:** Task 1 (project initialization)
- **Issue:** `bun` command not found on PATH — required for all project operations
- **Fix:** Ran `curl -fsSL https://bun.sh/install | bash` — installed Bun 1.3.10 to `~/.bun/bin/`
- **Files modified:** `~/.bun/` (system-level, not committed)
- **Verification:** `bun --version` returns `1.3.10`
- **Committed in:** d579238 (Task 1 commit — project scaffold depends on bun being present)

---

**Total deviations:** 1 auto-fixed (blocking: Bun installation)
**Impact on plan:** Blocking issue resolved automatically. No scope creep. Bun 1.3.10 is compatible with project requirements (plan specified 1.3.7+).

## Issues Encountered

- Bun not on system PATH in non-interactive shell — resolved by installing via official installer
- Strategy A (callback form) did not produce Acronym tag: the callback receives a snapshot `world` object, not the live global lexicon; mutations do not persist. This is an important nuance for synonyms.ts authoring.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Bun project scaffold is complete — Plan 02 can begin immediately
- compromise v14.15.0 is installed and verified
- **For Plan 04 (synonyms.ts):** Use `nlp.extend({ words: { ml: "Acronym", ai: "Acronym" } })` pattern. Implement `resolveAlias(form: string): string` as a Map lookup before hashing — do NOT rely on compromise normalize() for abbreviation expansion.
- **No blockers** — all ambiguity about the compromise alias API is resolved

---
*Phase: 00-significance-engine*
*Completed: 2026-03-10*
