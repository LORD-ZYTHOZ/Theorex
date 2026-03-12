---
phase: 01-long-term-lobe
plan: 02
subsystem: memory
tags: [bun, typescript, parser, atomic-write, memory-management, round-trip]

# Dependency graph
requires:
  - phase: 00-significance-engine
    provides: ConceptEvent types and processText pipeline used by higher-level ingestion
provides:
  - "parseMemory() / serializeMemory() — byte-identical MEMORY.md section parser (HARD GATE passed)"
  - "writeMemoryAtomic() — temp+rename atomic write for MEMORY.md"
  - "readMemory() — safe file reader returning '' on ENOENT"
  - "readMeta() / writeMeta() — .theorex-meta.json read/write with atomic pattern"
affects: [01-03-long-term-lobe, 01-04-long-term-lobe, 01-05-long-term-lobe, all phases that write to MEMORY.md]

# Tech tracking
tech-stack:
  added: [node:fs/promises rename, Bun.file, Bun.write]
  patterns: [atomic temp+rename write, index-based substring parser, TDD hard gate]

key-files:
  created:
    - src/memory/parser.ts
    - src/memory/writer.ts
    - src/memory/meta.ts
    - tests/memory/parser.test.ts
    - tests/memory/writer.test.ts
  modified: []

key-decisions:
  - "Parser uses index-based substring slicing (not line split+join) to guarantee byte-identical round-trip — avoids off-by-one newline ambiguity from join semantics"
  - "serializeMemory reconstructs as preamble + sections.map(s => s.heading + s.rawBody) joined with '' — rawBody already starts with the post-heading newline"
  - "rawBody is defined as the substring from (but not including) the heading line to (not including) the next boundary line start — boundary detected via '\\n## ' pattern"
  - "writeMemoryAtomic and writeMeta both use path+'.tmp' in same directory then rename — never cross-filesystem, always atomic on same-filesystem rename"

patterns-established:
  - "Atomic write pattern: Bun.write(path+'.tmp') then node:fs/promises rename(tmp, target)"
  - "ENOENT guard pattern: try Bun.file(path).text() catch return default value"
  - "Index-based parser pattern: indexOf('\\n## ') for boundary detection, slice() for content extraction"

requirements-completed: [LTM-01, LTM-02, LTM-03, LTM-04]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 01 Plan 02: MEMORY.md Parser/Writer Summary

**Byte-identical MEMORY.md section parser (HARD GATE passed) with atomic write pattern and separate .theorex-meta.json I/O**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T09:27:43Z
- **Completed:** 2026-03-10T09:29:56Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 5

## Accomplishments

- HARD GATE passed: `serializeMemory(parseMemory(actualMemoryMd)) === actualMemoryMd` byte-identical on the real MEMORY.md file (8399 bytes)
- Parser correctly detects H2 boundaries via `\n## ` pattern search, preserves H3 as raw body text, handles empty input
- Atomic writer enforces temp+rename pattern — direct writes to MEMORY.md are structurally impossible through the API
- readMemory() and readMeta() both return safe defaults on ENOENT — no cold-start throws
- writeMeta()/readMeta() round-trip preserves all TheorexMeta fields with atomic write

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Write failing tests** - `08bddb1` (test)
2. **Task 2 (GREEN): Implement parser, writer, meta** - `c98e6bb` (feat)

_Note: TDD tasks have RED commit (failing tests) then GREEN commit (implementation)._

## Files Created/Modified

- `src/memory/parser.ts` — parseMemory(), serializeMemory() using index-based substring slicing
- `src/memory/writer.ts` — writeMemoryAtomic() (temp+rename), readMemory() (ENOENT-safe)
- `src/memory/meta.ts` — TheorexMeta interface, readMeta() (defaults on absent), writeMeta() (atomic)
- `tests/memory/parser.test.ts` — 6 test cases including HARD GATE round-trip test
- `tests/memory/writer.test.ts` — 5 test cases covering atomic write, readMemory, readMeta/writeMeta

## Decisions Made

- **Index-based parser over line-split parser:** Initial implementation used `split("\n")` + line arrays + `join("\n")`. This failed because the trailing blank line before the first `## ` heading was lost in preamble reconstruction (join semantics don't add a trailing delimiter). Switched to `indexOf("\n## ")` + `slice()` for substring extraction — preserves every byte exactly without any join ambiguity.
- **rawBody includes leading newline:** The rawBody of each section starts with the `\n` that immediately follows the heading line. This means serializeMemory can be `heading + rawBody` without inserting any separator — the newline is part of rawBody by definition.
- **serializeMemory join("") not join("\n"):** Sections are joined with empty string because all inter-section newlines are already contained within the preceding section's rawBody.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rewrote parser from line-split to index-based to fix round-trip failure**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** Initial `split("\n")` + `join("\n")` implementation failed the round-trip — the blank line before the first `## ` boundary was dropped from the preamble. Raw "# Memory\n\n## System\n..." parsed to preamble "# Memory\n" (missing one `\n`).
- **Fix:** Replaced line-array accumulation with `indexOf("\n## ")` boundary detection and `slice()` for exact substring extraction. Rewrote serializeMemory to use `heading + rawBody` (not `heading + "\n" + rawBody`) since rawBody now starts with the post-heading `\n`.
- **Files modified:** src/memory/parser.ts
- **Verification:** All 11 tests pass including HARD GATE test on actual 8399-byte MEMORY.md
- **Committed in:** c98e6bb (Task 2 / GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in initial parser implementation)
**Impact on plan:** Required fix — the HARD GATE would not pass without it. The interface spec and exported types are unchanged; only internal implementation strategy changed.

## Issues Encountered

- Line-split parser approach had a subtle off-by-one bug at the preamble/section boundary — the trailing newline(s) before the first `## ` heading were not correctly preserved. Diagnosed via error output showing first diff at index 9 (missing `\n`). Resolved by switching to substring-slice approach.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- HARD GATE (LTM-01, LTM-02) passed — other plans may now write to MEMORY.md via writeMemoryAtomic
- src/memory/parser.ts, writer.ts, meta.ts are stable and tested — safe to import from plan 03 and beyond
- .theorex-meta.json storage is independent of MEMORY.md — classification metadata will not pollute the human-readable file

---
*Phase: 01-long-term-lobe*
*Completed: 2026-03-10*
