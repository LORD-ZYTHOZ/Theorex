---
phase: 05-moment-nodes
verified: 2026-03-11T08:30:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 5: Moment Nodes Verification Report

**Phase Goal:** Implement MomentNode — permanent, user-authored memory nodes that survive pruning, are searchable, surface in inject context, and are captured via CLI.
**Verified:** 2026-03-11T08:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `createMoment` writes a JSON file to `data/moments/{uuid}.json` atomically (temp+rename) | ✓ VERIFIED | `store.ts:41-43` uses `Bun.write(tmpPath) + rename(tmpPath, filePath)`; test confirms `.tmp` gone after write |
| 2  | `readMoments` returns all valid moments from the directory; returns `[]` when directory missing | ✓ VERIFIED | `store.ts:58` uses `readdir(dir).catch(() => [] as string[])`; 7 unit tests cover all branches |
| 3  | MomentNode shape is fully readonly — id, timestamp, story, code_refs, concept_ids | ✓ VERIFIED | `store.ts:18-24`: all 5 fields typed `readonly`; `code_refs: readonly CodeRef[]`; `concept_ids: readonly number[]` |
| 4  | Moment files are never touched by `pruneAxon` or `scanAxon` (structural immunity) | ✓ VERIFIED | grep on `src/axon/prune.ts` and `src/axon/scan.ts` — zero references to `moment`, `MOMENTS_DIR`, or `data/moments`; moments live at `data/moments/` outside axon graph |
| 5  | `theorex search <query>` surfaces moment nodes whose story text matches the query | ✓ VERIFIED | `cli/index.ts:205-216`: `searchMoments()` called after `hybridSearch`, results printed with `[MOMENT]` prefix under `--- Moment Nodes ---` separator |
| 6  | Moment results appear after short-term results with a `--- Moment Nodes ---` separator | ✓ VERIFIED | `cli/index.ts:209`: `console.log("\n--- Moment Nodes ---")` printed only when `momentResults.length > 0` |
| 7  | BM25 search over moments handles the 3-doc minimum with sentinel padding | ✓ VERIFIED | `search.ts:62-73`: pads to 3 docs with sentinel objects (`id: ""`, `sentinel: true`); test covers 1-doc and 2-doc cases |
| 8  | `theorex moment "story text"` creates `data/moments/{uuid}.json` with timestamp, story, code_refs, concept_ids | ✓ VERIFIED | `cli/index.ts:370-379`: `case "moment"` dispatches to `runMoment()`; `capture.ts:121-127` builds MomentNode with all fields and calls `createMoment()` |
| 9  | Code refs captured from `git diff --name-only HEAD`; empty array returned on any failure | ✓ VERIFIED | `capture.ts:28-43`: `Bun.$\`git diff --name-only HEAD\`` wrapped in try/catch; returns `[]` on any failure; optional `gitFn` override for test isolation |
| 10 | SessionStart hook includes relevant moments (concept_id overlap with ACTIVE-tier) in injected context | ✓ VERIFIED | `inject.ts:79-93`: third independent try/catch block; `activeIds` hoisted before block 1; filters moments by `m.concept_ids.some(id => activeIds.has(id))`; 3 new inject tests confirm behavior |
| 11 | `--ref file:line` optional repeatable flag adds explicit code references to moment | ✓ VERIFIED | `cli/index.ts:296-303`: parses `--ref` flags from `Bun.argv`; `capture.ts:117-118`: merges explicit refs with git refs via `mergeCodeRefs()`; test 7 confirms explicit ref appears in `code_refs` |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/moments/store.ts` | `createMoment`, `readMoments`, `loadMoment`, `MomentNode`, `CodeRef`, `MOMENTS_DIR` | ✓ VERIFIED | 91 lines; all 6 exports present; atomic write pattern; ENOENT guard |
| `src/moments/search.ts` | `buildMomentBm25Index`, `searchMoments`, `MomentSearchResult` | ✓ VERIFIED | 131 lines; CJS interop via `createRequire`; sentinel padding; all exports present |
| `src/moments/capture.ts` | `captureCodeRefs`, `extractConceptIds`, `runMoment` | ✓ VERIFIED | 152 lines; all 3 exports present; try/catch on git; pure extractConceptIds; mergeCodeRefs dedup |
| `src/flash/inject.ts` | Third try/catch block for moment overlap; `readMoments` option | ✓ VERIFIED | `inject.ts:79-93`; `activeIds` hoisted at line 32; `readMoments` in options signature |
| `src/config.ts` | `momentsDir` field with default `"data/moments"` | ✓ VERIFIED | `config.ts:24`: `momentsDir: string`; `config.ts:46`: `momentsDir: "data/moments"` in DEFAULT_CONFIG |
| `src/cli/index.ts` | `case "moment"` dispatch; `runMoment` import; `--ref` parsing; moment section in `runSearch`/`runStatus` | ✓ VERIFIED | `cli/index.ts:19-22`: imports present; `cli/index.ts:296-303`: `rawRefs` parsing; `cli/index.ts:370-379`: moment case; `cli/index.ts:204-216`: search section; `cli/index.ts:103-118`: status section |
| `tests/moments/store.test.ts` | Unit tests for `createMoment` round-trip, `readMoments`, ENOENT guard | ✓ VERIFIED | 20 tests; `describe("createMoment"` present; 41 expect() calls |
| `tests/moments/search.test.ts` | Unit tests for BM25 moment search, sentinel padding, result ranking | ✓ VERIFIED | 8 tests; `describe("searchMoments"` present; all edge cases covered |
| `tests/moments/capture.test.ts` | Unit tests for `captureCodeRefs`, `extractConceptIds`, `runMoment` | ✓ VERIFIED | 8 tests in `describe("runMoment"` + describe blocks for captureCodeRefs and extractConceptIds |
| `tests/flash/inject.test.ts` | 3 new moment overlap tests (tests 9, 10, 11) | ✓ VERIFIED | Tests 9-11 present in `describe("injectContext — moment overlap (MOM-04)")` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/moments/store.ts` | `data/moments/{uuid}.json` | `Bun.write(tmp) + rename(tmp, final)` | ✓ WIRED | `store.ts:41-43`; pattern `rename.*\.tmp` confirmed |
| `tests/moments/store.test.ts` | `src/moments/store.ts` | `import { createMoment, readMoments }` | ✓ WIRED | `store.test.ts:9-16` |
| `src/cli/index.ts` | `src/moments/search.ts` | `import { searchMoments }` | ✓ WIRED | `cli/index.ts:21`; called at line 207 |
| `src/cli/index.ts` | `src/moments/store.ts` | `import { readMoments }` | ✓ WIRED | `cli/index.ts:19`; called at lines 104 and 206 |
| `src/moments/search.ts` | `wink-bm25-text-search` | `createRequire(import.meta.url)` | ✓ WIRED | `search.ts:5,8-9`; `createRequire` pattern present |
| `src/moments/capture.ts` | `src/compose` (processText) | `import { processText }` | ✓ WIRED | `capture.ts:11`; called at line 61 |
| `src/moments/capture.ts` | `src/moments/store.ts` | `import { createMoment, MOMENTS_DIR }` | ✓ WIRED | `capture.ts:9-10`; `createMoment` called at line 129 |
| `src/flash/inject.ts` | `src/moments/store.ts` | `import { readMoments }` | ✓ WIRED | `inject.ts:9`; used as default in line 27; called at line 81 |
| `src/cli/index.ts` | `src/moments/capture.ts` | `import { runMoment }` | ✓ WIRED | `cli/index.ts:22`; called at line 377 |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MOM-01 | 05-01, 05-03 | System can create moment nodes — permanent concept anchors tied to a specific point in time | ✓ SATISFIED | `createMoment` writes atomic JSON to `data/moments/`; `runMoment` captures full moment with UUID + timestamp |
| MOM-02 | 05-01, 05-03 | Moment node stores: timestamp, story, code references (file:line), edges to related concepts (concept_ids) | ✓ SATISFIED | `MomentNode` interface: `id`, `timestamp`, `story`, `code_refs: readonly CodeRef[]`, `concept_ids: readonly number[]`; all fields written and round-trip tested |
| MOM-03 | 05-01 | Moment nodes are never pruned regardless of recency or frequency scores | ✓ SATISFIED | Structural immunity confirmed: `pruneAxon` and `scanAxon` have zero references to moments; moments live at `data/moments/` entirely outside the axon graph |
| MOM-04 | 05-02, 05-03 | Moment nodes are searchable and surface in context injection | ✓ SATISFIED | BM25 search via `searchMoments` in `runSearch`; concept_id overlap injection in `injectContext` block 3; all 3 inject overlap tests pass |
| CLI-07 | 05-03 | `theorex moment <story>` — create a moment node with current context | ✓ SATISFIED | `case "moment"` in `cli/index.ts:370`; `--ref` flag parsing at lines 296-303; usage error guard; dispatches to `runMoment` |

---

### Anti-Patterns Found

No anti-patterns detected in phase 5 source files.

| File | Pattern | Classification | Assessment |
|------|---------|----------------|------------|
| `src/moments/search.ts:104` | `return []` | Guard path | Legitimate: early return when no moments |
| `src/moments/search.ts:115-116` | `return null` | Guard path | Legitimate: sentinel filtering in BM25 result mapping |
| `src/moments/capture.ts:42,59,62` | `return []` | Guard path | Legitimate: git failure fallback, empty story guard, empty processText guard |

No TODO/FIXME/PLACEHOLDER comments found. No stub implementations. No orphaned exports.

---

### Test Results Summary

| Test File | Tests | Pass | Fail | Notes |
|-----------|-------|------|------|-------|
| `tests/moments/store.test.ts` | 20 | 20 | 0 | 41 expect() calls |
| `tests/moments/search.test.ts` | 8 | 8 | 0 | All BM25 edge cases covered |
| `tests/moments/capture.test.ts` | 8 | 8 | 0 | Git fn injection, processText, runMoment |
| `tests/flash/inject.test.ts` | 8 | 8 | 0 | Includes 3 new moment overlap tests |
| **Phase 5 total** | **44** | **44** | **0** | |
| Full suite (excl. RAG crash) | 180 | 179 | 1 | Pre-existing `runPrune > 10` failure — confirmed present before Phase 5 changes |

**Pre-existing failure note:** The `runPrune > 10` test failure is unrelated to Phase 5. It was present before these changes (documented in 05-02 SUMMARY) and stems from a `undefined` argument to `rename()` in `src/rag/embedding-store.ts` triggered in a specific prune test scenario. The full RAG test suite crashes Bun with a C++ exception (WASM teardown), which is also a pre-existing issue documented in Phase 4.

---

### Human Verification Required

#### 1. CLI end-to-end smoke test

**Test:** With a populated axon (`data/axon.json`), run:
```
theorex moment "Implemented moment nodes with BM25 search"
theorex search "BM25 search"
theorex status
```
**Expected:**
- `moment` command prints `Moment saved: <uuid>`
- `search` command shows `--- Moment Nodes ---` section with `[MOMENT]` prefix line
- `status` command shows `Moment Nodes — 1 permanent (never pruned)`
**Why human:** Requires live filesystem + axon data; cannot run full CLI in this verification context.

#### 2. SessionStart hook injection

**Test:** Start a Claude Code session in a theorex project that has: (a) ACTIVE-tier concepts in `data/axon.json`, and (b) at least one moment in `data/moments/` whose `concept_ids` overlap with those active concepts.
**Expected:** The injected context block contains `--- Relevant moments ---` section with the moment story.
**Why human:** Requires live Claude Code hook invocation (`flash-inject`) with populated data.

#### 3. `--ref` flag multi-value parsing

**Test:** Run `theorex moment "test story" --ref src/foo.ts:42 --ref src/bar.ts:100`
**Expected:** The written moment JSON contains both `{ file: "src/foo.ts", line: 42 }` and `{ file: "src/bar.ts", line: 100 }` in `code_refs`.
**Why human:** Requires live CLI execution; the unit tests verify the flag parsing logic but not the full Bun.argv path.

---

## Commits Verified

| Commit | Message | Verified |
|--------|---------|---------|
| `5bb0832` | `test(05-01): add failing store tests for MomentNode` | ✓ exists |
| `cb64ee6` | `feat(05-01): implement MomentNode store with atomic write` | ✓ exists |
| `327e6ae` | `test(05-02): add failing search tests for moment BM25` | ✓ exists |
| `8b07c5a` | `feat(05-02): BM25 moment search + CLI runSearch/runStatus integration` | ✓ exists |
| `9391be4` | `test(05-03): add failing tests for runMoment and inject context extension` | ✓ exists |
| `94a9557` | `feat(05-03): runMoment CLI + inject context moment extension` | ✓ exists |

---

## Summary

Phase 5 goal fully achieved. All 5 requirements (MOM-01 through MOM-04, CLI-07) are satisfied with substantive implementations and 44 passing tests. Every must-have from all three plan frontmatter blocks verified at all three levels (exists, substantive, wired). No stub implementations, no orphaned artifacts, no anti-patterns.

Key architectural decisions verified as implemented:
- MomentNode structural immunity: moments at `data/moments/` are invisible to `pruneAxon` and `scanAxon`
- Atomic write invariant: `Bun.write(tmp) + rename(tmp, final)` matches LTM-04 pattern
- BM25 sentinel padding: 3-doc minimum enforced, no sentinel IDs leak into results
- Backward-compatible inject extension: `readMoments` option is optional; cold-start safe
- git capture isolation: `gitFn` override enables unit-test isolation without Bun.$ in tests

---

_Verified: 2026-03-11T08:30:00Z_
_Verifier: Claude (gsd-verifier)_
