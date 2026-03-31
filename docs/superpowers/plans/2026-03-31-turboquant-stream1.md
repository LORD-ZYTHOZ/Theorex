# TurboQuant Native Integration (Stream 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled TypeScript JL/1-bit implementation with the real `RecursiveIntell/turbo-quant` Rust crate via napi-rs, wired into Theorex's two-stage retrieval pipeline.

**Architecture:** A native napi-rs package (`packages/turbo-quant-native`) wraps the Rust `TurboQuantizer` and exposes `encode`, `innerProductEstimate`, and `l2DistanceEstimate` to Bun. The existing two-stage retrieval in `src/rag/compressed-search.ts` swaps Hamming distance for `innerProductEstimate` in Stage 1. All 4320 concepts are re-backfilled with real TurboCode.

**Tech Stack:** Rust 1.75+, napi-rs v2, `@napi-rs/cli`, bincode 1.x, Bun workspaces, Postgres BYTEA

> **Bit config correction from spec:** `bits=8, projections=192 (dim/4)` — the crate docs explicitly recommend this for "semantic search recall@10". `bits=3` is "maximum compression" mode (dim/16 projections) and sacrifices recall. Use 8 bits for RAG.

---

## File Map

| Action | Path | What it does |
|--------|------|--------------|
| ADD | `packages/turbo-quant-native/Cargo.toml` | Rust deps: turbo-quant git dep + napi |
| ADD | `packages/turbo-quant-native/build.rs` | napi-build setup |
| ADD | `packages/turbo-quant-native/src/lib.rs` | NativeQuantizer napi-rs bridge |
| ADD | `packages/turbo-quant-native/package.json` | Bun scripts for napi build |
| MODIFY | `package.json` | Add workspaces config |
| ADD | `scripts/backfill-turbo-quant.ts` | Re-encode 4320 concepts with real TurboCode |
| MODIFY | `src/rag/compressed-search.ts` | Swap Hamming → innerProductEstimate, remove matrix param |
| MODIFY | `src/rag/compressed-search.test.ts` | Mock NativeQuantizer, remove matrix fixtures |
| MODIFY | `src/mcp/server.ts` | Remove getTurboMatrix(), update compressedSearch call |
| DELETE | `src/rag/turbo-quant.ts` | Legacy hand-rolled JL/1-bit |
| REPLACE | `src/rag/turbo-quant.test.ts` | New tests for NativeQuantizer bindings |

---

## Task 1: Add workspace config and create packages directory

**Files:**
- Modify: `package.json`
- Create: `packages/turbo-quant-native/` (directory)

- [ ] **Step 1: Update root package.json**

Replace the `"scripts"` block in `package.json` with:

```json
{
  "name": "theorex",
  "module": "index.ts",
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "build:native": "cd packages/turbo-quant-native && bun run build"
  },
  "devDependencies": {
    "@types/bun": "^1.3.10"
  },
  "peerDependencies": {
    "typescript": "^5.9.3"
  },
  "dependencies": {
    "@huggingface/transformers": "^3.8.1",
    "@types/pg": "^8.20.0",
    "cockatiel": "^3.2.1",
    "compromise": "^14.15.0",
    "graphology": "^0.26.0",
    "pg": "^8.20.0",
    "wink-bm25-text-search": "^3.1.2"
  },
  "description": "AI-native memory for multi-agent systems. Concept web with decay, promotion, and boot injection.",
  "repository": {
    "type": "git",
    "url": "https://github.com/LORD-ZYTHOZ/theorex"
  },
  "license": "MIT",
  "keywords": ["ai", "memory", "agents", "multi-agent", "concept-graph", "llm"]
}
```

- [ ] **Step 2: Create packages directory**

```bash
mkdir -p packages/turbo-quant-native/src
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add workspace config for turbo-quant-native package"
```

---

## Task 2: Create the native package skeleton

**Files:**
- Create: `packages/turbo-quant-native/package.json`
- Create: `packages/turbo-quant-native/build.rs`
- Create: `packages/turbo-quant-native/.gitignore`

- [ ] **Step 1: Write package.json**

Create `packages/turbo-quant-native/package.json`:

```json
{
  "name": "@theorex/turbo-quant-native",
  "version": "0.1.0",
  "main": "index.js",
  "types": "index.d.ts",
  "scripts": {
    "build": "napi build --platform --release --js index.js --dts index.d.ts",
    "build:debug": "napi build --platform --js index.js --dts index.d.ts"
  },
  "napi": {
    "name": "turbo-quant-native",
    "triples": {
      "defaults": false,
      "additional": ["aarch64-apple-darwin"]
    }
  },
  "files": ["index.js", "index.d.ts", "*.node"],
  "devDependencies": {
    "@napi-rs/cli": "^2"
  }
}
```

- [ ] **Step 2: Write build.rs**

Create `packages/turbo-quant-native/build.rs`:

```rust
extern crate napi_build;

fn main() {
    napi_build::setup();
}
```

- [ ] **Step 3: Write .gitignore**

Create `packages/turbo-quant-native/.gitignore`:

```
*.node
index.js
index.d.ts
target/
```

- [ ] **Step 4: Commit**

```bash
git add packages/
git commit -m "chore: scaffold turbo-quant-native napi-rs package"
```

---

## Task 3: Write Cargo.toml

**Files:**
- Create: `packages/turbo-quant-native/Cargo.toml`

- [ ] **Step 1: Write Cargo.toml**

Create `packages/turbo-quant-native/Cargo.toml`:

```toml
[package]
name = "turbo-quant-native"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", features = ["napi4"] }
napi-derive = "2"
turbo-quant = { git = "https://github.com/RecursiveIntell/turbo-quant", rev = "29b47c5" }
bincode = "1"
serde = { version = "1", features = ["derive"] }

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
strip = true
```

> The `rev = "29b47c5"` pins to the commit verified on 2026-03-31. Update to a new rev only when intentionally upgrading.

- [ ] **Step 2: Commit**

```bash
git add packages/turbo-quant-native/Cargo.toml
git commit -m "chore: add Cargo.toml for turbo-quant-native"
```

---

## Task 4: Implement the napi-rs bridge

**Files:**
- Create: `packages/turbo-quant-native/src/lib.rs`

- [ ] **Step 1: Write lib.rs**

Create `packages/turbo-quant-native/src/lib.rs`:

```rust
#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use turbo_quant::{TurboCode, TurboQuantizer};

/// napi-rs bridge exposing TurboQuantizer to Bun/Node.
///
/// Instantiate once per Bun worker (stateless compute engine — projection
/// matrices for 768d × 192 projections ≈ 600KB, cheap to hold per-worker).
#[napi]
pub struct NativeQuantizer {
    inner: TurboQuantizer,
}

#[napi]
impl NativeQuantizer {
    /// Create a new quantizer.
    ///
    /// Standard config for Theorex semantic search (nomic-embed-text 768d):
    ///   NativeQuantizer(768, 8, 192, 42n)
    ///
    /// - dim: 768 (nomic-embed-text output dimension)
    /// - bits: 8 (recommended for recall@10; must be ≥ 2)
    /// - projections: 192 (dim/4, recommended for semantic search)
    /// - seed: 42n (BigInt — must match the seed used during backfill)
    #[napi(constructor)]
    pub fn new(dim: u32, bits: u8, projections: u32, seed: BigInt) -> napi::Result<Self> {
        let (_, seed_val, _) = seed.get_u64();
        TurboQuantizer::new(dim as usize, bits, projections as usize, seed_val)
            .map(|inner| NativeQuantizer { inner })
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Compress a 768d Float32Array into a TurboCode Buffer for Postgres BYTEA storage.
    ///
    /// Zero-copy input: Float32Array passed as &[f32] via napi typed array bridging.
    /// Output: bincode-serialized TurboCode as a raw Buffer.
    #[napi]
    pub fn encode(&self, embedding: Float32Array) -> napi::Result<Buffer> {
        let code: TurboCode = self
            .inner
            .encode(embedding.as_ref())
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        bincode::serialize(&code)
            .map(Buffer::from)
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Estimate inner product between a compressed DB vector and an uncompressed query.
    ///
    /// Asymmetric: code = stored BYTEA buffer, query = raw Float32Array at search time.
    /// No decompression needed — estimate is computed directly on the compressed code.
    #[napi]
    pub fn inner_product_estimate(
        &self,
        code: Buffer,
        query: Float32Array,
    ) -> napi::Result<f64> {
        let turbo_code: TurboCode = bincode::deserialize(code.as_ref())
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        self.inner
            .inner_product_estimate(&turbo_code, query.as_ref())
            .map(|s| s as f64)
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    /// Estimate squared L2 distance between a compressed DB vector and a raw query.
    #[napi]
    pub fn l2_distance_estimate(
        &self,
        code: Buffer,
        query: Float32Array,
    ) -> napi::Result<f64> {
        let turbo_code: TurboCode = bincode::deserialize(code.as_ref())
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        self.inner
            .l2_distance_estimate(&turbo_code, query.as_ref())
            .map(|s| s as f64)
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/turbo-quant-native/src/lib.rs
git commit -m "feat(native): implement NativeQuantizer napi-rs bridge"
```

---

## Task 5: Install toolchain and build the .node binary

- [ ] **Step 1: Ensure Rust and napi-rs CLI are available**

```bash
rustup target add aarch64-apple-darwin
cargo --version  # should be 1.75+
```

- [ ] **Step 2: Install @napi-rs/cli**

```bash
cd packages/turbo-quant-native && bun install
```

- [ ] **Step 3: Build the native binary**

```bash
bun run build
```

Expected output: creates `turbo-quant-native.darwin-arm64.node`, `index.js`, `index.d.ts` in `packages/turbo-quant-native/`.

If build fails with "crate not found", verify the git rev in Cargo.toml is reachable:
```bash
cargo fetch --manifest-path packages/turbo-quant-native/Cargo.toml
```

- [ ] **Step 4: Verify the binary loads**

```bash
cd /Users/eoh/theorex
bun -e "const { NativeQuantizer } = require('./packages/turbo-quant-native/index.js'); const q = new NativeQuantizer(768, 8, 192, 42n); console.log('ok', q);"
```

Expected: `ok NativeQuantizer {}`

- [ ] **Step 5: Commit**

```bash
git add packages/turbo-quant-native/index.js packages/turbo-quant-native/index.d.ts packages/turbo-quant-native/*.node bun.lock
git commit -m "build(native): compile turbo-quant-native for aarch64-apple-darwin"
```

---

## Task 6: Write NativeQuantizer TypeScript tests (TDD)

**Files:**
- Replace: `src/rag/turbo-quant.test.ts`

- [ ] **Step 1: Write failing tests**

Replace `src/rag/turbo-quant.test.ts` with:

```typescript
// src/rag/turbo-quant.test.ts
// Tests for the NativeQuantizer napi-rs binding.
import { describe, test, expect, beforeAll } from "bun:test";
import { NativeQuantizer } from "../../../packages/turbo-quant-native/index.js";

const DIM = 768;
const BITS = 8;
const PROJECTIONS = 192;
const SEED = 42n;

function randomVec(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    v[i] = ((s >>> 16) / 32768) - 1; // [-1, 1]
  }
  return v;
}

describe("NativeQuantizer", () => {
  let q: NativeQuantizer;

  beforeAll(() => {
    q = new NativeQuantizer(DIM, BITS, PROJECTIONS, SEED);
  });

  test("constructs without throwing", () => {
    expect(() => new NativeQuantizer(DIM, BITS, PROJECTIONS, SEED)).not.toThrow();
  });

  test("rejects zero dimension", () => {
    expect(() => new NativeQuantizer(0, BITS, PROJECTIONS, SEED)).toThrow();
  });

  test("rejects odd dimension", () => {
    expect(() => new NativeQuantizer(7, BITS, PROJECTIONS, SEED)).toThrow();
  });

  test("rejects bits < 2", () => {
    expect(() => new NativeQuantizer(DIM, 1, PROJECTIONS, SEED)).toThrow();
  });

  test("encode returns a Buffer", () => {
    const vec = randomVec(DIM, 1);
    const code = q.encode(vec);
    expect(code).toBeInstanceOf(Buffer);
    expect(code.length).toBeGreaterThan(32); // real TurboCode >> legacy 32 bytes
  });

  test("encode is deterministic — same input same output", () => {
    const vec = randomVec(DIM, 2);
    const code1 = q.encode(vec);
    const code2 = q.encode(vec);
    expect(Buffer.compare(code1, code2)).toBe(0);
  });

  test("encode rejects wrong dimension", () => {
    const badVec = new Float32Array(100);
    expect(() => q.encode(badVec)).toThrow();
  });

  test("innerProductEstimate returns a number", () => {
    const vec = randomVec(DIM, 3);
    const query = randomVec(DIM, 4);
    const code = q.encode(vec);
    const score = q.innerProductEstimate(code, query);
    expect(typeof score).toBe("number");
    expect(Number.isFinite(score)).toBe(true);
  });

  test("innerProductEstimate ranks close vector above random", () => {
    const query = randomVec(DIM, 99);

    // close: small perturbation of query
    const close = new Float32Array(query);
    for (let i = 0; i < DIM; i++) close[i] += 0.01;

    const far = randomVec(DIM, 200);

    const codeClose = q.encode(close);
    const codeFar = q.encode(far);

    const scoreClose = q.innerProductEstimate(codeClose, query);
    const scoreFar = q.innerProductEstimate(codeFar, query);

    expect(scoreClose).toBeGreaterThan(scoreFar);
  });

  test("l2DistanceEstimate returns non-negative number", () => {
    const vec = randomVec(DIM, 5);
    const query = randomVec(DIM, 6);
    const code = q.encode(vec);
    const dist = q.l2DistanceEstimate(code, query);
    expect(typeof dist).toBe("number");
    expect(dist).toBeGreaterThanOrEqual(0);
  });

  test("l2DistanceEstimate is smaller for close vector", () => {
    const query = randomVec(DIM, 50);
    const close = new Float32Array(query);
    for (let i = 0; i < DIM; i++) close[i] += 0.01;
    const far = randomVec(DIM, 300);

    const distClose = q.l2DistanceEstimate(q.encode(close), query);
    const distFar = q.l2DistanceEstimate(q.encode(far), query);
    expect(distClose).toBeLessThan(distFar);
  });

  test("encode-decode round-trip: code from vec1 does not match query for vec2", () => {
    const vec1 = randomVec(DIM, 7);
    const vec2 = randomVec(DIM, 8);
    const code1 = q.encode(vec1);
    const code2 = q.encode(vec2);
    expect(Buffer.compare(code1, code2)).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail if binary not yet on path**

```bash
cd /Users/eoh/theorex && bun test src/rag/turbo-quant.test.ts
```

If the binary is built (Task 5 done), tests should pass. If module not found, verify `index.js` path in the import.

- [ ] **Step 3: Commit**

```bash
git add src/rag/turbo-quant.test.ts
git commit -m "test(native): NativeQuantizer binding tests"
```

---

## Task 7: Schema migration

- [ ] **Step 1: Connect to Postgres and run migration**

```bash
psql -h 100.95.91.32 -U claw -d theorex -c "ALTER TABLE concepts ALTER COLUMN compressed_vector TYPE BYTEA;"
```

Expected output: `ALTER TABLE`

If the column already has no length constraint (it's plain BYTEA), this is a no-op — that's fine.

- [ ] **Step 2: Verify**

```bash
psql -h 100.95.91.32 -U claw -d theorex -c "\d concepts" | grep compressed
```

Expected: `compressed_vector | bytea` (no size constraint)

- [ ] **Step 3: Commit migration note**

```bash
git commit --allow-empty -m "chore(db): alter compressed_vector to plain BYTEA (no length constraint)"
```

---

## Task 8: Write and run the backfill script

**Files:**
- Create: `scripts/backfill-turbo-quant.ts`

- [ ] **Step 1: Write backfill script**

Create `scripts/backfill-turbo-quant.ts`:

```typescript
/**
 * Re-encode all concepts with real TurboCode via NativeQuantizer.
 * Replaces legacy 32-byte JL/1-bit codes with proper PolarQuant+QJL codes.
 *
 * Run: bun scripts/backfill-turbo-quant.ts
 */

import { NativeQuantizer } from "../packages/turbo-quant-native/index.js";

const DIM = 768;
const BITS = 8;
const PROJECTIONS = 192;
const SEED = 42n;
const BATCH = 100;

const sql = new Bun.SQL({
  host: process.env.THEOREX_PG_HOST || "100.95.91.32",
  port: Number(process.env.THEOREX_PG_PORT || 5432),
  user: process.env.THEOREX_PG_USER || "claw",
  database: process.env.THEOREX_PG_DB || "theorex",
});

function parseVec(raw: unknown): Float32Array {
  if (typeof raw !== "string") throw new Error(`expected string from pg, got ${typeof raw}`);
  const nums = raw.slice(1, -1).split(",").map(Number);
  if (nums.length !== DIM) throw new Error(`expected ${DIM}d vector, got ${nums.length}d`);
  return new Float32Array(nums);
}

async function main() {
  console.log(`Initializing NativeQuantizer(${DIM}, ${BITS}, ${PROJECTIONS}, ${SEED})...`);
  const quantizer = new NativeQuantizer(DIM, BITS, PROJECTIONS, SEED);

  // Count all concepts with embeddings (overwrite all, not just null)
  const totalRows = await sql`SELECT COUNT(*) AS n FROM concepts WHERE embedding IS NOT NULL`;
  const total = Number(totalRows[0].n);
  console.log(`Re-encoding ${total} concepts...`);

  let done = 0;
  let failed = 0;
  let offset = 0;

  while (true) {
    const rows = await sql`
      SELECT id, embedding FROM concepts
      WHERE embedding IS NOT NULL
      ORDER BY created_at
      LIMIT ${BATCH} OFFSET ${offset}
    `;
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const vec = parseVec(row.embedding);
        const code = quantizer.encode(vec);
        await sql`UPDATE concepts SET compressed_vector = ${code} WHERE id = ${row.id}`;
        done++;
      } catch (err) {
        console.error(`Failed id=${row.id}:`, err);
        failed++;
      }
    }

    offset += BATCH;

    if (done % 500 < BATCH || done + failed >= total) {
      console.log(`  ${done}/${total} done, ${failed} failed`);
    }
  }

  console.log(`Done. ${done} re-encoded, ${failed} failed.`);
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the backfill**

```bash
cd /Users/eoh/theorex && bun scripts/backfill-turbo-quant.ts
```

Expected: `Done. 4320 re-encoded, 0 failed.`

- [ ] **Step 3: Verify a sample row**

```bash
psql -h 100.95.91.32 -U claw -d theorex -c "SELECT id, length(compressed_vector) AS bytes FROM concepts WHERE compressed_vector IS NOT NULL LIMIT 5;"
```

Expected: `bytes` column shows values > 100 (real TurboCode, not 32).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-turbo-quant.ts
git commit -m "feat(scripts): backfill real TurboCode via NativeQuantizer"
```

---

## Task 9: Update compressed-search.ts

**Files:**
- Modify: `src/rag/compressed-search.ts`

Key changes:
- Remove `matrix: Float32Array` parameter from `compressedSearch`
- Replace `compress` + `hammingDistance` with `NativeQuantizer.innerProductEstimate`
- Rename `hammingScore` → `innerProductScore` in types
- Sort descending (higher inner product = more similar, opposite of Hamming)

- [ ] **Step 1: Rewrite compressed-search.ts**

Replace `src/rag/compressed-search.ts` with:

```typescript
/**
 * compressed-search.ts — Two-stage retrieval using TurboQuant native compression.
 *
 * Stage 1 (fast): innerProductEstimate pre-filter on TurboCode compressed vectors.
 * Stage 2 (accurate): Cosine similarity rerank on full 768d embeddings for top candidates.
 */

import { NativeQuantizer } from "../../../packages/turbo-quant-native/index.js";

// ---------------------------------------------------------------------------
// Singleton quantizer (one per Bun worker — stateless compute engine)
// ---------------------------------------------------------------------------

let _quantizer: NativeQuantizer | null = null;

function getQuantizer(): NativeQuantizer {
  if (!_quantizer) {
    _quantizer = new NativeQuantizer(
      768,  // nomic-embed-text output dimension
      8,    // bits: 8 = recommended for semantic search recall@10
      192,  // projections: dim/4 = 192
      42n,  // seed: must match the seed used in backfill
    );
  }
  return _quantizer;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressedSearchResult {
  readonly id: string;
  readonly label: string;
  readonly memory_type: string;
  readonly agent_id: string;
  readonly meta: Record<string, unknown>;
  readonly innerProductScore: number;  // Stage 1 score (higher = more similar)
  readonly cosineScore: number;        // Stage 2 score (higher = more similar)
}

export const DEFAULT_PRE_FILTER_N = 200;
export const DEFAULT_TOP_K = 10;

export interface CompressedSearchOptions {
  readonly agentId?: string;
  readonly preFilterN?: number;
  readonly topK?: number;
}

// ---------------------------------------------------------------------------
// DB connection (module-level singleton)
// ---------------------------------------------------------------------------

let _sql: ReturnType<typeof Bun.sql> | null = null;

function getDb(): ReturnType<typeof Bun.sql> {
  if (!_sql) {
    _sql = new Bun.SQL({
      host: process.env.THEOREX_PG_HOST || "100.95.91.32",
      port: Number(process.env.THEOREX_PG_PORT || 5432),
      user: process.env.THEOREX_PG_USER || "claw",
      database: process.env.THEOREX_PG_DB || "theorex",
      max: 5,
    });
  }
  return _sql;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function parseVec(raw: unknown): Float32Array {
  if (typeof raw !== "string") throw new Error(`expected string for embedding, got ${typeof raw}`);
  return new Float32Array(raw.slice(1, -1).split(",").map(Number));
}

function parseCode(raw: unknown): Buffer {
  if (raw instanceof Buffer) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  throw new Error(`unexpected type for compressed_vector: ${typeof raw}`);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface CompressedRow {
  readonly id: string;
  readonly label: string;
  readonly memory_type: string;
  readonly agent_id: string;
  readonly meta: Record<string, unknown>;
  readonly compressed_vector: unknown;
}

interface FullEmbeddingRow {
  readonly id: string;
  readonly embedding: unknown;
}

interface ScoredCandidate {
  readonly id: string;
  readonly label: string;
  readonly memory_type: string;
  readonly agent_id: string;
  readonly meta: Record<string, unknown>;
  readonly innerProductScore: number;
}

// ---------------------------------------------------------------------------
// Stage 1: innerProductEstimate pre-filter
// ---------------------------------------------------------------------------

async function innerProductPreFilter(
  queryVec: Float32Array,
  agentId: string | undefined,
  preFilterN: number,
): Promise<ScoredCandidate[]> {
  const sql = getDb();
  const quantizer = getQuantizer();

  const rows: CompressedRow[] = agentId
    ? await sql`
        SELECT id, label, memory_type, agent_id, meta, compressed_vector
        FROM concepts
        WHERE compressed_vector IS NOT NULL
          AND agent_id = ${agentId}
        ORDER BY created_at DESC
        LIMIT 5000
      `
    : await sql`
        SELECT id, label, memory_type, agent_id, meta, compressed_vector
        FROM concepts
        WHERE compressed_vector IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5000
      `;

  const scored = rows.map((row) => {
    const code = parseCode(row.compressed_vector);
    return {
      id: row.id,
      label: row.label,
      memory_type: row.memory_type,
      agent_id: row.agent_id,
      meta: row.meta,
      innerProductScore: quantizer.innerProductEstimate(code, queryVec),
    };
  });

  // Higher inner product = more similar — sort descending
  return scored
    .slice()
    .sort((a, b) => b.innerProductScore - a.innerProductScore)
    .slice(0, preFilterN);
}

// ---------------------------------------------------------------------------
// Stage 2: Cosine rerank (unchanged from legacy)
// ---------------------------------------------------------------------------

async function cosineRerank(
  candidates: ScoredCandidate[],
  queryVec: Float32Array,
  topK: number,
): Promise<CompressedSearchResult[]> {
  if (candidates.length === 0) return [];

  const sql = getDb();
  const candidateIds = candidates.map((c) => c.id);
  const pgArray = `{${candidateIds.join(",")}}`;

  const fullRows: FullEmbeddingRow[] = await sql`
    SELECT id, embedding FROM concepts WHERE id = ANY(${pgArray}::uuid[])
  `;

  const embeddingMap = new Map<string, Float32Array>();
  for (const row of fullRows) {
    if (row.embedding !== null) {
      try {
        embeddingMap.set(row.id, parseVec(row.embedding));
      } catch (err) {
        console.error(`[compressed-search] failed to parse embedding for id=${row.id}:`, err);
      }
    }
  }

  const withCosine = candidates
    .filter((c) => embeddingMap.has(c.id))
    .map((c) => ({
      ...c,
      cosineScore: cosine(queryVec, embeddingMap.get(c.id)!),
    }));

  return withCosine
    .slice()
    .sort((a, b) => b.cosineScore - a.cosineScore)
    .slice(0, topK);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Two-stage compressed search.
 * @param queryVec - 768d query embedding (Float32Array)
 * @param options
 */
export async function compressedSearch(
  queryVec: Float32Array,
  options?: CompressedSearchOptions,
): Promise<CompressedSearchResult[]> {
  const agentId = options?.agentId;
  const preFilterN = options?.preFilterN ?? DEFAULT_PRE_FILTER_N;
  const topK = options?.topK ?? DEFAULT_TOP_K;

  const candidates = await innerProductPreFilter(queryVec, agentId, preFilterN);
  return cosineRerank(candidates, queryVec, topK);
}

// ---------------------------------------------------------------------------
// Test injection hooks (only use in tests)
// ---------------------------------------------------------------------------

export function _setDbForTesting(db: ReturnType<typeof Bun.sql>): void {
  _sql = db;
}

export function _resetDbForTesting(): void {
  _sql = null;
}

export function _setQuantizerForTesting(q: NativeQuantizer): void {
  _quantizer = q;
}

export function _resetQuantizerForTesting(): void {
  _quantizer = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/rag/compressed-search.ts
git commit -m "feat(rag): swap Hamming pre-filter for TurboQuant innerProductEstimate"
```

---

## Task 10: Update MCP server to remove matrix dependency

**Files:**
- Modify: `src/mcp/server.ts`

The server currently imports `buildProjectionMatrix` and calls `getTurboMatrix()` before passing to `compressedSearch`. Both get removed.

- [ ] **Step 1: Remove getTurboMatrix and update the compressed retrieve call**

In `src/mcp/server.ts`:

1. Delete the import on line 15:
```typescript
// DELETE this line:
import { buildProjectionMatrix } from "../rag/turbo-quant";
```

2. Delete the `getTurboMatrix()` function (around line 37):
```typescript
// DELETE this entire function:
function getTurboMatrix(): Float32Array {
  ...
}
```

3. Update the compressed search call (around line 671):
```typescript
// OLD:
const matrix = getTurboMatrix();
const results = await compressedSearch(queryVec, matrix, { agentId, topK });

// NEW:
const results = await compressedSearch(queryVec, { agentId, topK });
```

- [ ] **Step 2: Run tests to verify MCP server still passes**

```bash
cd /Users/eoh/theorex && bun test src/mcp/server.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "fix(mcp): remove matrix parameter from compressedSearch call"
```

---

## Task 11: Update compressed-search.test.ts

**Files:**
- Modify: `src/rag/compressed-search.test.ts`

Replace the Hamming mocks with NativeQuantizer mocks and remove the `matrix` fixture.

- [ ] **Step 1: Rewrite compressed-search.test.ts**

Replace `src/rag/compressed-search.test.ts` with:

```typescript
// src/rag/compressed-search.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  compressedSearch,
  _setDbForTesting,
  _resetDbForTesting,
  _setQuantizerForTesting,
  _resetQuantizerForTesting,
  DEFAULT_PRE_FILTER_N,
  DEFAULT_TOP_K,
} from "./compressed-search";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockCode(score: number): Buffer {
  // Opaque buffer — the mock quantizer uses the score directly
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(score, 0);
  return buf;
}

function mockVec(dim = 768): Float32Array {
  return new Float32Array(dim).fill(0.5);
}

function makeConceptRow(id: string, score: number) {
  return {
    id,
    label: `concept-${id}`,
    memory_type: "fact",
    agent_id: "agent-1",
    meta: {},
    compressed_vector: mockCode(score),
  };
}

function makeEmbeddingRow(id: string, value = 0.5) {
  const embedding = `{${Array(768).fill(value).join(",")}}`;
  return { id, embedding };
}

// ---------------------------------------------------------------------------
// Mock NativeQuantizer
// ---------------------------------------------------------------------------

function makeMockQuantizer() {
  return {
    innerProductEstimate: (code: Buffer, _query: Float32Array): number => {
      // Decode score from the mock code buffer
      return code.length >= 8 ? code.readDoubleBE(0) : 0;
    },
    encode: (_vec: Float32Array): Buffer => mockCode(0.5),
    l2DistanceEstimate: (_code: Buffer, _query: Float32Array): number => 0,
  };
}

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function makeDb(compressedRows: ReturnType<typeof makeConceptRow>[], embeddingRows: ReturnType<typeof makeEmbeddingRow>[]) {
  const db = {
    callCount: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  db[Symbol.for("nodejs.util.inspect.custom")] = () => "MockDB";

  // Bun.sql is called as a tagged template literal
  const handler = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    db.callCount++;
    const query = strings.join("?").toLowerCase();
    if (query.includes("compressed_vector")) return Promise.resolve(compressedRows);
    if (query.includes("embedding")) return Promise.resolve(embeddingRows);
    return Promise.resolve([]);
  };

  return new Proxy(handler, {
    get(target, prop) {
      if (prop === "callCount") return db.callCount;
      if (prop === "end") return () => Promise.resolve();
      return target;
    },
    apply(target, thisArg, args) {
      return target(...args as [TemplateStringsArray, ...unknown[]]);
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compressedSearch", () => {
  beforeEach(() => {
    _setQuantizerForTesting(makeMockQuantizer() as unknown as import("../../../packages/turbo-quant-native/index.js").NativeQuantizer);
  });

  afterEach(() => {
    _resetDbForTesting();
    _resetQuantizerForTesting();
  });

  test("returns empty array when no compressed rows", async () => {
    _setDbForTesting(makeDb([], []) as unknown as ReturnType<typeof Bun.sql>);
    const results = await compressedSearch(mockVec());
    expect(results).toEqual([]);
  });

  test("returns top-k results (default 10)", async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeConceptRow(`id-${i}`, 20 - i) // descending scores
    );
    const embeddings = rows.map((r) => makeEmbeddingRow(r.id));
    _setDbForTesting(makeDb(rows, embeddings) as unknown as ReturnType<typeof Bun.sql>);

    const results = await compressedSearch(mockVec());
    expect(results.length).toBeLessThanOrEqual(DEFAULT_TOP_K);
  });

  test("respects topK option", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => makeConceptRow(`id-${i}`, 20 - i));
    const embeddings = rows.map((r) => makeEmbeddingRow(r.id));
    _setDbForTesting(makeDb(rows, embeddings) as unknown as ReturnType<typeof Bun.sql>);

    const results = await compressedSearch(mockVec(), { topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("result has innerProductScore and cosineScore fields", async () => {
    const rows = [makeConceptRow("abc", 0.9)];
    _setDbForTesting(makeDb(rows, [makeEmbeddingRow("abc")]) as unknown as ReturnType<typeof Bun.sql>);

    const results = await compressedSearch(mockVec());
    if (results.length > 0) {
      expect(typeof results[0]!.innerProductScore).toBe("number");
      expect(typeof results[0]!.cosineScore).toBe("number");
    }
  });

  test("result does not have hammingScore field", async () => {
    const rows = [makeConceptRow("abc", 0.9)];
    _setDbForTesting(makeDb(rows, [makeEmbeddingRow("abc")]) as unknown as ReturnType<typeof Bun.sql>);

    const results = await compressedSearch(mockVec());
    if (results.length > 0) {
      expect("hammingScore" in results[0]!).toBe(false);
    }
  });

  test("results are sorted by cosineScore descending", async () => {
    const rows = [
      makeConceptRow("a", 0.9),
      makeConceptRow("b", 0.7),
      makeConceptRow("c", 0.5),
    ];
    // Give different cosine similarities by using different embedding values
    const embeddings = [
      makeEmbeddingRow("a", 0.9),
      makeEmbeddingRow("b", 0.5),
      makeEmbeddingRow("c", 0.1),
    ];
    _setDbForTesting(makeDb(rows, embeddings) as unknown as ReturnType<typeof Bun.sql>);

    const results = await compressedSearch(mockVec());
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.cosineScore).toBeGreaterThanOrEqual(results[i]!.cosineScore);
    }
  });

  test("skips candidates with no embedding", async () => {
    const rows = [makeConceptRow("has-embedding", 0.9), makeConceptRow("no-embedding", 0.8)];
    const embeddings = [makeEmbeddingRow("has-embedding")]; // no-embedding omitted
    _setDbForTesting(makeDb(rows, embeddings) as unknown as ReturnType<typeof Bun.sql>);

    const results = await compressedSearch(mockVec());
    expect(results.every((r) => r.id !== "no-embedding")).toBe(true);
  });

  test("agentId filter is passed through to DB query", async () => {
    let capturedQuery = "";
    const db = new Proxy(
      (strings: TemplateStringsArray) => {
        capturedQuery = strings.join("?");
        return Promise.resolve([]);
      },
      {
        get(target, prop) {
          if (prop === "end") return () => Promise.resolve();
          return target;
        },
        apply(target, thisArg, args) {
          return target(...args as [TemplateStringsArray, ...unknown[]]);
        },
      },
    );
    _setDbForTesting(db as unknown as ReturnType<typeof Bun.sql>);

    await compressedSearch(mockVec(), { agentId: "agent-42" });
    expect(capturedQuery.toLowerCase()).toContain("agent_id");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/eoh/theorex && bun test src/rag/compressed-search.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/rag/compressed-search.test.ts
git commit -m "test(rag): update compressed-search tests for NativeQuantizer"
```

---

## Task 12: Delete legacy turbo-quant.ts and run full suite

**Files:**
- Delete: `src/rag/turbo-quant.ts`

- [ ] **Step 1: Verify no remaining imports of the legacy module**

```bash
cd /Users/eoh/theorex && grep -r "from.*rag/turbo-quant" src/ scripts/ --include="*.ts"
```

Expected: no results (MCP server import was removed in Task 10).

- [ ] **Step 2: Delete the legacy file**

```bash
rm src/rag/turbo-quant.ts
```

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/eoh/theorex && bun test
```

Expected: all tests pass, 0 failures. Test count will be similar to the 639 pre-existing tests minus the old turbo-quant.test.ts tests, plus the new ones.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(rag): complete TurboQuant native integration — remove legacy TS implementation"
```

---

## Self-Review Checklist

- [x] All spec sections have a corresponding task
- [x] Workspace config — Task 1
- [x] Cargo.toml with pinned rev — Task 3
- [x] lib.rs with real API (Result<> errors, BigInt seed, Float32Array zero-copy) — Task 4
- [x] Build step with verification command — Task 5
- [x] Schema migration — Task 7
- [x] Backfill script using same BITS=8, PROJECTIONS=192, SEED=42n — Task 8
- [x] compressedSearch signature change (matrix param removed) — Task 9
- [x] MCP server caller updated — Task 10
- [x] Test injection hooks extended (_setQuantizerForTesting) — Task 9
- [x] Legacy file deleted after verifying no remaining imports — Task 12
- [x] Bit config correction applied throughout (bits=8 not bits=3)
- [x] No placeholders or TBDs
