# TurboQuant — Research Findings & Implementation

> How we researched, evaluated, and integrated TurboQuant into Theorex for compressed embedding search and LLM KV cache compression on Apple Silicon.

---

## What is TurboQuant?

TurboQuant is a vector quantization algorithm from Google Research, published at ICLR 2026. It compresses high-dimensional vectors (like embeddings or LLM attention cache keys/values) while preserving inner product and distance estimates needed for fast similarity search.

The core pipeline:

```
Input vector (f32[dim])
  → Random orthogonal rotation (QR/Haar)     ← decorrelates dimensions
  → PolarQuant MSE quantization              ← 4–8 bit lossy compression
  → QJL residual sketch (1-bit per projection) ← corrects norm bias
  → TurboCode (radii f32 + angle indices + sign bits)
```

Why it matters: you can compute inner products and L2 distances **directly on compressed codes**, without decompressing first. For a 768-dim embedding at 8-bit, that's ~2.5KB vs 3KB uncompressed — but the speed gain comes from fewer memory reads during batch search.

---

## Research Phase — What We Found

We evaluated five repos before deciding on an implementation path.

### Repos Evaluated

| Repo | What it is | Verdict |
|------|-----------|---------|
| `LORD-ZYTHOZ/turboquant` | vLLM + Triton kernels, ICLR 2026 reference | GPU-only, not portable |
| `LORD-ZYTHOZ/turboquant-pytorch` | HuggingFace DynamicCache hook, pure PyTorch | Good reference, QJL broken (see below) |
| `LORD-ZYTHOZ/turboquant-model` | Weight quantization (post-training) | Different problem, irrelevant |
| `antgroup/cakekv` | KV cache **eviction** (drop tokens) | Complementary, not the same thing |
| `RecursiveIntell/turbo-quant` | Rust crate, canonical implementation | **Used for Stream 1** |

### Key Research Findings

**1. QJL must be applied to the RESIDUAL only**

The PyTorch repo broke because it applied QJL to the full vector. The Medium article by the paper authors clarifies: QJL is a 1-bit residual correction on the error left after PolarQuant. Applied to the full vector, the softmax amplifies variance and produces garbage. Applied to the residual, it corrects the norm bias that PolarQuant introduces.

**2. K-cache needs more bits than V-cache**

Keys are "exponentially more sensitive" than values in transformer attention. Asymmetric bit allocation that works: **K→6 bit, V→4 bit**. We initially had both at 6-bit (a bug — see Stream 2).

**3. Kernel fusion is essential on Apple Silicon**

Naive sequential ops (rotate → quantize → sketch) saturate the memory bus on M-series chips. Fusing into a single pass reduces memory bandwidth by ~3x. This is why the vLLM/Triton implementation is GPU-only — the kernel fusion is CUDA-specific.

**4. 3–3.5 bits total = ~6x compression, ~1.2% quality degradation**

At 2.5 bits you start seeing meaningful quality loss. The sweet spot for our use case (Theorex concept search + Qwen3 KV cache) is 3–3.5 bits total across K and V.

**5. KV caches are serializable to NVMe in Q4 format**

Compressed KV caches can be written to disk at ~25% of original size. This masks prefill latency on long contexts by allowing cache reuse across requests.

---

## Stream 1 — Theorex Embedding Search

### Problem

Theorex's original compressed vector implementation (`src/rag/turbo-quant.ts`) was a hand-rolled TypeScript approximation:
- Johnson-Lindenstrauss random projection (1-bit per projection)
- No PolarQuant rotation, no QJL residual correction
- 32 bytes per concept — not the real algorithm
- 8/10 recall against hybrid BM25+vector search

### What We Built

Replaced the TypeScript quantizer with the real `RecursiveIntell/turbo-quant` Rust crate, bound into Node/Bun via **napi-rs**.

```
packages/turbo-quant-native/
├── Cargo.toml          (depends on turbo-quant 0.1.x)
├── build.rs
├── src/lib.rs          (napi-rs wrapper)
└── turbo-quant-native.darwin-arm64.node   (395KB compiled binary)
```

The Rust API we wrapped:

```rust
TurboQuantizer::new(dim, bits, projections, seed)
  .encode(&[f32]) -> TurboCode
  .inner_product_estimate(&TurboCode, &[f32]) -> f32
  .l2_distance_estimate(&TurboCode, &[f32]) -> f32
  .decode_approximate(&TurboCode) -> Vec<f32>
```

One napi-rs quirk: required `napi4 → napi6` to support BigInt (used for the deterministic seed).

### Configuration

```typescript
NativeQuantizer(
  768,   // dim — nomic-embed-text-v1.5 output
  8,     // bits — recall@10 mode, not max compression
  192,   // projections = dim/4
  42n    // seed (BigInt) — deterministic, no calibration needed
)
```

### Results

- **4320 concepts backfilled** — 2545 bytes/concept (was 32 bytes — 80x larger, contains real PolarQuant+QJL codes)
- **1260 tests pass, 0 fail** — first run, no debugging round needed
- Seed=42 is baked into all stored codes — quantizer must be reconstructed with the same seed to query

---

## Stream 2 — Qwen3 KV Cache on MLX

### Problem

Qwen3 32B running via mlx-lm on M4 Mac has an effective context window limited by RAM. At fp16, the KV cache for 32k tokens takes ~8GB alone. Compressing it to 3-bit would expand usable context to ~128k tokens within the same RAM budget.

### What We Built

A standalone Python project (`/Users/eoh/turbo-kv/`) that patches Qwen3's attention layer in-place:

```
patches/
├── cache_manager.py      HybridCache — fp16 recent window + compressed long-term store
├── qwen3_attention.py    MonkeyPatch — replaces Qwen3Attention.forward with turbo path
└── quantizers.py         Lloyd-Max codebooks for 4-bit and 6-bit scalar quantization
```

The hybrid cache architecture:
```
Recent tokens (last N)  → fp16 window (exact)
Older tokens            → TurboQuant compressed (K→6bit, V→4bit)
                          attention scores computed on compressed keys directly
```

### Three Bugs Found and Fixed

**Bug 1: Large prefill evicts recent tokens (CRITICAL)**

When the prompt was longer than the window size (e.g. 2000 tokens, window=768), the entire prefill was compressed at once — including the most recent tokens. Fix: split eviction, compress only the oldest `excess` tokens, keep the newest `window_size` in fp16.

```python
# Wrong: compress everything
compressed = compress_chunk(cache[:, :, :, :])

# Right: only compress the oldest tokens
excess = total - window_size
compressed = compress_chunk(cache[:, :, :excess, :])
window    = cache[:, :, excess:, :]
```

**Bug 2: Continuous batching batch-size mismatch (crash)**

mlx-lm's server can grow batch dimension mid-decode when a second request joins (B=1 → B=2). HybridCache stored arrays with mixed batch sizes, crashing on `mx.concatenate`. Fix: track `_batch_size` in HybridCache, detect mismatch in attention, fall back to standard cache cleanly.

**Bug 3: V4/V6 asymmetry — values were quantized at 6-bit instead of 4-bit**

Comment said K→6bit, V→4bit but both quantize and dequantize paths used the 6-bit Lloyd-Max codebook for values. Corrected to use 4-bit codebook for values as specified.

### Test Results

- 27 unit tests: ~1s ✓
- 3 needle-in-haystack tests (2K, 4K, baseline): all pass on warm server ✓
- Warmup fixture required — MLX lazy eval produces garbage on the first request without a warmup pass

---

## Algorithm Reference

### TurboCode Structure (768-dim, 8-bit)

```
PolarCode:
  radii:   f32[] — vector norms per segment
  angles:  u16[] — quantized angular positions

QjlSketch:
  signs:   bit[] — 1 bit per random projection (residual correction)

Total: ~2545 bytes vs 3072 bytes fp32 original
```

### Bit Width Guide

| Use case | K bits | V bits | Total | Compression |
|----------|--------|--------|-------|-------------|
| Max quality | 6 | 4 | ~3.5 | 4x |
| Sweet spot | 4 | 3 | ~3.0 | 6x |
| Aggressive | 3 | 2 | ~2.5 | 8x, some degradation |

### Complementary: CakeKV (antgroup/cakekv)

CakeKV solves **eviction** (which tokens to drop) rather than compression (how to shrink remaining tokens). The two approaches stack: evict unimportant tokens with CakeKV, compress the survivors with TurboQuant. CakeKV has a `qwen2_attn_forward_cake` monkeypatch useful as a reference for hooking Qwen attention layers.

---

## Files Changed in Theorex

| File | Change |
|------|--------|
| `packages/turbo-quant-native/` | New — Rust napi-rs package |
| `src/rag/compressed-search.ts` | Hamming → innerProductEstimate |
| `src/rag/turbo-quant.test.ts` | NativeQuantizer binding tests |
| `src/rag/compressed-search.test.ts` | NativeQuantizer mock tests |
| `src/mcp/server.ts` | Removed getTurboMatrix() + matrix param |
| `scripts/backfill-turbo-quant.ts` | Re-encodes all concepts with real TurboCode |
| `scripts/backfill-compressed-vectors.ts` | Updated to NativeQuantizer |
| `scripts/benchmark-search.ts` | hammingScore → innerProductScore |
| ~~`src/rag/turbo-quant.ts`~~ | Deleted — legacy 32-byte JL/1-bit |

---

*Built 2026-03-31 → 2026-04-03*
