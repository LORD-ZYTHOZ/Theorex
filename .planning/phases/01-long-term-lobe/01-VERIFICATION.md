---
phase: 01-long-term-lobe
verified: 2026-03-10T12:10:00Z
status: passed
score: 5/5 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "REL-03 lazy-on-read path implemented: runStatus() now recomputes tier with compositeScore+classifyTier using Date.now() before rendering each row"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run `pm2 start ecosystem.config.cjs` then `pm2 list`"
    expected: "PM2 shows theorex-scan with cron_restart '0 */6 * * *' and status online"
    why_human: "Cannot invoke PM2 in test environment; cron scheduling is a runtime behavior"
---

# Phase 1: Long-Term Lobe Verification Report

**Phase Goal:** Build the Long-Term Lobe — the persistent axon graph with scoring, relevance tiering, CLI commands, and background scanning.
**Verified:** 2026-03-10T12:10:00Z
**Status:** passed
**Re-verification:** Yes — closes REL-03 gap found in previous verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running `theorex scan` re-scores all nodes, applies exponential decay, and updates tiers — MEMORY.md content is unchanged and byte-identical after the run | VERIFIED | `scanAxon()` in `src/axon/scan.ts` never touches MEMORY.md. Applies compositeScore to all nodes, exponential edge decay, writes axon.json atomically. 7 scan tests pass. |
| 2 | Running `theorex status` displays every known concept with its ACTIVE/MILD/LESS tier and PREFERRED/NEUTRAL/DISPREFERRED sentiment, using the tier computed from current time (not the stale stored value) | VERIFIED | `runStatus()` in `src/cli/index.ts` imports `compositeScore` and `classifyTier` (line 14). Computes `nowMs = Date.now()` once before the loop. Calls `compositeScore(attrs.last_seen, attrs.frequency_count, neighborStrengths, nowMs, config)` and `classifyTier(score, config)` per node. Renders `displayTier`, not `attrs.relevance_tier`. No `store.save()` call in `runStatus()`. Test 11 proves a node with stored `relevance_tier: "ACTIVE"` but `last_seen` 100 days ago displays as `LESS`. |
| 3 | A node activated by `theorex ref <keyword>` raises its neighbors by at most 50% of the activation amount (one-hop, 0.5 dampening), and no second-hop nodes change | VERIFIED | `propagateActivation()` in `src/axon/propagate.ts`: `dampened = activationDelta * 0.5`, collects neighbors into array before mutation, strictly one hop. Propagation tests include explicit second-hop isolation coverage. |
| 4 | Running `theorex prune` moves LESS nodes past the 30-day threshold to data/archive/ — the original MEMORY.md and axon.json entries are removed but data/archive/ retains the records | VERIFIED | `pruneAxon()` in `src/axon/prune.ts` writes JSONL archive to `data/archive/pruned-{timestamp}.jsonl` before calling `graph.dropNode()`. 7 prune tests pass. |
| 5 | Writing MEMORY.md to a temp file then atomically renaming succeeds under concurrent sessions — MEMORY.md is never left in a partial state | VERIFIED | `writeMemoryAtomic()` in `src/memory/writer.ts`: writes to `targetPath + ".tmp"` then `rename(tmpPath, targetPath)`. Same pattern enforced in `writeMeta()` and `store.save()`. All atomic write tests pass. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/axon/store.ts` | AxonStore class: typed graph, atomic save/load, mergeNode/mergeEdge | VERIFIED | 136 lines. Exports `AxonStore`, `AxonNodeAttrs`, `AxonEdgeAttrs`. Atomic save via path+".tmp" + rename. |
| `src/memory/parser.ts` | parseMemory(), serializeMemory() — byte-identical round-trip | VERIFIED | 92 lines. Index-based `indexOf("\n## ")` boundary detection. `serializeMemory` uses `join("")`. |
| `src/memory/writer.ts` | writeMemoryAtomic(), readMemory() | VERIFIED | 35 lines. Atomic temp+rename enforced. ENOENT returns "". |
| `src/memory/meta.ts` | TheorexMeta interface, readMeta(), writeMeta() | VERIFIED | 50 lines. Atomic write. ENOENT returns default `{version:1, last_scan:null, node_metadata:{}}`. |
| `src/axon/scorer.ts` | Pure scoring functions: recencyScore, frequencyScore, coOccurrenceScore, compositeScore, classifyTier | VERIFIED | 73 lines. All pure functions with `nowMs` injectable clock. |
| `src/axon/propagate.ts` | propagateActivation(), propagateSentiment() — one-hop only | VERIFIED | 59 lines. Collect-before-mutate pattern. One-hop strictly. Sentiment nudges importance_weight only. |
| `src/config.ts` | loadConfig() with DEFAULT_CONFIG fallback | VERIFIED | 33 lines. `DEFAULT_CONFIG` exported. Falls back to defaults on missing file. |
| `src/axon/scan.ts` | scanAxon() — re-score all nodes, decay edges, atomic write | VERIFIED | 95 lines. Imports AxonStore, compositeScore, classifyTier. Atomic save. |
| `src/axon/prune.ts` | pruneAxon() — archive LESS nodes past threshold, drop from graph | VERIFIED | 104 lines. Archive-before-drop invariant enforced. JSONL format. Atomic save. |
| `src/cli/index.ts` | CLI entry point: scan/status/ref/prune dispatch; runStatus() with lazy tier recomputation | VERIFIED | 173 lines. Imports compositeScore + classifyTier (line 14). runStatus() computes displayTier per node using Date.now(). No disk write in runStatus(). All 4 handlers exported. |
| `tests/cli/cli.test.ts` | 11 CLI tests including REL-03 regression (test 11) | VERIFIED | Test 11 "runStatus corrects stale stored tier using elapsed time (REL-03)" passes. Node with stored ACTIVE + last_seen 100 days ago displays as LESS. |
| `ecosystem.config.cjs` | PM2 cron config: `0 */6 * * *` for theorex-scan | VERIFIED | Present at project root. `cron_restart: "0 */6 * * *"`, `script: "bun"`, `args: "run src/cli/index.ts scan"`. |
| `data/archive/.gitkeep` | Archive directory tracked by git | VERIFIED | File exists. Directory present. |

All test files exist. 213 tests pass, 0 failures, 399 expect() calls.

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/axon/store.ts` | `data/axon.json` | `Bun.write + node:fs/promises rename` | WIRED | Lines 113-115: atomic tmp+rename pattern |
| `src/axon/store.ts` | `graphology UndirectedGraph` | `UndirectedGraph.from<AxonNodeAttrs, AxonEdgeAttrs>` | WIRED | Typed constructor on load |
| `src/memory/parser.ts` | MEMORY.md raw text | `indexOf("\n## ")` boundary detection | WIRED | Index-based section scan loop |
| `src/memory/writer.ts` | MEMORY.md file | `Bun.write .tmp then rename` | WIRED | tmpPath pattern enforced |
| `src/axon/scorer.ts` | `src/config.ts` | `ScoringConfig = Pick<Config, ...>` | WIRED | Type shared between modules |
| `src/axon/propagate.ts` | `src/axon/store.ts` | `import type { AxonStore }` | WIRED | Line 5 of propagate.ts |
| `src/axon/scan.ts` | `src/axon/scorer.ts` | `compositeScore + classifyTier` | WIRED | Imports and calls both functions |
| `src/axon/scan.ts` | `src/axon/store.ts` | `AxonStore.load + store.save()` | WIRED | Load and atomic save present |
| `src/axon/prune.ts` | `data/archive/` | `Bun.write JSONL then node:fs/promises mkdir` | WIRED | mkdir then Bun.write |
| `src/cli/index.ts` | `src/axon/scan.ts` | `scanAxon()` | WIRED | Import line 10; called in runScan |
| `src/cli/index.ts` | `src/axon/prune.ts` | `pruneAxon()` | WIRED | Import line 11; called in runPrune |
| `src/cli/index.ts` | `src/axon/propagate.ts` | `propagateActivation()` for ref | WIRED | Import line 12; called in runRef |
| `src/cli/index.ts` | `src/axon/store.ts` | `AxonStore.load()` for status and ref | WIRED | Import line 13; used in runStatus and runRef |
| `runStatus()` | `src/axon/scorer.ts` | `compositeScore + classifyTier` via import line 14 | WIRED | compositeScore called line 80; classifyTier called line 81; displayTier rendered line 87; no store.save() in runStatus(). REL-03 CLOSED. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AXN-01 | 01-01 | Maintains weighted concept graph | SATISFIED | `UndirectedGraph` in `src/axon/store.ts` with typed node/edge attributes |
| AXN-02 | 01-01 | Node carries 8 required fields | SATISFIED | `AxonNodeAttrs`: concept_id, surface_form, importance_weight, relevance_tier, sentiment_tier, last_seen, frequency_count, source_weight |
| AXN-03 | 01-01 | Edge carries: strength, co-occurrence count, last co-occurrence timestamp | SATISFIED | `AxonEdgeAttrs`: all 3 fields. `mergeEdge()` sets/updates them. |
| AXN-04 | 01-03 | Activation propagates one hop with 0.5 dampening | SATISFIED | `propagateActivation()`: `dampened = activationDelta * 0.5`, strictly one hop |
| AXN-05 | 01-01, 01-04 | New edges form on co-occurrence; dead edges decay and prune below threshold | SATISFIED | `mergeEdge()` creates/strengthens; `scanAxon()` decays and drops edges below `edgePruneThreshold` |
| AXN-06 | 01-01 | Graph serialises to human-inspectable JSON; loads from JSON on startup | SATISFIED | `store.save()` writes indented JSON; `AxonStore.load()` reconstructs |
| REL-01 | 01-03 | Every node classified as ACTIVE/MILD/LESS based on composite score | SATISFIED | `compositeScore()` and `classifyTier()` in `src/axon/scorer.ts`; applied in `scanAxon()` and now in `runStatus()` |
| REL-02 | 01-03 | Recency uses exponential decay with configurable lambda (default: 14-day half-life) | SATISFIED | `recencyScore()`: `Math.exp(-Math.LN2/halfLifeDays * daysElapsed)`. Default `halfLifeDays: 14` |
| REL-03 | 01-04, 01-05, 01-06 | Classification updates lazily on read AND eagerly on scheduled scan every 6 hours | SATISFIED | Lazy-on-read: `runStatus()` recomputes via `compositeScore+classifyTier` with `Date.now()` per node (plan 01-06). Eager-scan: `ecosystem.config.cjs` cron `0 */6 * * *`. Test 11 verifies stale stored tier corrected at display time. |
| REL-04 | 01-04 | LESS nodes past 30 days archived then deleted | SATISFIED | `pruneAxon()`: threshold check, archive before drop |
| REL-05 | 01-03 | Classification thresholds configurable in config.json | SATISFIED | `activeThreshold` (0.6) and `mildThreshold` (0.3) in `DEFAULT_CONFIG` |
| SNT-01 | 01-01 | Every node starts at NEUTRAL sentiment | SATISFIED | `mergeNode()`: `sentiment_tier: "NEUTRAL"` on new node |
| SNT-02 | 01-05 | System can set node sentiment to PREFERRED or DISPREFERRED | SATISFIED | `propagateSentiment()` sets `sentiment_tier` on target node |
| SNT-03 | 01-03 | Sentiment propagates one hop with dampening | SATISFIED | `propagateSentiment()`: nudges `importance_weight` only, one hop, never floods graph |
| SNT-04 | 01-03 | A node can be ACTIVE + DISPREFERRED or LESS + PREFERRED | SATISFIED | `relevance_tier` and `sentiment_tier` are independent fields, never coupled |
| LTM-01 | 01-02 | System parses MEMORY.md into structured entries using section-boundary parser | SATISFIED | `parseMemory()` in `src/memory/parser.ts` uses `indexOf("\n## ")` |
| LTM-02 | 01-02 | Parser produces byte-identical output when writing unmodified entries (hard gate) | SATISFIED | `serializeMemory(parseMemory(raw)) === raw` contract enforced; HARD GATE test present |
| LTM-03 | 01-02 | Classification metadata stored in .theorex-meta.json separate from MEMORY.md | SATISFIED | `src/memory/meta.ts`: independent file path, never embedded in MEMORY.md |
| LTM-04 | 01-02 | Writer always writes to temp file first, then atomic rename | SATISFIED | `writeMemoryAtomic()`: `Bun.write(tmpPath)` then `rename(tmpPath, targetPath)` |
| LTM-05 | 01-04 | Pruned entries archived to data/archive/ before deletion — never silently lost | SATISFIED | `pruneAxon()`: `Bun.write(archivePath)` before any `graph.dropNode()` |
| CLI-01 | 01-05 | `theorex scan` — re-score all entries, apply decay, update classifications | SATISFIED | `runScan()` calls `scanAxon(AXON_PATH, config)` |
| CLI-02 | 01-05 | `theorex status` — display all nodes with tier pairs | SATISFIED | `runStatus()` renders padEnd-aligned table with corrected tier values |
| CLI-03 | 01-05 | `theorex ref <keyword>` — record a reference, bump recency and frequency | SATISFIED | `runRef()`: finds node, calls `propagateActivation(store, nodeKey, 1.0, Date.now())`, saves |
| CLI-04 | 01-05 | `theorex prune` — archive and remove LESS nodes past threshold | SATISFIED | `runPrune()` calls `pruneAxon(AXON_PATH, ARCHIVE_DIR, config)` |

**24/24 requirements satisfied. No blocked requirements. No orphaned requirements.**

---

### Anti-Patterns Found

No anti-patterns detected in modified files (`src/cli/index.ts`, `tests/cli/cli.test.ts`):

- No TODO/FIXME/HACK/PLACEHOLDER/XXX comments
- No empty implementations
- No stub handlers
- No disk writes inside `runStatus()` (confirmed: the only `store.save()` in the file is inside `runRef()` at line 115)

---

### Human Verification Required

#### 1. PM2 Cron Scheduling

**Test:** Run `pm2 start ecosystem.config.cjs` then `pm2 list`.
**Expected:** PM2 shows `theorex-scan` with cron `0 */6 * * *` and status `online`.
**Why human:** Cannot invoke PM2 in test environment; cron scheduling is a runtime behavior.

---

### Gap Closure Summary

The single gap from the previous verification (REL-03 lazy-on-read) is now closed.

**What was done (plan 01-06):**

1. `src/cli/index.ts` now imports `compositeScore` and `classifyTier` from `../axon/scorer` (line 14 — previously not imported at all).
2. `runStatus()` captures `nowMs = Date.now()` once before the render loop, then per-node computes neighbor edge strengths, calls `compositeScore(...)`, calls `classifyTier(...)`, and renders `displayTier` instead of `attrs.relevance_tier`.
3. No disk write occurs inside `runStatus()` — the correction is display-only. The axon.json stored `relevance_tier` values remain as written by the last eager scan; only the terminal output shows the corrected tier.
4. Test 11 was added: creates a node with stored `relevance_tier: "ACTIVE"` but `last_seen` 100 days ago, asserts `runStatus()` displays `LESS`. Passes.
5. Test 4 was updated to use `Date.now() - 1 day` timestamps with `frequency_count: 20` so nodes remain genuinely ACTIVE under the new lazy recompute — the old static January/February 2026 timestamps were artifacts of pre-REL-03 code.

**Test suite:** 213 tests pass, 0 failures, 399 expect() calls (up from 207 tests / 146 expect() calls at phase start, up from 213 that already included plans 01-01 through 01-05).

All 24 Phase 1 requirements are satisfied. Phase goal achieved.

---

_Verified: 2026-03-10T12:10:00Z_
_Verifier: Claude (gsd-verifier)_
