---
phase: 02-short-term-lobe
plan: "05"
subsystem: cli
tags: [cli, search, graduate, short-term, integration]
dependency_graph:
  requires:
    - 02-03  # hybridSearch
    - 02-04  # findGraduateCandidates, graduateToLongTerm
  provides:
    - CLI-05  # theorex search <query>
    - CLI-06  # theorex graduate
  affects:
    - src/cli/index.ts
tech_stack:
  added: []
  patterns:
    - "Named handler exports + import.meta.main dispatch (Phase 1 pattern extended)"
    - "rotateStm housekeeping on each CLI invocation"
key_files:
  created:
    - tests/cli/cli-search.test.ts
    - tests/cli/cli-graduate.test.ts
  modified:
    - src/cli/index.ts
decisions:
  - "runSearch + runGraduate follow exact Phase 1 handler pattern: exported named functions + dispatch case"
  - "MEMORY_PATH constant (data/MEMORY.md) added to cli/index.ts alongside existing AXON_PATH/ARCHIVE_DIR"
  - "rotateStm() called at start of both handlers for STM-02 housekeeping on every CLI invocation"
  - "search dispatch uses rest.join(' ') from positionals destructuring (not a separate args variable)"
  - "CLI tests use underlying functions directly (hybridSearch, findGraduateCandidates, graduateToLongTerm) with temp dirs for path override — runSearch/runGraduate tested for no-data paths"
metrics:
  duration: "3 min"
  completed: "2026-03-10"
  tasks_completed: 2
  files_modified: 3
---

# Phase 2 Plan 05: CLI Search + Graduate Commands Summary

CLI surface for Phase 2: `theorex search <query>` and `theorex graduate` subcommands wired into the existing dispatch pattern with 7 integration tests, 259/259 passing.

## What Was Built

### Task 1: runSearch + runGraduate handlers in cli/index.ts

Added three new imports to `src/cli/index.ts`:
- `hybridSearch` from `../short-term/search`
- `readShortTermFiles`, `rotateStm` from `../short-term/store`
- `findGraduateCandidates`, `graduateToLongTerm` from `../short-term/graduate`

Added `MEMORY_PATH = "data/MEMORY.md"` constant.

**runSearch(query, config):** Calls `rotateStm()` for housekeeping, then `hybridSearch(query, 10, {lmStudioUrl, lmStudioEmbedModel, lmStudioTimeoutMs})`. Prints "No results found for: {query}" when empty, or a formatted ranked table with rank, concept, score (4 decimals), date columns.

**runGraduate(config, memoryPath):** Calls `rotateStm()`, reads STM files, finds candidates via `findGraduateCandidates(entries, config.stmGraduateDays)`, prints "Nothing to graduate." when none qualify, otherwise calls `graduateToLongTerm` and lists each promoted concept.

Both subcommand dispatch cases added to `import.meta.main` block. `search` uses `rest.join(" ")` from positionals destructuring.

### Task 2: Integration tests

**tests/cli/cli-search.test.ts** (4 tests):
1. Empty STM — `runSearch` prints "No results found", no throw
2. Matching entry — result contains that entry's surface_form (via `hybridSearch` with temp dir)
3. Score ordering — results descending by score
4. rotateStm — 15-day-old JSONL file is deleted

**tests/cli/cli-graduate.test.ts** (3 tests):
1. No qualifying entries — `runGraduate` prints "Nothing to graduate."
2. 7-consecutive-day entries — `graduateToLongTerm` writes MEMORY.md with "## Short-Term Graduates"
3. Idempotency — running twice leaves exactly one "## Short-Term Graduates" section and one "### deep learning" subsection

## Verification

```
bun run src/cli/index.ts search "machine learning"   # → "No results found for: machine learning", exit 0
bun run src/cli/index.ts graduate                     # → "Nothing to graduate.", exit 0
bun test tests/                                        # → 259 pass, 0 fail
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] src/cli/index.ts modified — exists and has runSearch, runGraduate exports
- [x] tests/cli/cli-search.test.ts created — 4 tests pass
- [x] tests/cli/cli-graduate.test.ts created — 3 tests pass
- [x] Commits: 00dcd58 (Task 1), 5af69f8 (Task 2)
- [x] Full suite: 259 pass, 0 fail
