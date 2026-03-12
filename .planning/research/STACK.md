# Technology Stack

**Project:** Theorex — AI Cognitive Memory Architecture
**Researched:** 2026-03-10
**Overall confidence:** MEDIUM-HIGH (all critical choices verified against npm, official docs, and official runtime docs)

---

## Recommended Stack

### Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun | 1.3.7+ | Runtime, package manager, test runner, bundler | Native JSONL API (Bun.JSONL), 3x faster file I/O than Node.js, built-in TypeScript, single binary — matches project constraint. No Node.js migration needed. |

**Bun version note:** v1.3.7 introduced `Bun.JSONL.parse()` and `Bun.JSONL.parseChunk()` (streaming). These are core to the short-term lobe. Require >= 1.3.7. Confidence: HIGH (official Bun release blog confirmed).

---

### Concept Graph

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| graphology | 0.26.0 | In-memory weighted directed/mixed graph | 811k weekly downloads, full TypeScript types, supports mixed graphs (directed + undirected), weighted edges natively, full standard library of algorithms. Pure JS — no native bindings, Bun-compatible. |
| graphology-metrics | (peer) | PageRank, centrality, node/edge metrics | Includes weighted PageRank via `getEdgeWeight` parameter — exactly what cross-pollination activation propagation needs. |
| graphology-traversal | (peer) | BFS/DFS traversal | Needed for activation propagation spread through neighbor nodes. |
| graphology-shortest-path | (peer) | Dijkstra weighted shortest path | Relevance path finding from activated node to neighbors. |
| graphology-gexf | (peer) | GEXF serialization (optional persistence) | If graph persistence is needed beyond JSON — skip for v1, keep as option. |

**Why graphology over alternatives:**
- Cytoscape.js: Browser-focused, visualization-heavy, excess baggage for a CLI/daemon tool
- graph-data-structure: Too minimal — no weighted algorithms, no traversal library
- ngraph.graph: Faster but no standard algorithm library; you would rebuild what graphology ships
- Raw adjacency map in plain JS: Viable for graph storage, but then you hand-roll PageRank, BFS, centrality — not worth it given graphology's library

**Bun compatibility:** graphology is pure JavaScript with no native bindings. Confirmed compatible. Confidence: HIGH.

**Storage format for the Axon neural map:** Serialize graphology's `Graph` instance to/from JSON using `graphology-serialization` (ships with graphology). Store as `axon-map.json`. Load into memory on startup; write on significant change + session end. Do NOT write on every edge update — batch writes.

---

### BM25 Full-Text Search (Short-Term Lobe)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| wink-bm25-text-search | latest | BM25 index for JSONL session log search | Part of winkJS ecosystem, field-weighted documents, NLP preprocessing pipeline (stop words, stemming, negation) built in. Short-term lobe entries are structured JSON — field weighting is useful (concept_name vs story_text should score differently). |

**Why wink-bm25-text-search over OkapiBM25:**
- OkapiBM25 (111k downloads/year): Simpler API, good for homogeneous plain-text. No field weighting.
- wink-bm25-text-search: Accepts structured JSON documents, allows different weights per field, includes NLP preprocessing. Short-term lobe stores structured entries (concept, story, tier, session_id) — field weighting is directly useful.
- Trade-off: wink-bm25 requires `wink-nlp` as a peer for full preprocessing. If that peer is heavy, use OkapiBM25 with pre-tokenized text. Verify at implementation time.

**BM25 as fallback:** When LM Studio embeddings are unavailable (model not running), BM25 is the sole search path. It must be capable of standalone retrieval. wink-bm25 is sufficient for this role. Confidence: MEDIUM (based on npm research, not benchmarked on this data shape).

---

### Local Embeddings

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @huggingface/transformers | 3.x (latest) | Local ONNX embedding pipeline | Runs `all-MiniLM-L6-v2` ONNX model locally with no internet. Explicit Bun support in v3 examples repo. Auto-detects runtime, loads correct ONNX backend. |
| Xenova/all-MiniLM-L6-v2 | (model weights) | Embedding model — 384 dimensions | Fastest proven ONNX model for sentence embeddings: 22MB, 384-dim, well-benchmarked, available via Hugging Face with ONNX weights pre-converted. |
| LM Studio REST API | OpenAI-compat v1 | Primary embedding path (Ministral-3B) | `POST http://localhost:1234/v1/embeddings` — OpenAI-compatible. When LM Studio is running, prefer it (uses Ministral-3B already loaded in the AI ecosystem). Falls back to @huggingface/transformers when unavailable. |

**Embedding strategy:**
```
1. Try: POST http://localhost:1234/v1/embeddings (LM Studio — Ministral-3B)
2. On failure/timeout: @huggingface/transformers pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
3. On ONNX unavailable: BM25-only mode — no vector search, no edge seeding
```

**Why not onnxruntime-node directly:** @huggingface/transformers wraps ONNX runtime with tokenizer handling, pooling, and normalization baked in. Writing this manually is redundant.

**Bun + ONNX concern:** `onnxruntime-node` uses native C++ bindings which can fail in Bun. `@huggingface/transformers` v3 selects its backend automatically and has documented Bun examples. If native ONNX bindings fail in Bun, use the `onnxruntime-web` backend (WASM-based, slower but pure JS). Set `env.backends.onnx.wasm.wasmPaths` explicitly. Confidence: MEDIUM — Bun ONNX support is not 100% guaranteed for every model; test at Phase 4 (RAG bootstrap).

**Dimension:** 384 floats per concept. For a graph with 10,000 nodes, that is 10,000 x 384 x 4 bytes = ~15MB in memory. Acceptable on 64GB M4 Pro. Do not store vectors in the graph itself — keep a parallel flat `Float32Array[]` keyed by concept ID.

**Vector similarity:** Dot product on pre-normalized vectors (equivalent to cosine similarity but faster — no length recomputation). Implement as a 30-line utility, no library needed. For >50k concepts, evaluate `usearch` or `hnswlib-node` as HNSW index. For v1 at <10k concepts, flat scan is fine.

---

### NLP / Concept Extraction (Significance Engine)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| compromise | 14.x | Noun/concept extraction, POS tagging | 100% pure JavaScript, no native deps, works in Bun. Lightweight (not a heavy NLP framework). Named entity recognition, noun group extraction, verb phrases. English-only — acceptable for this use case. |

**What compromise does for Theorex:**
- Extract candidate concepts from text: noun phrases → concept candidates
- POS tagging helps distinguish concept words from filler
- Entity detection: persons, places, orgs, dates — useful for moment nodes

**What compromise does NOT do for you:**
- Does not assign importance — that is the significance engine's job
- Does not collapse synonyms — that is Theorex's synonym registry (custom code)
- Does not score concepts — that is weighted BM25 + frequency logic

**Why not nlp.js:** Heavier dependency tree (40 language models, classifier training). Overkill — Theorex needs extraction, not classification.

**Why not natural (npm):** Good stemming, but less ergonomic for noun phrase chunking. Compromise is more developer-friendly for concept extraction use cases.

---

### File I/O and Storage

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun.file() | native | Read/write all files | Bun's native file API — 2.5x faster than Node.js fs.readFile. No npm dependency. |
| Bun.JSONL | 1.3.7+ native | JSONL parse/stringify | Built into Bun — `Bun.JSONL.parse(text)` for full log, `Bun.JSONL.parseChunk()` for streaming. No library needed. |
| Bun.write() | native | Atomic file writes | Bun.write() is atomic on POSIX systems — important for MEMORY.md round-trips and JSONL append safety. |

**Storage layout (prescribed):**
```
~/.theorex/
  axon-map.json          — graphology graph serialization (concept web)
  axon-meta.json         — node/edge metadata (tiers, sentiment, moment flags)
  sessions/
    {date}-{session}.jsonl  — per-session short-term JSONL (14-day rolling)
  moments/
    moment_{id}.json     — permanent moment nodes, never pruned
  flash/
    flash-{session}.json — per-session ring buffer (cleared on session end)

~/.claude/projects/-Users-eoh/memory/
  MEMORY.md              — long-term, human/AI readable (must round-trip faithfully)
  .theorex-meta.json     — classification metadata for MEMORY.md entries
```

**JSONL append pattern:** Never load full JSONL to append. Use `Bun.file().stream()` + append mode or write-position tracking. Short-term lobe entries are append-only during session, read-only during search.

---

### Claude Code Hooks Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Claude Code hooks (JSON) | current | Flash lobe event capture | `~/.claude/settings.json` hooks array — `PostToolUse` records tool events, `Stop` flushes flash to short-term. No library needed — hooks are shell commands calling Theorex CLI. |

**Hook pattern:**
```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "theorex flash record --event postToolUse --tool $TOOL_NAME" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "theorex flash flush" }] }]
  }
}
```

Hooks are additive — do not modify existing hooks, append to the array.

---

### CLI Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun's built-in arg parsing | native | CLI argument parsing | For a project of this scope, Bun's `process.argv` + a thin hand-rolled router (50 lines) is sufficient. No `commander` or `yargs` needed — adds 50kb for functionality Theorex doesn't need. |

**CLI surface (from PROJECT.md):** `theorex scan`, `status`, `search`, `ref`, `prune`, `graduate`. Six commands — implement as a simple subcommand dispatch map, not a full CLI framework.

---

### Process Management

| Technology | Purpose | Why |
|------------|---------|-----|
| PM2 (existing) | Periodic maintenance tasks | Already in the AI ecosystem. Use for `theorex prune` + `theorex graduate` every 6 hours. No new dependency. |

---

## Alternatives Considered and Rejected

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Graph | graphology | Cytoscape.js | Browser visualization focus; huge bundle; no headless CLI suitability |
| Graph | graphology | Neo4j / ArangoDB | Violates no-database constraint; external process; overkill |
| Graph | graphology | Hand-rolled adjacency map | No algorithm library; must rebuild PageRank, BFS — unnecessary |
| BM25 | wink-bm25-text-search | OkapiBM25 | No field weighting; structured entries need per-field scoring |
| BM25 | wink-bm25-text-search | Elasticsearch / Typesense | Violates no-database, no-process constraints |
| Embeddings | @huggingface/transformers | fastembed (Python) | Python, not Bun; cross-process IPC adds latency |
| Embeddings | @huggingface/transformers | openai.embeddings | Violates no-cloud-API constraint |
| Embeddings | Xenova/all-MiniLM-L6-v2 | larger SBERT models | 384-dim is sufficient for concept-space proximity; larger models add latency without meaningful benefit at this scale |
| NLP | compromise | nlp.js | 40-language training data; overkill; slower startup |
| NLP | compromise | spaCy (Python) | Wrong language; cross-process IPC complexity |
| JSONL | Bun.JSONL (native) | `jsonl` npm package | Bun has built-in JSONL since 1.3.7; no external dep needed |
| CLI | Hand-rolled | commander.js / yargs | 6 subcommands do not justify a CLI framework dependency |
| Vector index | Flat scan (custom) | hnswlib-node | HNSW is overkill at <10k concepts; flat O(n) scan on 384-dim is <50ms for 10k entries on M4 Pro |
| Runtime | Bun | Node.js | Bun constraint set by project; native JSONL API clinches it |
| Storage | JSON/JSONL files | SQLite (better-sqlite3) | Violates no-database constraint; files are inspectable and versionable |

---

## Installation

```bash
# Core graph library
bun add graphology graphology-metrics graphology-traversal graphology-shortest-path

# BM25 search
bun add wink-bm25-text-search wink-nlp wink-eng-lite-web-model

# Local embeddings (fallback path)
bun add @huggingface/transformers

# NLP / concept extraction
bun add compromise

# Dev dependencies
bun add -d typescript @types/bun
```

**Note on @huggingface/transformers ONNX backend in Bun:** If native `onnxruntime-node` bindings fail at install or runtime, set the ONNX backend to WASM:

```typescript
import { env } from "@huggingface/transformers";
env.backends.onnx.wasm.wasmPaths = "./node_modules/onnxruntime-web/dist/";
```

WASM is ~3x slower than native ONNX for embedding, but still local and still acceptable for a cold-start seeding operation that runs infrequently.

---

## Bun Compatibility Matrix

| Package | Native Bindings? | Bun Compatible | Confidence | Notes |
|---------|-----------------|----------------|------------|-------|
| graphology | No (pure JS) | Yes | HIGH | Pure JS, no C++ |
| wink-bm25-text-search | No (pure JS) | Yes | HIGH | Pure JS NLP |
| @huggingface/transformers | Yes (ONNX) | LIKELY | MEDIUM | v3 has Bun examples; WASM fallback if native fails |
| compromise | No (pure JS) | Yes | HIGH | Pure JS, browser+Node |
| Bun.JSONL | Native (Bun) | Yes | HIGH | Bun built-in |
| PM2 | N/A (external) | N/A | HIGH | Process manager, not a Bun dep |

---

## Key Architecture Decisions Implicit in Stack

1. **No vector database.** Embedding vectors live in a parallel `Float32Array[]` keyed by concept numeric ID. Similarity is flat cosine scan. At <10k concepts this is fast. Graph serialization to `axon-map.json` is separate from vector storage (`axon-vectors.bin` — raw Float32Array written with `Bun.write`).

2. **No ORM, no schema library.** JSONL entries are plain TypeScript interfaces, validated at system boundary with hand-rolled type guards (not zod — avoid the dependency). This is a single-author internal system, not a multi-team API surface.

3. **Embeddings are optional infrastructure.** The system must be fully operational with BM25-only search. Vector search enriches results; it is not the primary path.

4. **Graphology graph is always in memory.** Load once at startup, write on change. Never query from disk mid-session. This works because the graph at 10k nodes with metadata is <5MB — trivial on 64GB M4 Pro.

5. **Flash lobe has no npm dependencies at all.** It is a plain JSON file written by hook shell commands. Zero library surface for the always-on, per-session path.

---

## Sources

- Bun v1.3.7 release blog (Bun.JSONL): https://bun.com/blog/bun-v1.3.7
- Bun file I/O docs: https://bun.com/docs/runtime/file-io
- Bun Node.js compatibility tracker: https://bun.com/docs/runtime/nodejs-compat
- graphology npm (0.26.0, 811k weekly downloads): https://www.npmjs.com/package/graphology
- graphology standard library (metrics, pagerank, traversal): https://graphology.github.io/standard-library/
- wink-bm25-text-search GitHub: https://github.com/winkjs/wink-bm25-text-search
- OkapiBM25 GitHub: https://github.com/FurkanToprak/OkapiBM25
- @huggingface/transformers v3 (Bun support): https://huggingface.co/blog/transformersjs-v3
- Xenova/all-MiniLM-L6-v2 (ONNX weights): https://huggingface.co/Xenova/all-MiniLM-L6-v2
- LM Studio embeddings endpoint: https://lmstudio.ai/docs/developer/openai-compat/embeddings
- compromise npm: https://github.com/spencermountain/compromise
- fast-cosine-similarity npm: https://www.npmjs.com/package/fast-cosine-similarity
