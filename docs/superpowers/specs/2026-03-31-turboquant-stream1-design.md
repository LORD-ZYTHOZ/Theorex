# Stage 4A — TurboQuant Native Integration (Stream 1)

**Date:** 2026-03-31
**Status:** Approved — ready for implementation

---

## 1. Objective

Replace the hand-rolled TypeScript JL/1-bit implementation (`src/rag/turbo-quant.ts`) with the real `turbo-quant` Rust crate (`RecursiveIntell/turbo-quant`) via napi-rs. This exposes zero-overhead PolarQuant + QJL vector quantization and asymmetric distance estimation directly to the Bun runtime, maximizing Apple Silicon SIMD utilization.

**What changes:**
- `src/rag/turbo-quant.ts` → deleted, replaced by native package import
- `src/rag/compressed-search.ts` → Stage 1 pre-filter swaps Hamming distance → `innerProductEstimate`
- `concepts.compressed_vector` → re-backfilled with real TurboCode (32 bytes → ~300+ bytes)

**What stays the same:**
- Two-stage retrieval architecture (pre-filter → cosine rerank)
- MCP `retrieve` tool interface
- Embedding pipeline (nomic-embed-text, 768d)

---

## 2. Architecture & File Structure

```
theorex/
├── packages/
│   └── turbo-quant-native/
│       ├── Cargo.toml           # turbo-quant git dep + napi + napi-derive
│       ├── package.json         # bun build script via @napi-rs/cli
│       ├── src/
│       │   └── lib.rs           # #[napi] bridge — NativeQuantizer class
│       ├── index.js             # generated runtime bindings (gitignored)
│       └── index.d.ts           # generated TS definitions (gitignored)
├── scripts/
│   └── backfill-turbo-quant.ts  # re-encodes 4320 concepts with real TurboCode
├── src/
│   └── rag/
│       ├── turbo-quant.ts       # DELETED
│       ├── turbo-quant.test.ts  # REPLACED (14 tests → new native binding tests)
│       ├── compressed-search.ts # UPDATED — asymmetric scoring
│       └── compressed-search.test.ts  # UPDATED — mock NativeQuantizer
└── package.json                 # ADD: "workspaces": ["packages/*"]
```

**Note on monorepo setup:** Root `package.json` gets `"workspaces": ["packages/*"]`. The native package is `@theorex/turbo-quant-native` — imported as a workspace dep from `src/rag/`.

---

## 3. Rust Bridge (`packages/turbo-quant-native/src/lib.rs`)

Exposes a `NativeQuantizer` class via `#[napi]` macros.

**Core API:**

```
NativeQuantizer::new(dim: number, bits: number, projections: number, seed: bigint)
  → Initializes TurboQuantizer. Called once per Bun worker (cheap: projection
    matrix for 768d × 192 projections ≈ 576KB f32 — no cross-thread locking needed)

.encode(embedding: Float32Array): Buffer
  → Float32Array passed as &[f32] (zero-copy napi typed array bridging)
  → TurboCode serialized to raw Vec<u8> via bytemuck/raw byte packing
  → Returned as Node Buffer — stores directly to Postgres BYTEA with no transformation

.innerProductEstimate(code: Buffer, query: Float32Array): number
  → Asymmetric: compressed DB vector vs uncompressed query
  → Buffer read back as raw bytes, cast to TurboCode in Rust — zero parsing overhead

.l2DistanceEstimate(code: Buffer, query: Float32Array): number
  → L2 equivalent, same zero-copy pattern
```

**Serialization choice: raw byte packing (not bincode, not serde_json)**
- Zero-copy deserialization on the hot path
- Buffer in Rust = exact bytes in Postgres BYTEA = exact bytes back in Rust
- No parsing overhead during retrieval

**Thread safety: per-worker singleton**
- Bun workers have isolated memory — no shared state needed
- TurboQuantizer is a stateless compute engine (projection matrices, no mutable state)
- Instantiate once at worker startup, reuse for all requests in that worker

**Cargo.toml dependency:**
```toml
[dependencies]
turbo-quant = { git = "https://github.com/RecursiveIntell/turbo-quant" }
napi = { version = "2", features = ["napi4"] }
napi-derive = "2"
```

---

## 4. Database Migration & Backfill

**Schema migration:**

The `compressed_vector` column currently holds 32-byte legacy codes. The real TurboCode is larger (~300+ bytes for 768d at 3-bit). Postgres `BYTEA` has no length constraint — this is a metadata-only change:

```sql
ALTER TABLE concepts ALTER COLUMN compressed_vector TYPE BYTEA;
```

**Backfill script (`scripts/backfill-turbo-quant.ts`):**

1. Initialize `NativeQuantizer(768, 3, 192, 42n)` — same seed as legacy for determinism
2. Batch fetch all 4320 concepts with their full `embedding` (768d float array from Postgres)
3. For each: `quantizer.encode(embedding)` → new TurboCode `Buffer`
4. Batch `UPDATE concepts SET compressed_vector = $code WHERE id = $id`
5. Log progress every 500 rows, report total failures

**Standard config:** `dim=768, bits=3, projections=192 (dim/4), seed=42n`

---

## 5. Two-Stage Retrieval Update (`src/rag/compressed-search.ts`)

Current architecture is preserved; only the Stage 1 scoring function changes.

```
Stage 1: Pre-filter
  - Load all compressed_vector codes from Postgres (up to DEFAULT_PRE_FILTER_N=5000 rows)
  - Score each with innerProductEstimate(code, queryVec) [replaces hammingDistance]
  - Take top 200 candidates

Stage 2: Rerank (unchanged)
  - Fetch full 768d embeddings for top 200 candidates
  - Cosine similarity on full vectors
  - Return top DEFAULT_TOP_K=10
```

```typescript
import { NativeQuantizer } from '@theorex/turbo-quant-native';

// Singleton per Bun worker
const quantizer = new NativeQuantizer(768, 3, 192, 42n);

export async function compressedSearch(queryVec: Float32Array, topK = DEFAULT_TOP_K) {
  // Stage 1: fast pre-filter — innerProductEstimate on all compressed codes
  const candidates = await fetchAllCompressedVectors(); // up to DEFAULT_PRE_FILTER_N rows
  const scored = candidates
    .map(row => ({ ...row, score: quantizer.innerProductEstimate(row.compressed_vector, queryVec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 200);

  // Stage 2: exact cosine rerank on full 768d embeddings (unchanged)
  const reranked = await performExactCosineRerank(scored, queryVec);
  return reranked.slice(0, topK);
}
```

The `compressedSearch()` export signature and MCP `retrieve` tool interface are unchanged.

---

## 6. Testing

**`turbo-quant.test.ts` — replace all 14 tests:**
- NativeQuantizer initializes without throwing
- `encode()` returns a Buffer (non-empty, > 32 bytes)
- `encode()` is deterministic (same input → same output)
- `innerProductEstimate()` returns a number in expected range
- Zero-copy: encoding a known vector produces consistent scores

**`compressed-search.test.ts` — update 14 tests:**
- Mock `@theorex/turbo-quant-native` (replace `hammingDistance` mock)
- Two-stage flow still tested end-to-end
- `_setDbForTesting` / `_resetDbForTesting` pattern preserved

---

## 7. Execution Plan

1. **Scaffold** — `bunx @napi-rs/cli new` inside `packages/turbo-quant-native`
2. **Cargo.toml** — add `RecursiveIntell/turbo-quant` git dep
3. **Bridge** — implement `NativeQuantizer` in `lib.rs` with `#[napi]` macros; raw byte packing for TurboCode
4. **Build** — `napi build --platform --release` targeting `aarch64-apple-darwin`
5. **Workspace** — add `"workspaces": ["packages/*"]` to root `package.json`
6. **Schema** — run `ALTER TABLE` migration
7. **Backfill** — run `scripts/backfill-turbo-quant.ts` against all 4320 concepts
8. **Swap** — delete `src/rag/turbo-quant.ts`, update `compressed-search.ts` imports + Stage 1 logic
9. **Tests** — replace/update both test files, verify `bun test` passes

---

## 8. Out of Scope (Stream 2)

Qwen3 KV cache compression (Stage 4B) is a separate stream. MLX Python port of the QJL residual pipeline is the likely winner over a Rust Unix socket sidecar — to be designed in a separate spec.
