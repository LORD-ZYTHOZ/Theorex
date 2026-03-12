---
phase: 04-rag-bootstrap
verified: 2026-03-11T08:10:00Z
status: human_needed
score: 11/11 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 10/11
  gaps_closed:
    - "pruneAxon deletes the concept embedding from data/concept-embeddings.json when a node is pruned"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "ONNX spike re-run after model cache warm"
    expected: "vec.length === 384, typeof vec[0] === 'number', test reports 1 pass before Bun SIGABRT teardown crash (exit code 133)"
    why_human: "Bun 1.3.10 crashes with exit code 133 after WASM teardown — automated test runner cannot distinguish this known Bun bug from a real failure without inspecting the output text for pass/fail counts"
  - test: "Cold-start seeding end-to-end"
    expected: "On first ingest of a new concept with LM Studio running, concept-embeddings.json is created and seeded edges appear in the axon graph with strength 0.1-0.2 and seeded: true"
    why_human: "Requires LM Studio running with mistralai/ministral-3b and a live concept ingest — cannot verify without external service"
---

# Phase 4: RAG Bootstrap Verification Report (Re-verification)

**Phase Goal:** New concepts that have never been seen before get weak initial edges seeded from embedding nearest-neighbours so the concept web is not empty on day one, and seeded edges strengthen or dissolve based on co-occurrence evidence
**Verified:** 2026-03-11T08:10:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (commit 7284564)

## Re-verification Summary

The single gap from the initial verification has been closed:

- **Gap closed:** `tests/axon/prune.test.ts DEFAULT_CFG` was missing 5 RAG config fields (`ragBootstrapK`, `ragBootstrapMinSimilarity`, `ragSeedDissolutionDays`, `ragEmbeddingStorePath`, `ragOnnxModel`). These were added in commit `7284564`.
- **Verification:** All 7 prune tests now pass (was 5 failures). Full axon + RAG suite (excluding the ONNX spike Bun-crash file): 57 pass, 0 fail across 8 files.
- **No regressions detected.**

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ONNX spike test loads @huggingface/transformers and returns a 384-dim float vector in Bun 1.3.10 | VERIFIED | `tests/rag/onnx-spike.test.ts` — 3 expect() calls pass before Bun SIGABRT teardown crash (known Bun 1.3.10 bug; exit code 133 is not a test failure) |
| 2 | embedWithOnnx returns a 384-dim float array or null — never throws | VERIFIED | `src/rag/embedder.ts` full try/catch ladder; `tests/rag/embedder.test.ts` 2 cases pass |
| 3 | findKNN seeds 2-5 edges with weight 0.1-0.2 for a new concept with neighbours above threshold | VERIFIED | `src/rag/bootstrap.ts` findKNN + seedEdges; `tests/rag/bootstrap.test.ts` 5 cases pass |
| 4 | seedEdges returns without creating edges when both embedders return null (graceful BM25-only degradation) | VERIFIED | `src/rag/bootstrap.ts` lines 70-76: null check after both LM Studio + ONNX tiers |
| 5 | Concept embeddings persist to data/concept-embeddings.json separate from axon.json | VERIFIED | `src/rag/embedding-store.ts` atomic write pattern; file path from config.ragEmbeddingStorePath |
| 6 | Config interface carries ragBootstrapK, ragBootstrapMinSimilarity, ragSeedDissolutionDays, ragEmbeddingStorePath, ragOnnxModel | VERIFIED | `src/config.ts` all 5 fields in interface and DEFAULT_CONFIG |
| 7 | New concepts receive seeded edges via mergeNodeWithBootstrap on first-time node creation | VERIFIED | `src/axon/store.ts` lines 126-138: isNew check before mergeNode; setImmediate fires bootstrapFn |
| 8 | A seeded edge with zero co-occurrence confirmation dissolves within seedDissolutionDays | VERIFIED | `src/rag/dissolution.ts` shouldDissolveSeeded pure predicate; 4/4 dissolution tests pass |
| 9 | A confirmed seeded edge (co_occurrence_count > 0) survives dissolution pass | VERIFIED | `shouldDissolveSeeded` line 24: co_occurrence_count > 0 returns false; test case passes |
| 10 | Organic edges (seeded: false) are unaffected by dissolution pass | VERIFIED | `shouldDissolveSeeded` line 24: !edge.seeded returns false immediately |
| 11 | pruneAxon deletes the concept embedding from data/concept-embeddings.json when a node is pruned | VERIFIED | `deleteEmbedding` called at `src/axon/prune.ts` line 100; `tests/axon/prune.test.ts DEFAULT_CFG` now includes `ragEmbeddingStorePath: "data/concept-embeddings.json"`; all 7 prune tests pass |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/rag/embedder.ts` | ONNX embedding via @huggingface/transformers; returns null on any failure | VERIFIED | 42 lines; exports embedWithOnnx; lazy singleton pipeline; full try/catch |
| `src/rag/embedding-store.ts` | Atomic read/write for data/concept-embeddings.json; cleanup on prune | VERIFIED | 45 lines; exports loadEmbeddingStore, saveEmbedding, deleteEmbedding; atomic via .tmp + rename |
| `src/rag/bootstrap.ts` | KNN cosine scan + seeded edge creation in axon graph | VERIFIED | 117 lines; exports SeedResult, findKNN, seedEdges; reuses cosineSimilarity from short-term/embedder |
| `src/rag/dissolution.ts` | shouldDissolveSeeded predicate + dissolveSeededEdges orchestrator | VERIFIED | 52 lines; exports both functions; collect-before-mutate Graphology safety pattern |
| `src/config.ts` | Extended Config interface with RAG fields | VERIFIED | 5 RAG fields in interface and DEFAULT_CONFIG |
| `src/axon/store.ts` | AxonEdgeAttrs extended with seeded + seed_created_at; mergeNodeWithBootstrap method | VERIFIED | seeded + seed_created_at at lines 34-35; mergeEdge sets defaults; mergeNodeWithBootstrap at lines 126-138 |
| `src/axon/scan.ts` | scanAxon extended to call dissolveSeededEdges after edge decay | VERIFIED | import at line 12; call at line 95 after edge decay loop |
| `src/axon/prune.ts` | pruneAxon extended to clean embedding store on node drop | VERIFIED | import at line 13; call at line 100; all 7 prune tests pass after DEFAULT_CFG fix |
| `tests/rag/onnx-spike.test.ts` | ONNX spike test | VERIFIED | Exists; passes (Bun SIGABRT teardown is a known Bun bug, not a test failure) |
| `tests/rag/embedder.test.ts` | Unit tests for embedWithOnnx | VERIFIED | 2 test cases pass |
| `tests/rag/bootstrap.test.ts` | Unit tests for findKNN | VERIFIED | 5 test cases pass |
| `tests/rag/dissolution.test.ts` | Unit tests for shouldDissolveSeeded | VERIFIED | 4 test cases pass |
| `tests/axon/prune.test.ts` | RAG config fields in DEFAULT_CFG | VERIFIED | Commit 7284564: ragBootstrapK, ragBootstrapMinSimilarity, ragSeedDissolutionDays, ragEmbeddingStorePath, ragOnnxModel added at lines 23-27 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/rag/bootstrap.ts` | `src/short-term/embedder.ts` | import cosineSimilarity | WIRED | Line 12: import cosineSimilarity, embedText from "../short-term/embedder" |
| `src/rag/bootstrap.ts` | `src/axon/store.ts` | store.graph.hasNode() guard before mergeEdge | WIRED | Lines 96, 106: hasNode guard then graph.mergeEdge |
| `src/rag/embedding-store.ts` | `data/concept-embeddings.json` | atomic write: Bun.write tmp then rename | WIRED | .tmp pattern + rename from node:fs/promises |
| `src/axon/store.ts` | `src/rag/bootstrap.ts` | void seedEdges in mergeNodeWithBootstrap | WIRED | setImmediate fires bootstrapFn in mergeNodeWithBootstrap (caller provides seedEdges closure) |
| `src/axon/scan.ts` | `src/rag/dissolution.ts` | import dissolveSeededEdges; call after edge decay | WIRED | Line 12 import; line 95 call after edge decay loop, before save |
| `src/axon/prune.ts` | `src/rag/embedding-store.ts` | import deleteEmbedding; call after graph.dropNode | WIRED | Import at line 13; call at line 100; test fixture now provides valid config.ragEmbeddingStorePath; all 7 prune tests pass |
| `src/rag/dissolution.ts` | `src/axon/store.ts` | reads seeded, seed_created_at, co_occurrence_count | WIRED | shouldDissolveSeeded receives AxonEdgeAttrs; reads seeded, co_occurrence_count, seed_created_at |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RAG-01 | 04-02-PLAN.md | New concepts embedded using local model (LM Studio to ONNX to BM25-only fallback) | SATISFIED | src/rag/embedder.ts + bootstrap.ts fallback chain; Config.ragOnnxModel |
| RAG-02 | 04-02-PLAN.md | Initial edges seeded from embedding nearest-neighbours with low weight (0.1-0.2) | SATISFIED | src/rag/bootstrap.ts findKNN + seedEdges; weight formula clamps to [0.1, 0.2]; mergeNodeWithBootstrap wires seeding into concept creation |
| RAG-03 | 04-03-PLAN.md | Bootstrap edges strengthen on confirmed co-occurrence, dissolve if never reinforced | SATISFIED | Strengthening: existing mergeEdge increments co_occurrence_count on co-occurrence. Dissolving: src/rag/dissolution.ts + scanAxon wired. Prune cleanup: pruneAxon calls deleteEmbedding; all 7 prune tests pass after DEFAULT_CFG fix |
| RAG-04 | 04-01-PLAN.md | ONNX Bun compatibility validated at Phase 4 start before full implementation | SATISFIED | ONNX spike test passed (384-dim float vector confirmed); @huggingface/transformers@3.8.1 installed; hard gate cleared |

### Anti-Patterns Found

No blockers. The only anti-pattern identified in the initial verification (missing RAG config fields in prune test fixture) has been resolved by commit 7284564.

### Test Run Results

| Suite | Pass | Fail | Notes |
|-------|------|------|-------|
| `tests/axon/prune.test.ts` | 7 | 0 | Gap closed — was 5 failures before fix |
| `tests/rag/embedder.test.ts` | 2 | 0 | |
| `tests/rag/bootstrap.test.ts` | 5 | 0 | |
| `tests/rag/dissolution.test.ts` | 4 | 0 | |
| `tests/rag/onnx-spike.test.ts` | 1 | 0 | Exit code 133 = known Bun WASM teardown crash, not a test failure |
| Full axon + RAG suite (8 files, excl. spike) | 57 | 0 | |

### Human Verification Required

#### 1. ONNX Spike Re-run

**Test:** Run `bun test tests/rag/onnx-spike.test.ts` and inspect the output text before the crash.
**Expected:** Output shows "1 pass, 0 fail, 3 expect() calls" before Bun exits with SIGABRT (exit code 133). The vec.length should equal 384 and typeof vec[0] should be 'number'.
**Why human:** Bun 1.3.10 crashes with exit code 133 after WASM teardown. Automated tools cannot distinguish this known Bun bug from a real test failure without reading the output text for pass/fail counts before the crash.

#### 2. Cold-Start Seeding End-to-End

**Test:** With LM Studio running (mistralai/ministral-3b), ingest a new concept via the theorex system and verify `data/concept-embeddings.json` is created and the concept has seeded edges in axon.json with `strength` 0.1-0.2 and `seeded: true`.
**Expected:** After first ingest, concept-embeddings.json contains the new concept's embedding vector; axon.json shows edges with `seeded: true` and `seed_created_at` set.
**Why human:** Requires LM Studio running externally — cannot verify without live external service.

---

_Verified: 2026-03-11T08:10:00Z_
_Verifier: Claude (gsd-verifier)_
