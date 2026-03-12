# Phase 4: RAG Bootstrap - Research

**Researched:** 2026-03-11
**Domain:** Local ONNX embeddings in Bun + graph cold-start seeding + bootstrap edge lifecycle
**Confidence:** MEDIUM (ONNX/Bun compatibility is the known risk; all other domains are HIGH)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RAG-01 | New concepts embedded using local model: LM Studio → HuggingFace ONNX → BM25-only fallback | Embedder cascade architecture; existing `embedder.ts` pattern extended to ONNX tier |
| RAG-02 | Initial edges seeded from embedding nearest-neighbours with low weight (0.1–0.2) | KNN cosine similarity over concept embeddings; seeded edge type distinct from co-occurrence edges |
| RAG-03 | Bootstrap edges strengthen on confirmed co-occurrence, dissolve if never reinforced | `mergeEdge()` already increments co_occurrence_count; seeded vs organic flag controls dissolution path |
| RAG-04 | ONNX Bun compatibility validated at Phase 4 start before full implementation | Spike test must pass before any bootstrap code written — hard gate per STATE.md decision |
</phase_requirements>

---

## Summary

Phase 4 adds a cold-start mechanism to the concept web: when a brand-new concept arrives with zero co-occurrence history, it receives 2–5 weak seeded edges pointing to its nearest-neighbour concepts (by embedding cosine similarity). These seeded edges then live or die based on whether real co-occurrence events ever reinforce them.

The hardest technical question is whether `@huggingface/transformers` works in Bun without breaking the existing `onnxruntime-node` native bindings. Evidence from the official Transformers.js v3 release and HuggingFace examples shows Bun is explicitly supported and a Bun example exists in the transformers.js-examples repo. However, earlier issues (GitHub #558, now closed) documented native-binding registration failures on Apple M1, and a September 2025 enhancement request (GitHub #1406, now resolved in v4) shows continued friction. The Phase 4 design must treat this as an empirical question: run the ONNX spike first, then proceed only if it passes.

The embedding fallback chain (`LM Studio → ONNX → BM25-only`) already exists in `src/short-term/embedder.ts`. Phase 4 extends this chain to a new `src/rag/embedder.ts` that uses `@huggingface/transformers` as the middle tier. The bootstrap seeding algorithm itself is simple: embed the new concept label, compute cosine similarity against all stored concept embeddings, take the top-K results (filtered by minimum similarity threshold), and create `seeded` edges at initial weight 0.1–0.2. These edges carry a `seeded: true` flag so the decay scan can treat them differently — they dissolve faster when `co_occurrence_count === 0` than organically-formed edges.

**Primary recommendation:** Ship Phase 4 in three atomic plans: (1) ONNX spike pass/fail gate, (2) embedding store + bootstrap seeder, (3) dissolution lifecycle integration into existing scan pass. Gate plan 2 on plan 1 passing.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@huggingface/transformers` | ^3.x (latest: 3.6.x as of March 2026) | Local ONNX embedding via `feature-extraction` pipeline | Official HuggingFace library; v3 adds explicit Bun support; uses `onnxruntime-node` auto-selected for Bun/Node |
| `graphology` | ^0.26.0 (already installed) | Graph mutations for seeded edges | Already the project graph library; `mergeEdge()` pattern established |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `onnxruntime-node` | Installed transitively by `@huggingface/transformers` | Native ONNX execution in Bun | Auto-selected when Bun IS_NODE_ENV is true |
| `onnxruntime-web` | Installed transitively | WASM fallback if native fails | If ONNX spike reveals native bindings fail on M4, force WASM backend with `env.backends.onnx.wasm.*` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@huggingface/transformers` ONNX | Continue using LM Studio only | Already exists — but LM Studio may not be running; need offline ONNX tier |
| `@huggingface/transformers` ONNX | Raw `onnxruntime-node` + local ONNX model file | More control but requires manual model download, tokenizer, preprocessing — not worth the complexity |
| cosine similarity K-NN scan | HNSW approximate search library | Total concept count stays small (<10k in v1); linear scan with cosine is simpler and sufficient |
| `seeded: true` flag on edge | Separate edge type table | Flag on existing AxonEdgeAttrs is simpler; avoids schema change |

**Installation:**
```bash
bun add @huggingface/transformers
```

Note: `onnxruntime-node` installs transitively. Verify with `bun pm ls | grep onnx`.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── rag/
│   ├── embedder.ts       # ONNX embedding tier (wraps @huggingface/transformers)
│   ├── bootstrap.ts      # seedEdges(): embed concept, find KNN, create seeded edges
│   └── dissolution.ts    # dissolveSeeded(): called from scanAxon to drop unreinforced seeds
├── axon/
│   ├── store.ts          # Add seeded: boolean to AxonEdgeAttrs
│   ├── scan.ts           # Call dissolveSeeded() after edge decay pass
│   └── ...               # (existing files unchanged)
└── ...
tests/
├── rag/
│   ├── embedder.test.ts  # Unit: ONNX spike test (mock fallback); integration: real model (skip in CI)
│   ├── bootstrap.test.ts # Unit: seedEdges with mock embedder
│   └── dissolution.test.ts # Unit: seeded edge dissolves, organic edge survives
```

### Pattern 1: ONNX Embedding via Transformers.js (Bun)

**What:** Use `@huggingface/transformers` `feature-extraction` pipeline; Bun auto-selects `onnxruntime-node` backend.
**When to use:** When LM Studio is unavailable; produce embedding for single concept label string.

```typescript
// Source: https://huggingface.co/docs/transformers.js/en/api/env
// Source: https://huggingface.co/blog/transformersjs-v3
import { pipeline, env } from "@huggingface/transformers";

// Configure for local-only operation after first download
env.cacheDir = "./.cache/onnx-models";
// allowRemoteModels defaults to true; set false only after initial download

const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2", // 384d, 22MB quantized ONNX
  { device: "cpu" }           // explicit CPU; no GPU assumption on CI
);

export async function embedConcept(text: string): Promise<number[] | null> {
  try {
    const output = await extractor([text], { pooling: "mean", normalize: true });
    return Array.from(output.tolist()[0] as number[]);
  } catch {
    return null; // signals BM25-only fallback
  }
}
```

### Pattern 2: Embedding Store — Persisting Concept Vectors

**What:** Store concept embeddings in a separate flat-file map so they can be loaded for KNN without re-embedding everything on each run.
**When to use:** On concept creation; read on bootstrap seeding.

```typescript
// src/rag/embedding-store.ts
// Store: data/concept-embeddings.json
// Shape: Record<string, number[]>  // key = String(concept_id), value = embedding vector
// Rationale: separate from axon.json (avoid bloating the main graph file)

export async function saveEmbedding(
  storePath: string,
  conceptId: number,
  vector: number[]
): Promise<void> {
  const store = await loadEmbeddingStore(storePath);
  const updated = { ...store, [String(conceptId)]: vector };
  const tmp = storePath + ".tmp";
  await Bun.write(tmp, JSON.stringify(updated));
  await rename(tmp, storePath);
}
```

### Pattern 3: KNN Seeding — Find Nearest Neighbours and Seed Edges

**What:** On new concept addition, embed its label, compute cosine similarity against all stored embeddings, take top-K above threshold, create seeded edges at weight 0.15.
**When to use:** Called from `mergeNode()` on first-time concept creation (new node path only).

```typescript
// src/rag/bootstrap.ts
import { cosineSimilarity } from "../short-term/embedder"; // reuse existing fn

export interface SeedResult {
  targetConceptId: number;
  similarity: number;
  edgeWeight: number; // 0.1–0.2
}

export async function findKNN(
  newVector: number[],
  embeddingStore: Record<string, number[]>,
  excludeConceptId: number,
  k = 5,
  minSimilarity = 0.4
): Promise<SeedResult[]> {
  const scored = Object.entries(embeddingStore)
    .filter(([id]) => Number(id) !== excludeConceptId)
    .map(([id, vec]) => ({
      targetConceptId: Number(id),
      similarity: cosineSimilarity(newVector, vec),
    }))
    .filter(({ similarity }) => similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  return scored.map(({ targetConceptId, similarity }) => ({
    targetConceptId,
    similarity,
    edgeWeight: 0.1 + (similarity - minSimilarity) * 0.2, // scale 0.1–0.2
  }));
}
```

### Pattern 4: Seeded Edge — AxonEdgeAttrs Extension

**What:** Add `seeded: boolean` and `seed_co_occurrence_count: number` to track whether co-occurrence has ever confirmed the edge.
**When to use:** On edge creation by bootstrap; read by dissolution pass.

```typescript
// Extension to src/axon/store.ts
export interface AxonEdgeAttrs {
  strength: number;
  co_occurrence_count: number;
  last_co_occurrence: string;
  seeded: boolean;                // true = created by RAG bootstrap, not organic co-occurrence
  seed_created_at: string;        // ISO 8601 — for dissolution age check
}
```

### Pattern 5: Dissolution — Seeded Edges Age Out

**What:** During the scan pass, seeded edges with `co_occurrence_count === 0` and age > `seedDissolutionDays` drop below prune threshold. Organic edges follow normal decay.
**When to use:** Called inside `scanAxon()` after the existing edge decay loop.

```typescript
// src/rag/dissolution.ts
// A seeded edge with zero reinforcement is dropped when:
//   age > seedDissolutionDays  (config, default: 7)
// This is faster than organic decay (halfLife 14 days) to prevent graph pollution.

export function shouldDissolveSeeded(
  edge: AxonEdgeAttrs,
  nowMs: number,
  seedDissolutionDays: number
): boolean {
  if (!edge.seeded || edge.co_occurrence_count > 0) return false;
  const ageMs = nowMs - new Date(edge.seed_created_at).getTime();
  return ageMs > seedDissolutionDays * 86_400_000;
}
```

### Anti-Patterns to Avoid

- **Embedding every existing concept on bootstrap start:** Only embed the new concept at creation time. Query against stored vectors. Never re-embed on startup.
- **Storing embeddings inside axon.json:** Embedding vectors are large (384 floats = ~3KB per node). Keep them in a separate `data/concept-embeddings.json` file.
- **Seeding edges to concepts in LESS tier:** Filter KNN results to only seed edges to ACTIVE or MILD nodes. LESS nodes are on their way out — seeding to them is graph pollution.
- **Using `similarity` directly as `edgeWeight`:** Cosine similarity 0.9 is NOT the same as edge strength 0.9 in the co-occurrence model. Map similarity to the seeded weight range (0.1–0.2) explicitly.
- **Mutating AxonEdgeAttrs in forEachEdge loop:** Already caught in Phase 1 — always collect keys first, mutate after. Pattern applies to dissolution pass too.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text embedding | Custom tokenizer + ONNX model loader + preprocessing | `@huggingface/transformers` `pipeline("feature-extraction")` | Tokenization is model-specific and subtle; pipeline handles it correctly |
| Cosine similarity | New implementation | `cosineSimilarity()` in `src/short-term/embedder.ts` | Already exists, already tested, handles zero-vector edge case |
| K-NN brute-force for v1 scale | Custom HNSW index | Linear scan with cosine | Concept count will never reach 10k in v1; HNSW adds complexity without benefit at this scale |
| Model file management | Manual ONNX file download scripts | Transformers.js auto-caching to `env.cacheDir` | First run downloads; subsequent runs use cache; no download logic needed |

**Key insight:** The embedding layer is solved — the only new work is: (1) ONNX spike to confirm it works in Bun, (2) a small `src/rag/` module for bootstrap seeding, and (3) seeded edge lifecycle integration into the existing scan pass.

---

## Common Pitfalls

### Pitfall 1: ONNX Native Binding Failure on Apple Silicon
**What goes wrong:** `onnxruntime-node` pre-built binaries fail to self-register in Bun on M4. Error: "Module did not self-register."
**Why it happens:** Bun's Node-API compatibility is ~34%; some native addons depend on internal Node.js bindings that Bun does not fully implement.
**How to avoid:** Run the ONNX spike test FIRST (RAG-04). If it fails, fall back to `onnxruntime-web` WASM backend by setting `env.backends.onnx.wasm.numThreads = 1` and NOT installing `onnxruntime-node`.
**Warning signs:** Import error mentioning `.node` file; process exit without clear message.

**Spike test structure:**
```typescript
// tests/rag/onnx-spike.test.ts
import { test, expect } from "bun:test";

test("ONNX spike: @huggingface/transformers loads and embeds in Bun", async () => {
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "cpu" });
  const out = await extractor(["hello world"], { pooling: "mean", normalize: true });
  const vec = out.tolist()[0] as number[];
  expect(vec).toHaveLength(384);
  expect(typeof vec[0]).toBe("number");
}, 60_000); // first run downloads model; allow generous timeout
```

### Pitfall 2: Embedding Store Grows Without Bound
**What goes wrong:** `data/concept-embeddings.json` accumulates entries for pruned concepts, growing indefinitely.
**Why it happens:** pruneAxon drops nodes from axon.json but has no knowledge of the embedding store.
**How to avoid:** Add a cleanup step in `pruneAxon` — after dropping a node, also delete its entry from the embedding store. Or: load the embedding store, diff against current node IDs, write cleaned version.
**Warning signs:** `concept-embeddings.json` larger than axon.json after long runs.

### Pitfall 3: Seeded Edges Polluting the Graph
**What goes wrong:** Every new concept seeds 5 edges. After many concepts, the graph has thousands of low-quality seeded edges that never dissolve because the dissolution check is skipped or misconfigured.
**Why it happens:** Default `seedDissolutionDays` set too high, or dissolution check not wired into scanAxon.
**How to avoid:** Default `seedDissolutionDays: 7` (half the normal 14-day half-life). Wire dissolution into scanAxon immediately. Test that after 8 days with zero co-occurrence, seeded edges are gone.
**Warning signs:** `theorex status` shows many LESS-tier nodes still connected by edges.

### Pitfall 4: Seeding to Concepts That Don't Exist in the Graph Yet
**What goes wrong:** KNN returns concept IDs that are in the embedding store but have already been pruned from axon.json. `mergeEdge()` requires both nodes to exist.
**Why it happens:** Embedding store and axon.json get out of sync (pitfall 2 above).
**How to avoid:** Before creating a seeded edge, call `store.graph.hasNode(String(targetId))`. Skip targets that no longer exist.
**Warning signs:** Runtime error: "Node not found: <id>" from Graphology.

### Pitfall 5: Spike Test Downloads 100MB on First Run in CI
**What goes wrong:** `Xenova/all-MiniLM-L6-v2` is ~22MB quantized, but network conditions in CI make the spike test flaky or extremely slow.
**Why it happens:** First pipeline() call downloads the model from HuggingFace CDN.
**How to avoid:** The spike test is integration-only and tagged to run locally, not in the standard `bun test` suite. Use `bun test --test-name-pattern "ONNX spike"` only for explicit spike validation. The unit tests for bootstrap and dissolution use a mock embedder that returns a fixed vector.
**Warning signs:** CI timeouts on the ONNX spike test.

### Pitfall 6: model `tolist()` Returns Nested Array
**What goes wrong:** `extractor(["hello world"], { pooling: "mean", normalize: true }).tolist()` returns `[[...]]` (array of arrays), not `[...]`.
**Why it happens:** The pipeline batches input — one array per input text.
**How to avoid:** Always index `[0]`: `output.tolist()[0] as number[]`. Already shown in the code example above.
**Warning signs:** `vec.length === 1` and `vec[0]` is an array, not a number.

---

## Code Examples

### Full ONNX Embedder with LM Studio Primary + ONNX Fallback

```typescript
// src/rag/embedder.ts
// Source pattern: https://huggingface.co/docs/transformers.js/en/api/env
// Tier 1: LM Studio HTTP (already in src/short-term/embedder.ts — reuse)
// Tier 2: @huggingface/transformers ONNX (this file)
// Tier 3: null → caller falls back to BM25-only (no seeding)

import { env } from "@huggingface/transformers";

env.cacheDir = "./.cache/onnx-models"; // project-local cache

let _pipeline: ((texts: string[], opts: object) => Promise<{ tolist: () => unknown[][] }>) | null = null;

async function getOnnxPipeline() {
  if (_pipeline !== null) return _pipeline;
  try {
    const { pipeline } = await import("@huggingface/transformers");
    _pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "cpu" }) as typeof _pipeline;
    return _pipeline;
  } catch {
    return null; // ONNX unavailable
  }
}

export async function embedWithOnnx(text: string): Promise<number[] | null> {
  const pipe = await getOnnxPipeline();
  if (!pipe) return null;
  try {
    const out = await pipe([text], { pooling: "mean", normalize: true });
    return out.tolist()[0] as number[];
  } catch {
    return null;
  }
}
```

### Wiring Bootstrap into Concept Upsert

```typescript
// In src/axon/store.ts — mergeNode extended with RAG bootstrap hook
// The bootstrap is fire-and-forget (non-blocking) — does NOT await

mergeNodeWithBootstrap(event: ConceptEvent, bootstrapFn?: (conceptId: number, label: string) => void): string {
  const isNew = !this._graph.hasNode(String(event.concept_id));
  const key = this.mergeNode(event); // existing method unchanged

  if (isNew && bootstrapFn) {
    // Non-blocking: seeding is best-effort, does not block the concept upsert
    setImmediate(() => bootstrapFn(event.concept_id, event.surface_form));
  }

  return key;
}
```

### Config Extension for Phase 4

```typescript
// Additions to src/config.ts
export interface Config {
  // ... existing fields ...

  // Phase 4: RAG Bootstrap
  ragBootstrapK: number;               // default: 5  — max seeded edges per new concept
  ragBootstrapMinSimilarity: number;   // default: 0.4 — min cosine similarity to seed
  ragSeedDissolutionDays: number;      // default: 7  — days before unreinforced seed dissolves
  ragEmbeddingStorePath: string;       // default: "data/concept-embeddings.json"
  ragOnnxModel: string;                // default: "Xenova/all-MiniLM-L6-v2"
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@xenova/transformers` (v2) | `@huggingface/transformers` (v3+) | Oct 2024 (v3.0.0) | Package renamed; both work, but new installs should use the HuggingFace org namespace |
| onnxruntime-web only | Auto-select onnxruntime-node for Bun/Node | v3.0.0 Oct 2024 | Bun gets native-speed inference instead of WASM |
| Manual WASM path setup | `env.cacheDir` + auto-download + cache | v3.x | Models cached automatically; no manual file management |

**Deprecated/outdated:**
- `@xenova/transformers`: Replaced by `@huggingface/transformers`. Do not use the old package name for new installs.
- Setting `env.backends.onnx.wasm.wasmPaths` manually: Only needed if the spike confirms native bindings fail and WASM fallback must be forced.

---

## Open Questions

1. **Does `onnxruntime-node` native binding self-register correctly in Bun 1.3.10 on Apple M4?**
   - What we know: Bun has explicit `IS_NODE_ENV` detection in transformers.js v3; official examples exist; an older issue (#558) was closed as resolved
   - What's unclear: Whether M4 native binary (arm64) builds correctly; whether Bun's process.binding gaps affect onnxruntime-node specifically
   - Recommendation: Run the spike test (RAG-04) immediately as Wave 0 of Phase 4. This is the hard gate per STATE.md decision.

2. **Should seeded edge dissolution share config with organic edge decay (halfLifeDays)?**
   - What we know: Seeded edges have no co-occurrence evidence; they should dissolve faster than organic edges
   - What's unclear: Optimal `seedDissolutionDays` value — 7 days is a reasonable default but may need tuning
   - Recommendation: Use `ragSeedDissolutionDays: 7` as default; make it configurable so it can be adjusted after observing live graph behavior.

3. **How many concepts will realistically exist at bootstrap time (concept count affects KNN cost)?**
   - What we know: Phase 1 loads from MEMORY.md; early sessions may have 10–100 concepts; mature sessions may reach 1000+
   - What's unclear: At what concept count does linear KNN become perceptibly slow?
   - Recommendation: Linear scan is fine for v1. At 1000 concepts, 1000 × 384-dim cosine similarities takes <5ms in Bun. No HNSW needed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none — bun test discovers *.test.ts automatically |
| Quick run command | `bun test tests/rag/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RAG-04 | ONNX spike: transformers.js loads and embeds in Bun | integration (spike) | `bun test --test-name-pattern "ONNX spike" tests/rag/onnx-spike.test.ts` | ❌ Wave 0 |
| RAG-01 | embedWithOnnx returns float[] on success, null on failure | unit | `bun test tests/rag/embedder.test.ts` | ❌ Wave 0 |
| RAG-02 | findKNN returns 2–5 seeded edges with weight 0.1–0.2 for new concept with neighbours | unit | `bun test tests/rag/bootstrap.test.ts` | ❌ Wave 0 |
| RAG-02 | No seeded edges created when embedder returns null (BM25-only fallback) | unit | `bun test tests/rag/bootstrap.test.ts` | ❌ Wave 0 |
| RAG-03 | seeded edge with co_occurrence_count > 0 survives dissolution pass | unit | `bun test tests/rag/dissolution.test.ts` | ❌ Wave 0 |
| RAG-03 | seeded edge with co_occurrence_count === 0 and age > seedDissolutionDays is dropped | unit | `bun test tests/rag/dissolution.test.ts` | ❌ Wave 0 |
| RAG-03 | organic edge (seeded: false) is NOT affected by dissolution pass | unit | `bun test tests/rag/dissolution.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test tests/rag/`
- **Per wave merge:** `bun test` (full 297+ test suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/rag/onnx-spike.test.ts` — covers RAG-04 (integration, run locally only)
- [ ] `tests/rag/embedder.test.ts` — covers RAG-01 (unit with mock)
- [ ] `tests/rag/bootstrap.test.ts` — covers RAG-02 (unit with fixed vectors)
- [ ] `tests/rag/dissolution.test.ts` — covers RAG-03 (unit with seeded/organic edges)

---

## Sources

### Primary (HIGH confidence)
- `https://huggingface.co/docs/transformers.js/en/api/env` — env configuration (localModelPath, allowRemoteModels, cacheDir, IS_NODE_ENV confirming Bun is Node-like)
- `https://huggingface.co/blog/transformersjs-v3` — v3.0.0 release: explicit Bun support, `@huggingface/transformers` package name, `onnxruntime-node` auto-selection for Bun
- `https://github.com/huggingface/transformers.js-examples/tree/main/bun` — official HuggingFace Bun example repo (confirmed exists)
- `https://deepwiki.com/huggingface/transformers.js/8.2-backend-architecture` — backend selection: Bun uses `onnxruntime-node` (same as Node.js)
- `/Users/eoh/theorex/src/axon/store.ts` — AxonEdgeAttrs, mergeEdge, Graphology mutation patterns
- `/Users/eoh/theorex/src/axon/scan.ts` — existing edge decay pattern; dissolution integrates here
- `/Users/eoh/theorex/src/short-term/embedder.ts` — cosineSimilarity function (reuse in RAG KNN)
- `/Users/eoh/theorex/src/config.ts` — Config interface extension pattern

### Secondary (MEDIUM confidence)
- `https://github.com/huggingface/transformers.js/issues/558` (closed Oct 2025) — Bun compatibility was broken, now resolved; v3 fixed it
- `https://github.com/huggingface/transformers.js/issues/1406` (closed, resolved in v4) — Option to use onnxruntime-web in Bun; now possible if native fails
- WebSearch: Bun Node-API compatibility ~34%; native addons may fail — flags the ONNX spike as necessary

### Tertiary (LOW confidence — needs validation at spike time)
- WebSearch claim: "onnxruntime-node@1.21.0 has CVE-2026-26960 via vulnerable tar" (GitHub #1550) — tar used only in postinstall, low runtime risk; verify at install time
- WebSearch: native binding failure ("Module did not self-register") reported on M1 — may or may not apply to M4/Bun 1.3.10

---

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — `@huggingface/transformers` Bun support is officially documented but native binding compatibility on M4/Bun1.3.10 is empirical, not proven
- Architecture: HIGH — seeded edge pattern, KNN cosine scan, dissolution flag are all well-understood; integrate cleanly with existing Graphology/scan infrastructure
- Pitfalls: HIGH — all pitfalls derived from reading existing code + official docs + GitHub issues; no speculation

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable APIs; ONNX runtime release cadence is quarterly — check if onnxruntime-node version changes affect Bun compatibility)
