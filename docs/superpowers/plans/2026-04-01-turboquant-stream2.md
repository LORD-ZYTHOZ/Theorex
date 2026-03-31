# TurboQuant Stream 2 — Qwen3 KV Cache Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stock `mlx_lm.server` PM2 process with a patched server (`turbo-kv`) that compresses Qwen3-32B KV cache using K6/V4 PolarQuant + 128-token fp16 rolling window, expanding effective context window ~2–3x.

**Architecture:** Standalone Python project at `/Users/eoh/turbo-kv/`. Monkey-patches `mlx_lm.models.qwen3.Attention` with `TurboQwen3Attention` before model load. Each compressible attention layer holds a `HybridCache` (128-token fp16 window + compressed K6/V4 history). Protected layers 0, 1, 62, 63 use standard KVCache. Entry point starts the stock `mlx_lm.server` HTTP server after patching.

**Tech Stack:** Python 3.9+, MLX, mlx-lm, NumPy, SciPy (centroid generation only), pytest, uvicorn not needed (mlx_lm uses stdlib HTTP)

> **Source-verified corrections vs spec:**
> - Patch target is `mlx_lm.models.qwen3.Attention` (not qwen2)
> - Qwen3 has `q_norm`/`k_norm` RMSNorm layers applied before RoPE — subclass must call them
> - RoPE via `self.rope(x, offset=N)` — inherited from parent, no mx.fast.rope call needed
> - HybridCache must implement `.offset: int` property and `.update_and_fetch(k,v)` returning `(k, v)`
> - mlx_lm.server is stdlib HTTP (BaseHTTPRequestHandler), not FastAPI
> - head_dim=128 confirmed ✓, 64 layers confirmed ✓

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| CREATE | `/Users/eoh/turbo-kv/requirements.txt` | Dependencies |
| CREATE | `/Users/eoh/turbo-kv/patches/__init__.py` | Package marker |
| CREATE | `/Users/eoh/turbo-kv/patches/turboquant_v3.py` | WHT rotation + Lloyd-Max K6/V4 quantize/dequantize |
| CREATE | `/Users/eoh/turbo-kv/patches/cache_manager.py` | HybridCache: offset tracking + fp16 window + compressed history |
| CREATE | `/Users/eoh/turbo-kv/patches/qwen3_attention.py` | TurboQwen3Attention subclass |
| CREATE | `/Users/eoh/turbo-kv/server.py` | Entry point: patch then run mlx_lm.server |
| CREATE | `/Users/eoh/turbo-kv/scripts/gen_centroids.py` | One-time: generate Lloyd-Max centroids via scipy |
| CREATE | `/Users/eoh/turbo-kv/patches/centroids.py` | Generated: K4/K6 centroid arrays as mx.array constants |
| CREATE | `/Users/eoh/turbo-kv/tests/test_turboquant_v3.py` | Unit tests for WHT + quantize/dequantize |
| CREATE | `/Users/eoh/turbo-kv/tests/test_cache_manager.py` | Unit tests for HybridCache |
| CREATE | `/Users/eoh/turbo-kv/tests/test_needle.py` | Integration: needle-in-haystack via HTTP |
| MODIFY | `/Users/eoh/.openclaw/projects/theorex/ecosystem.config.cjs` | PM2: point mlx server at turbo-kv/server.py |

---

## Task 1: Scaffold project

**Files:**
- Create: `/Users/eoh/turbo-kv/requirements.txt`
- Create: `/Users/eoh/turbo-kv/patches/__init__.py`
- Create: `/Users/eoh/turbo-kv/tests/__init__.py`
- Create: `/Users/eoh/turbo-kv/scripts/__init__.py`
- Create: `/Users/eoh/turbo-kv/pytest.ini`

- [ ] **Step 1: Create directories**

```bash
mkdir -p /Users/eoh/turbo-kv/patches /Users/eoh/turbo-kv/tests /Users/eoh/turbo-kv/scripts
```

- [ ] **Step 2: Write requirements.txt**

```
mlx>=0.21.0
mlx-lm>=0.20.0
numpy>=1.26.0
scipy>=1.13.0
pytest>=8.0.0
```

- [ ] **Step 3: Write pytest.ini**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
```

- [ ] **Step 4: Create package markers**

```bash
touch /Users/eoh/turbo-kv/patches/__init__.py
touch /Users/eoh/turbo-kv/tests/__init__.py
touch /Users/eoh/turbo-kv/scripts/__init__.py
```

- [ ] **Step 5: Install dependencies**

```bash
cd /Users/eoh/turbo-kv
pip install -r requirements.txt
```

- [ ] **Step 6: Verify mlx-lm imports**

```bash
python3 -c "import mlx_lm; from mlx_lm.models.qwen3 import Attention; print('ok', Attention)"
```

Expected: `ok <class 'mlx_lm.models.qwen3.Attention'>`

- [ ] **Step 7: Commit**

```bash
cd /Users/eoh/turbo-kv && git init && git add -A && git commit -m "chore: scaffold turbo-kv project"
```

---

## Task 2: Generate Lloyd-Max centroids

**Files:**
- Create: `/Users/eoh/turbo-kv/scripts/gen_centroids.py`
- Create: `/Users/eoh/turbo-kv/patches/centroids.py` (generated output)

Lloyd-Max quantization for N(0,1) — boundaries and centroids computed iteratively. Run once; output is committed as a constant file.

- [ ] **Step 1: Write gen_centroids.py**

```python
#!/usr/bin/env python3
"""
Generate Lloyd-Max centroids for standard normal N(0,1).
Outputs patches/centroids.py as frozen mlx.core arrays.

Run: python3 scripts/gen_centroids.py
"""

import numpy as np
from scipy import stats


def lloyd_max_normal(n_levels: int, n_iter: int = 500) -> np.ndarray:
    """
    Iterative Lloyd-Max algorithm for N(0,1).
    Returns centroids array of shape (n_levels,).
    """
    # Initial boundaries: equal-probability quantiles
    boundaries = stats.norm.ppf(np.linspace(0, 1, n_levels + 1)[1:-1])

    for _ in range(n_iter):
        ext = np.concatenate([[-np.inf], boundaries, [np.inf]])
        centroids = np.array([
            stats.norm.expect(
                lambda x: x,
                lb=float(ext[i]),
                ub=float(ext[i + 1]),
            ) / max(stats.norm.cdf(ext[i + 1]) - stats.norm.cdf(ext[i]), 1e-12)
            for i in range(n_levels)
        ])
        boundaries = (centroids[:-1] + centroids[1:]) / 2.0

    return centroids


def main() -> None:
    c4 = lloyd_max_normal(16)
    c6 = lloyd_max_normal(64)

    lines = [
        "# AUTO-GENERATED by scripts/gen_centroids.py — do not edit manually",
        "# Lloyd-Max centroids for standard normal N(0,1)",
        "import mlx.core as mx",
        "",
        f"LLOYD_MAX_4BIT: mx.array = mx.array({c4.tolist()}, dtype=mx.float32)",
        f"LLOYD_MAX_6BIT: mx.array = mx.array({c6.tolist()}, dtype=mx.float32)",
    ]

    out_path = "patches/centroids.py"
    with open(out_path, "w") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Written {out_path}  (4-bit: {len(c4)} centroids, 6-bit: {len(c6)} centroids)")
    print(f"4-bit sample: {c4[[0, 7, 8, -1]].round(4)}")
    print(f"6-bit sample: {c6[[0, 31, 32, -1]].round(4)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

```bash
cd /Users/eoh/turbo-kv && python3 scripts/gen_centroids.py
```

Expected output (approximate):
```
Written patches/centroids.py  (4-bit: 16 centroids, 6-bit: 64 centroids)
4-bit sample: [-2.7326 -0.0895  0.0895  2.7326]
6-bit sample: [-3.xxxx -0.xxxx  0.xxxx  3.xxxx]
```

- [ ] **Step 3: Verify the file loads**

```bash
python3 -c "from patches.centroids import LLOYD_MAX_4BIT, LLOYD_MAX_6BIT; print(LLOYD_MAX_4BIT.shape, LLOYD_MAX_6BIT.shape)"
```

Expected: `(16,) (64,)`

- [ ] **Step 4: Commit**

```bash
cd /Users/eoh/turbo-kv && git add patches/centroids.py scripts/gen_centroids.py && git commit -m "feat: generate Lloyd-Max K4/K6 centroids for N(0,1)"
```

---

## Task 3: Implement WHT + PolarQuant (TDD)

**Files:**
- Create: `/Users/eoh/turbo-kv/tests/test_turboquant_v3.py`
- Create: `/Users/eoh/turbo-kv/patches/turboquant_v3.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_turboquant_v3.py
import mlx.core as mx
import numpy as np
import pytest

from patches.turboquant_v3 import wht_rotation, quantize, dequantize
from patches.centroids import LLOYD_MAX_4BIT, LLOYD_MAX_6BIT


def make_vec(shape=(4, 8, 128), seed=42) -> mx.array:
    rng = np.random.default_rng(seed)
    return mx.array(rng.standard_normal(shape).astype(np.float32))


def test_wht_output_shape():
    x = make_vec((2, 4, 128))
    out = wht_rotation(x)
    assert out.shape == x.shape


def test_wht_is_near_isometry():
    """WHT is orthogonal — energy preserved (sum of squares unchanged)."""
    x = make_vec((1, 1, 128))
    out = wht_rotation(x)
    energy_in = float(mx.sum(x ** 2).item())
    energy_out = float(mx.sum(out ** 2).item())
    assert abs(energy_in - energy_out) / energy_in < 1e-4


def test_wht_requires_power_of_2():
    x = mx.zeros((1, 1, 100))  # not power of 2
    with pytest.raises(Exception):
        wht_rotation(x)


def test_quantize_output_shapes():
    x = make_vec((2, 8, 128))
    indices, scale = quantize(x, LLOYD_MAX_4BIT)
    assert indices.shape == x.shape
    assert scale.shape == (*x.shape[:-1], 1)


def test_quantize_indices_in_range_4bit():
    x = make_vec((1, 4, 128))
    indices, _ = quantize(x, LLOYD_MAX_4BIT)
    assert int(mx.min(indices).item()) >= 0
    assert int(mx.max(indices).item()) < 16


def test_quantize_indices_in_range_6bit():
    x = make_vec((1, 4, 128))
    indices, _ = quantize(x, LLOYD_MAX_6BIT)
    assert int(mx.min(indices).item()) >= 0
    assert int(mx.max(indices).item()) < 64


def test_dequantize_output_shape():
    x = make_vec((2, 8, 128))
    indices, scale = quantize(x, LLOYD_MAX_4BIT)
    out = dequantize(indices, scale, LLOYD_MAX_4BIT)
    assert out.shape == x.shape


def test_roundtrip_mse_4bit_below_threshold():
    """4-bit round-trip MSE after WHT rotation should be < 5% of input variance."""
    x = make_vec((1, 8, 128))
    rotated = wht_rotation(x)
    indices, scale = quantize(rotated, LLOYD_MAX_4BIT)
    reconstructed = dequantize(indices, scale, LLOYD_MAX_4BIT)
    mse = float(mx.mean((rotated - reconstructed) ** 2).item())
    variance = float(mx.mean(rotated ** 2).item())
    assert mse / variance < 0.05, f"MSE ratio {mse/variance:.4f} exceeds 5%"


def test_roundtrip_mse_6bit_below_threshold():
    """6-bit round-trip MSE should be < 0.5% of input variance."""
    x = make_vec((1, 8, 128))
    rotated = wht_rotation(x)
    indices, scale = quantize(rotated, LLOYD_MAX_6BIT)
    reconstructed = dequantize(indices, scale, LLOYD_MAX_6BIT)
    mse = float(mx.mean((rotated - reconstructed) ** 2).item())
    variance = float(mx.mean(rotated ** 2).item())
    assert mse / variance < 0.005, f"MSE ratio {mse/variance:.4f} exceeds 0.5%"
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/eoh/turbo-kv && python3 -m pytest tests/test_turboquant_v3.py -v 2>&1 | head -20
```

Expected: `ImportError: cannot import name 'wht_rotation' from 'patches.turboquant_v3'`

- [ ] **Step 3: Write turboquant_v3.py**

```python
# patches/turboquant_v3.py
"""
TurboQuant V3 — MSE-only PolarQuant for KV cache compression.
No QJL: softmax amplifies QJL variance, breaking attention. MSE-only confirmed
correct by 6+ independent implementations (tonbistudio/turboquant-pytorch V3).

Key ops:
  wht_rotation: Walsh-Hadamard Transform — spreads outliers to near-Gaussian
  quantize:     nearest-centroid scalar quantization with per-vector scale
  dequantize:   centroid lookup + scale restore → fp16-compatible mx.array
"""

import math

import mlx.core as mx


def wht_rotation(x: mx.array) -> mx.array:
    """
    Fast Walsh-Hadamard Transform over last dimension.
    Requires last dim to be a power of 2 (head_dim=128 ✓).
    O(n log n), deterministic, no random state.

    Args:
        x: (..., D) where D must be a power of 2
    Returns:
        (..., D) with same energy as input (isometric transform)
    Raises:
        ValueError: if last dim is not a power of 2
    """
    d = x.shape[-1]
    if d == 0 or (d & (d - 1)) != 0:
        raise ValueError(f"WHT requires last dim to be power of 2, got {d}")

    h = 1
    while h < d:
        # Split into even/odd strides of width h
        left = x[..., : d : 2 * h]   # shape (..., d/(2h), h) → broadcast
        right = x[..., h : d : 2 * h]
        x = mx.concatenate([left + right, left - right], axis=-1)
        h *= 2

    return x / math.sqrt(d)


def quantize(x: mx.array, centroids: mx.array) -> tuple[mx.array, mx.array]:
    """
    Nearest-centroid scalar quantization.

    Args:
        x:         (..., D) fp32/fp16 activation (post-WHT)
        centroids: (C,) Lloyd-Max centroids for N(0,1), e.g. LLOYD_MAX_4BIT or _6BIT
    Returns:
        indices: (..., D) int32 — centroid index per element, in [0, C)
        scale:   (..., 1)  fp32 — per-vector RMS scale factor
    """
    # Per-vector RMS normalization to match centroid distribution (N(0,1))
    scale = mx.sqrt(mx.mean(x ** 2, axis=-1, keepdims=True)) + 1e-6
    x_norm = x / scale

    # Find nearest centroid: (..., D, 1) vs (C,) → (..., D, C) → argmin over C
    dists = mx.abs(x_norm[..., None] - centroids)
    indices = mx.argmin(dists, axis=-1).astype(mx.int32)

    return indices, scale


def dequantize(
    indices: mx.array, scale: mx.array, centroids: mx.array
) -> mx.array:
    """
    Reconstruct fp32 from centroid indices and scale.

    Args:
        indices:   (..., D) int32 centroid indices
        scale:     (..., 1) fp32 per-vector scale
        centroids: (C,) Lloyd-Max centroids
    Returns:
        (..., D) fp32 reconstructed activations
    """
    return centroids[indices] * scale
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/eoh/turbo-kv && python3 -m pytest tests/test_turboquant_v3.py -v
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/turbo-kv && git add patches/turboquant_v3.py tests/test_turboquant_v3.py && git commit -m "feat: WHT rotation + Lloyd-Max PolarQuant V3"
```

---

## Task 4: Implement HybridCache (TDD)

**Files:**
- Create: `/Users/eoh/turbo-kv/tests/test_cache_manager.py`
- Create: `/Users/eoh/turbo-kv/patches/cache_manager.py`

The `HybridCache` is a drop-in replacement for `mlx_lm`'s `KVCache`. It must expose:
- `.offset: int` — total tokens processed (used by parent for RoPE positioning)
- `.update_and_fetch(keys, values) → (keys, values)` — appends new tokens, evicts old ones to compressed store, returns full fp16 K/V for attention

Keys shape throughout: `(B, n_kv_heads, L, head_dim)` — mlx-lm convention.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_cache_manager.py
import mlx.core as mx
import numpy as np
import pytest

from patches.cache_manager import HybridCache

HEAD_DIM = 128
N_KV_HEADS = 8
B = 1


def kv(seq_len: int, val: float = 1.0) -> tuple[mx.array, mx.array]:
    """Create dummy key/value pair of shape (B, n_kv_heads, seq_len, head_dim)."""
    shape = (B, N_KV_HEADS, seq_len, HEAD_DIM)
    k = mx.full(shape, val, dtype=mx.float32)
    v = mx.full(shape, val * 0.5, dtype=mx.float32)
    return k, v


def test_initial_offset_is_zero():
    cache = HybridCache()
    assert cache.offset == 0


def test_offset_increments_by_seq_len():
    cache = HybridCache(window_size=128)
    k, v = kv(10)
    cache.update_and_fetch(k, v)
    assert cache.offset == 10
    cache.update_and_fetch(k, v)
    assert cache.offset == 20


def test_output_shape_within_window():
    cache = HybridCache(window_size=128)
    k, v = kv(30)
    out_k, out_v = cache.update_and_fetch(k, v)
    assert out_k.shape == (B, N_KV_HEADS, 30, HEAD_DIM)
    assert out_v.shape == (B, N_KV_HEADS, 30, HEAD_DIM)


def test_output_grows_until_window_full():
    cache = HybridCache(window_size=128)
    k, v = kv(50)
    cache.update_and_fetch(k, v)
    out_k, _ = cache.update_and_fetch(k, v)
    assert out_k.shape[2] == 100  # 50+50


def test_output_seq_len_correct_after_eviction():
    """After window fills, evicted tokens go to compressed store but total grows."""
    cache = HybridCache(window_size=10)
    k, v = kv(6)
    cache.update_and_fetch(k, v)  # 6 tokens, all in window
    out_k, _ = cache.update_and_fetch(k, v)  # 12 total — 2 evicted, 10 in window
    # Total output = compressed history + fp16 window
    assert out_k.shape[2] == 12


def test_output_seq_len_keeps_growing():
    """Each step should return all tokens seen so far."""
    cache = HybridCache(window_size=8)
    k, v = kv(4)
    expected = 4
    for step in range(5):
        out_k, _ = cache.update_and_fetch(k, v)
        expected = (step + 1) * 4
        assert out_k.shape[2] == expected, f"step {step}: expected {expected}, got {out_k.shape[2]}"


def test_fp16_window_preserves_values():
    """Recent tokens (within window) should pass through losslessly."""
    cache = HybridCache(window_size=128)
    k, v = kv(5, val=3.14)
    out_k, out_v = cache.update_and_fetch(k, v)
    assert float(mx.mean(out_k).item()) == pytest.approx(3.14, rel=1e-4)
    assert float(mx.mean(out_v).item()) == pytest.approx(1.57, rel=1e-4)


def test_compressed_history_has_nonzero_values():
    """After eviction, the reconstructed compressed tokens should be non-zero."""
    cache = HybridCache(window_size=4)
    k, v = kv(5, val=1.0)  # 5 tokens → 1 evicted after second call
    cache.update_and_fetch(k, v)   # fills window
    out_k, _ = cache.update_and_fetch(k, v)   # triggers eviction
    # First token in output is from compressed history — should be approximately 1.0
    first = out_k[:, :, 0, :]
    assert float(mx.mean(mx.abs(first)).item()) > 0.5
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/eoh/turbo-kv && python3 -m pytest tests/test_cache_manager.py -v 2>&1 | head -10
```

Expected: `ImportError: cannot import name 'HybridCache'`

- [ ] **Step 3: Write cache_manager.py**

```python
# patches/cache_manager.py
"""
HybridCache — drop-in KVCache replacement for mlx_lm compressible layers.

Protocol (matches mlx_lm KVCache interface):
  .offset: int                               — total tokens processed
  .update_and_fetch(k, v) → (k, v)          — append tokens, return full history

KV shape convention (mlx-lm): (B, n_kv_heads, seq_len, head_dim)

Algorithm:
  1. New tokens appended to fp16 rolling window
  2. When window exceeds `window_size`, oldest tokens are WHT-rotated + quantized
  3. Compressed history is dequantized on every fetch → plain fp16 tensors for attention
  4. Returns: concatenate(dequantized_history, fp16_window) along seq_len axis (dim 2)
"""

from __future__ import annotations

import mlx.core as mx

from .centroids import LLOYD_MAX_4BIT, LLOYD_MAX_6BIT
from .turboquant_v3 import dequantize, quantize, wht_rotation


class HybridCache:
    """
    128-token fp16 rolling window + K6/V4 compressed history.

    Args:
        window_size: number of most-recent tokens to keep in fp16 (default 128)
    """

    def __init__(self, window_size: int = 128) -> None:
        self.window_size = window_size
        self._offset: int = 0

        # fp16 rolling window — list of (B, n_kv_heads, chunk_len, head_dim)
        self._window_k: list[mx.array] = []
        self._window_v: list[mx.array] = []
        self._window_tokens: int = 0

        # Compressed history — list of (indices, scale) tuples
        self._compressed_k: list[tuple[mx.array, mx.array]] = []
        self._compressed_v: list[tuple[mx.array, mx.array]] = []

    @property
    def offset(self) -> int:
        return self._offset

    def update_and_fetch(
        self, keys: mx.array, values: mx.array
    ) -> tuple[mx.array, mx.array]:
        """
        Append new keys/values, evict oldest tokens when window overflows.
        Returns full K/V history (compressed history + fp16 window) as fp32 arrays.

        Args:
            keys:   (B, n_kv_heads, new_len, head_dim)
            values: (B, n_kv_heads, new_len, head_dim)
        Returns:
            full_keys, full_values: (B, n_kv_heads, total_tokens, head_dim)
        """
        new_len = keys.shape[2]

        # Append new tokens to window
        self._window_k.append(keys)
        self._window_v.append(values)
        self._window_tokens += new_len
        self._offset += new_len

        # Evict oldest chunks while window is over capacity
        while self._window_tokens > self.window_size and self._window_k:
            evict_k = self._window_k.pop(0)
            evict_v = self._window_v.pop(0)
            evicted_len = evict_k.shape[2]
            self._window_tokens -= evicted_len

            # WHT rotation + PolarQuant: K→6bit, V→4bit
            rotated_k = wht_rotation(evict_k)
            rotated_v = wht_rotation(evict_v)
            self._compressed_k.append(quantize(rotated_k, LLOYD_MAX_6BIT))
            self._compressed_v.append(quantize(rotated_v, LLOYD_MAX_4BIT))

        # Dequantize compressed history → fp32
        history_k = [dequantize(idx, scale, LLOYD_MAX_6BIT) for idx, scale in self._compressed_k]
        history_v = [dequantize(idx, scale, LLOYD_MAX_4BIT) for idx, scale in self._compressed_v]

        # Assemble: compressed history + fp16 window
        all_k = mx.concatenate(history_k + self._window_k, axis=2) if history_k else mx.concatenate(self._window_k, axis=2)
        all_v = mx.concatenate(history_v + self._window_v, axis=2) if history_v else mx.concatenate(self._window_v, axis=2)

        return all_k, all_v
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/eoh/turbo-kv && python3 -m pytest tests/test_cache_manager.py -v
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/turbo-kv && git add patches/cache_manager.py tests/test_cache_manager.py && git commit -m "feat: HybridCache K6/V4 + fp16 rolling window"
```

---

## Task 5: Implement TurboQwen3Attention (TDD)

**Files:**
- Create: `/Users/eoh/turbo-kv/tests/test_qwen3_attention.py`
- Create: `/Users/eoh/turbo-kv/patches/qwen3_attention.py`

This subclasses the real `mlx_lm.models.qwen3.Attention`. We override `__init__` to add `layer_idx` and optionally a `HybridCache`, and override `__call__` to route through `self.turbo_cache` instead of the standard `cache` param for compressible layers.

Protected layers `{0, 1, 62, 63}` fall through to standard `cache.update_and_fetch()` — no compression.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_qwen3_attention.py
"""
Tests for TurboQwen3Attention.

We test integration with a REAL ModelArgs so the subclass inherits
actual weights, rope, q_norm, k_norm from the parent.
"""
import mlx.core as mx
import mlx.nn as nn
import pytest

from mlx_lm.models.qwen3 import ModelArgs
from patches.qwen3_attention import PROTECTED_LAYERS, TurboQwen3Attention
from patches.cache_manager import HybridCache


def make_args() -> ModelArgs:
    return ModelArgs(
        model_type="qwen3",
        hidden_size=512,         # small for test speed
        num_hidden_layers=64,
        intermediate_size=1024,
        num_attention_heads=8,
        num_key_value_heads=2,
        rms_norm_eps=1e-6,
        vocab_size=1000,
        max_position_embeddings=2048,
        rope_theta=10000.0,
        head_dim=64,             # 512 // 8 = 64, power of 2 ✓
        tie_word_embeddings=False,
    )


def make_input(seq_len: int = 4, batch: int = 1) -> mx.array:
    return mx.random.normal(shape=(batch, seq_len, 512))


def test_compressible_layer_has_turbo_cache():
    args = make_args()
    attn = TurboQwen3Attention(args, layer_idx=10)
    assert attn.turbo_cache is not None
    assert isinstance(attn.turbo_cache, HybridCache)


def test_protected_layer_has_no_turbo_cache():
    args = make_args()
    for idx in PROTECTED_LAYERS:
        attn = TurboQwen3Attention(args, layer_idx=idx)
        assert attn.turbo_cache is None, f"layer {idx} should be protected"


def test_protected_layers_set():
    assert PROTECTED_LAYERS == {0, 1, 62, 63}


def test_compressible_layer_forward_no_cache():
    """Forward pass without any cache — should not crash."""
    args = make_args()
    attn = TurboQwen3Attention(args, layer_idx=5)
    x = make_input(seq_len=4)
    out = attn(x, mask=None, cache=None)
    assert out.shape == (1, 4, 512)


def test_compressible_layer_offset_advances():
    args = make_args()
    attn = TurboQwen3Attention(args, layer_idx=5)
    x = make_input(seq_len=6)
    attn(x, mask=None, cache=None)
    assert attn.turbo_cache.offset == 6


def test_compressible_layer_output_shape_grows():
    """On second call, the attention sees all previous tokens (offset > 0)."""
    args = make_args()
    attn = TurboQwen3Attention(args, layer_idx=5)
    x4 = make_input(seq_len=4)
    x2 = make_input(seq_len=2)
    attn(x4, mask=None, cache=None)
    # Second call processes 2 new tokens, attends over 6 total
    out = attn(x2, mask=None, cache=None)
    assert out.shape == (1, 2, 512)


def test_protected_layer_uses_standard_cache():
    """Protected layers must use the provided cache, not turbo_cache."""
    from unittest.mock import MagicMock

    args = make_args()
    attn = TurboQwen3Attention(args, layer_idx=0)

    # Minimal mock cache that matches mlx_lm KVCache interface
    mock_cache = MagicMock()
    mock_cache.offset = 0
    mock_cache.update_and_fetch.return_value = (
        mx.zeros((1, 2, 4, 64)),  # keys
        mx.zeros((1, 2, 4, 64)),  # values
    )

    x = make_input(seq_len=4)
    attn(x, mask=None, cache=mock_cache)
    mock_cache.update_and_fetch.assert_called_once()
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/eoh/turbo-kv && python3 -m pytest tests/test_qwen3_attention.py -v 2>&1 | head -10
```

Expected: `ImportError: cannot import name 'TurboQwen3Attention'`

- [ ] **Step 3: Write qwen3_attention.py**

```python
# patches/qwen3_attention.py
"""
TurboQwen3Attention — mlx_lm.models.qwen3.Attention subclass with HybridCache.

Compressible layers (all except PROTECTED_LAYERS) use HybridCache instead of
the standard KVCache. Protected layers fall through to standard cache behavior.

PROTECTED_LAYERS: first 2 and last 2 (of 64 total) stay in fp16 — these layers
exhibit higher attention entropy and are disproportionately impacted by compression.
"""

from __future__ import annotations

from typing import Any, Optional

import mlx.core as mx

from mlx_lm.models.base import scaled_dot_product_attention
from mlx_lm.models.qwen3 import Attention, ModelArgs

from .cache_manager import HybridCache

PROTECTED_LAYERS: frozenset[int] = frozenset({0, 1, 62, 63})


class TurboQwen3Attention(Attention):
    """
    Drop-in replacement for qwen3.Attention with K6/V4 KV cache compression.

    Compressible layers own a HybridCache that replaces the standard KVCache
    for KV storage. The standard `cache` argument is used only for offset
    tracking on protected layers.
    """

    def __init__(self, args: ModelArgs, layer_idx: int) -> None:
        super().__init__(args)
        self.layer_idx = layer_idx
        self.turbo_cache: Optional[HybridCache] = (
            None if layer_idx in PROTECTED_LAYERS else HybridCache(window_size=128)
        )

    def __call__(
        self,
        x: mx.array,
        mask: Optional[mx.array] = None,
        cache: Optional[Any] = None,
    ) -> mx.array:
        B, L, D = x.shape

        queries, keys, values = self.q_proj(x), self.k_proj(x), self.v_proj(x)

        # Qwen3 applies QK-Norm before RoPE (unlike qwen2)
        queries = self.q_norm(queries.reshape(B, L, self.n_heads, -1)).transpose(0, 2, 1, 3)
        keys    = self.k_norm(keys.reshape(B, L, self.n_kv_heads, -1)).transpose(0, 2, 1, 3)
        values  = values.reshape(B, L, self.n_kv_heads, -1).transpose(0, 2, 1, 3)

        if self.turbo_cache is not None:
            # Compressible layer — use HybridCache for KV storage
            queries = self.rope(queries, offset=self.turbo_cache.offset)
            keys    = self.rope(keys,    offset=self.turbo_cache.offset)
            keys, values = self.turbo_cache.update_and_fetch(keys, values)
            # Pass cache=None so scaled_dot_product_attention doesn't try to use it
            output = scaled_dot_product_attention(
                queries, keys, values, cache=None, scale=self.scale, mask=mask
            )
        elif cache is not None:
            # Protected layer — standard KVCache behavior
            queries = self.rope(queries, offset=cache.offset)
            keys    = self.rope(keys,    offset=cache.offset)
            keys, values = cache.update_and_fetch(keys, values)
            output = scaled_dot_product_attention(
                queries, keys, values, cache=cache, scale=self.scale, mask=mask
            )
        else:
            # No cache (prefill without caching)
            queries = self.rope(queries)
            keys    = self.rope(keys)
            output = scaled_dot_product_attention(
                queries, keys, values, cache=None, scale=self.scale, mask=mask
            )

        output = output.transpose(0, 2, 1, 3).reshape(B, L, -1)
        return self.o_proj(output)
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/eoh/turbo-kv && python3 -m pytest tests/test_qwen3_attention.py -v
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/turbo-kv && git add patches/qwen3_attention.py tests/test_qwen3_attention.py && git commit -m "feat: TurboQwen3Attention subclass with HybridCache routing"
```

---

## Task 6: Write server.py and verify model loads

**Files:**
- Create: `/Users/eoh/turbo-kv/server.py`

The patch must happen before any mlx_lm module instantiates `Attention`. `ModelProvider.__init__` calls `self.load()` which calls `mlx_lm.utils.load()` which calls the model class constructors. Patching `mlx_lm.models.qwen3.Attention` before `ModelProvider` is instantiated is sufficient.

- [ ] **Step 1: Write server.py**

```python
#!/usr/bin/env python3
"""
turbo-kv server.py — PM2 entry point.

Patches mlx_lm.models.qwen3.Attention with TurboQwen3Attention BEFORE
ModelProvider is created (before any model weights are loaded).
Then hands off to the stock mlx_lm.server.run() for HTTP serving.

Usage (via PM2):
    python3 /Users/eoh/turbo-kv/server.py --model <path> --port 8082

Usage (manual test):
    python3 server.py --model ~/.cache/huggingface/hub/models--mlx-community--Qwen3-32B-4bit/snapshots/bcaaf7f538adf166c1080a2befdb4f6019f66639 --port 8082
"""

import logging
import sys

# ---------------------------------------------------------------------------
# Patch BEFORE any mlx_lm model instantiation
# ---------------------------------------------------------------------------
# mlx_lm.models.qwen3.Attention is instantiated inside TransformerBlock.__init__,
# which runs when mlx_lm.utils.load() constructs the model. Patching the class
# attribute here replaces ALL future instantiations.

import mlx_lm.models.qwen3 as _qwen3_module
from patches.qwen3_attention import TurboQwen3Attention

_original_attention = _qwen3_module.Attention
_qwen3_module.Attention = TurboQwen3Attention  # type: ignore[assignment]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s turbo-kv %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)
log.info("Patched mlx_lm.models.qwen3.Attention → TurboQwen3Attention")

# ---------------------------------------------------------------------------
# BUT: TransformerBlock passes only (args) to Attention.__init__, not layer_idx.
# We need to intercept TransformerBlock to pass layer_idx.
# ---------------------------------------------------------------------------
import mlx_lm.models.qwen3 as _q3

_OriginalTransformerBlock = _q3.TransformerBlock

class _PatchedTransformerBlock(_OriginalTransformerBlock):
    def __init__(self, args, layer_idx: int = -1):
        # Call nn.Module.__init__ directly, then rebuild with layer_idx
        import mlx.nn as nn
        nn.Module.__init__(self)
        self.num_attention_heads = args.num_attention_heads
        self.hidden_size = args.hidden_size
        # Use TurboQwen3Attention with actual layer_idx
        self.self_attn = TurboQwen3Attention(args, layer_idx=layer_idx)
        from mlx_lm.models.qwen3 import MLP
        self.mlp = MLP(args.hidden_size, args.intermediate_size)
        self.input_layernorm = nn.RMSNorm(args.hidden_size, eps=args.rms_norm_eps)
        self.post_attention_layernorm = nn.RMSNorm(args.hidden_size, eps=args.rms_norm_eps)
        self.args = args

_q3.TransformerBlock = _PatchedTransformerBlock  # type: ignore[assignment]

# Also patch the Model class to pass layer_idx to each TransformerBlock
_OriginalModel = _q3.Model

class _PatchedModel(_OriginalModel):
    def __init__(self, args):
        import mlx.nn as nn
        nn.Module.__init__(self)
        self.args = args
        from mlx_lm.models.qwen3 import Embedding
        self.model = _PatchedQwen3Model(args)
        if not args.tie_word_embeddings:
            self.lm_head = nn.Linear(args.hidden_size, args.vocab_size, bias=False)

class _PatchedQwen3Model:
    """Reconstructs layers list with correct layer_idx per TransformerBlock."""
    def __new__(cls, args):
        # Import the original Qwen3Model internals
        import mlx.nn as nn
        from mlx_lm.models.qwen3 import Qwen3Model
        obj = object.__new__(Qwen3Model)
        nn.Module.__init__(obj)
        from mlx_lm.models.qwen3 import Embedding as _Embedding
        obj.embed_tokens = _Embedding(args.vocab_size, args.hidden_size)
        obj.layers = [
            _PatchedTransformerBlock(args, layer_idx=i)
            for i in range(args.num_hidden_layers)
        ]
        obj.norm = nn.RMSNorm(args.hidden_size, eps=args.rms_norm_eps)
        return obj

_q3.Model = _PatchedModel  # type: ignore[assignment]

log.info("Patched TransformerBlock to inject layer_idx into TurboQwen3Attention")

# ---------------------------------------------------------------------------
# Now import and run the stock mlx_lm server
# ---------------------------------------------------------------------------
from mlx_lm.server import main

if __name__ == "__main__":
    log.info("Starting turbo-kv server (mlx_lm.server with TurboQwen3Attention)")
    main()
```

> **Note on the patch complexity:** The stock `TransformerBlock.__init__` calls `Attention(args)` with no `layer_idx`. We need `layer_idx` to decide which layers get `HybridCache`. The nested patch approach above intercepts `TransformerBlock` and `Model` to inject `layer_idx`. If the mlx_lm internals of `Model`/`Qwen3Model` change, this will need updating.

- [ ] **Step 2: Dry-run without actually loading the model**

```bash
cd /Users/eoh/turbo-kv && python3 -c "
import sys
sys.argv = ['server.py', '--model', '/nonexistent', '--port', '9999']
# Just verify the patch machinery imports without error
import mlx_lm.models.qwen3 as q3
from patches.qwen3_attention import TurboQwen3Attention
q3.Attention = TurboQwen3Attention
print('patch ok:', q3.Attention.__name__)
"
```

Expected: `patch ok: TurboQwen3Attention`

- [ ] **Step 3: Verify model loads with turbo-kv patch (takes ~60s)**

```bash
cd /Users/eoh/turbo-kv && python3 -c "
# Run the full patch then load the real model
exec(open('server.py').read().split('from mlx_lm.server')[0])
from mlx_lm.utils import load
MODEL = '/Users/eoh/.cache/huggingface/hub/models--mlx-community--Qwen3-32B-4bit/snapshots/bcaaf7f538adf166c1080a2befdb4f6019f66639'
model, tokenizer = load(MODEL)
# Check layer 10 has turbo cache, layer 0 does not
print('layer 10 turbo_cache:', model.model.layers[10].self_attn.turbo_cache)
print('layer 0  turbo_cache:', model.model.layers[0].self_attn.turbo_cache)
" 2>&1 | grep -E "turbo_cache|Error|Traceback"
```

Expected:
```
layer 10 turbo_cache: <patches.cache_manager.HybridCache object at 0x...>
layer 0  turbo_cache: None
```

If the model loading reveals differences in mlx_lm internals (e.g., `Qwen3Model` attributes differ), update `_PatchedQwen3Model.__new__` to match. Check via:
```bash
python3 -c "from mlx_lm.models.qwen3 import Qwen3Model; import inspect; print(inspect.getsource(Qwen3Model.__init__))"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/eoh/turbo-kv && git add server.py && git commit -m "feat: server.py — patch TransformerBlock + Model to inject layer_idx"
```

---

## Task 7: Update PM2 config

**Files:**
- Modify: Theorex `ecosystem.config.cjs` — find the mlx_lm server entry and replace it

- [ ] **Step 1: Find current mlx server PM2 entry**

```bash
grep -n "mlx\|qwen\|8082\|llm\|turbo" /Users/eoh/.openclaw/projects/theorex/ecosystem.config.cjs
```

Note the exact entry name and current script/args.

- [ ] **Step 2: Read the current config**

Read `/Users/eoh/.openclaw/projects/theorex/ecosystem.config.cjs`

- [ ] **Step 3: Replace the mlx_lm.server entry**

Find the entry that serves on port 8082. Replace its `script` and `args` to point at turbo-kv:

Before (example — adapt to actual content):
```js
{
  name: "mlx-server",
  script: "mlx_lm.server",
  interpreter: "python3",
  args: "--model /Users/eoh/.cache/.../Qwen3-32B-4bit/... --port 8082",
  ...
}
```

After:
```js
{
  name: "mlx-server",
  script: "/Users/eoh/turbo-kv/server.py",
  interpreter: "python3",
  args: "--model /Users/eoh/.cache/huggingface/hub/models--mlx-community--Qwen3-32B-4bit/snapshots/bcaaf7f538adf166c1080a2befdb4f6019f66639 --port 8082",
  ...
}
```

- [ ] **Step 4: Restart the PM2 process**

```bash
pm2 restart mlx-server 2>&1 | tail -5
```

Wait ~90 seconds for model to load, then check:

```bash
pm2 logs mlx-server --lines 20 2>&1 | grep -E "turbo-kv|TurboQwen3|Error|ready|listening"
```

Expected: lines mentioning `TurboQwen3Attention` and eventually the HTTP server listening on port 8082.

- [ ] **Step 5: Quick smoke test**

```bash
curl -s -X POST http://localhost:8082/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"default","messages":[{"role":"user","content":"Say hi"}],"max_tokens":10}' \
  | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['choices'][0]['message']['content'])"
```

Expected: a short response (e.g., `Hi!`)

- [ ] **Step 6: Commit ecosystem config**

```bash
cd /Users/eoh/.openclaw/projects/theorex && git add ecosystem.config.cjs && git commit -m "feat(pm2): switch mlx-server to turbo-kv patched server"
```

---

## Task 8: Needle-in-haystack validation

**Files:**
- Create: `/Users/eoh/turbo-kv/tests/test_needle.py`

Validates that TurboQwen3Attention doesn't degrade retrieval at extended context. Tests both short (≤2K) and medium (≤4K) contexts.

- [ ] **Step 1: Write test_needle.py**

```python
# tests/test_needle.py
"""
Needle-in-haystack integration test for turbo-kv.

Hides a unique fact deep in a long document and verifies the model
retrieves it correctly. Tests at two context lengths: 2K and 4K tokens.

Requires turbo-kv server running on localhost:8082.
Run: pytest tests/test_needle.py -v -m integration
"""

import json
import urllib.request

import pytest


ENDPOINT = "http://localhost:8082/v1/chat/completions"
MODEL = "default"


def chat(prompt: str, max_tokens: int = 50) -> str:
    payload = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.0,
    }).encode()

    req = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def make_haystack(needle_sentence: str, filler_words: int, position_frac: float = 0.5) -> str:
    """
    Insert needle_sentence into filler text at approximately position_frac.
    filler_words controls total context length.
    """
    filler = ("The quick brown fox jumps over the lazy dog. " * (filler_words // 10 + 1))
    words = filler.split()
    insert_at = int(len(words) * position_frac)
    words.insert(insert_at, needle_sentence)
    return " ".join(words[:filler_words])


NEEDLE = "The secret code for the vault is TURBO-KV-42."
QUESTION = "What is the secret code for the vault? Reply with only the code."


@pytest.mark.integration
def test_needle_2k_context():
    """Model must retrieve needle from ~2000-token context."""
    document = make_haystack(NEEDLE, filler_words=1400, position_frac=0.5)
    prompt = f"Read the following document carefully:\n\n{document}\n\n{QUESTION}"
    response = chat(prompt, max_tokens=30)
    assert "TURBO-KV-42" in response, (
        f"Needle not found in 2K context response: {response!r}"
    )


@pytest.mark.integration
def test_needle_4k_context():
    """Model must retrieve needle from ~4000-token context."""
    document = make_haystack(NEEDLE, filler_words=2800, position_frac=0.6)
    prompt = f"Read the following document carefully:\n\n{document}\n\n{QUESTION}"
    response = chat(prompt, max_tokens=30)
    assert "TURBO-KV-42" in response, (
        f"Needle not found in 4K context response: {response!r}"
    )


@pytest.mark.integration
def test_baseline_without_needle():
    """Control: model should NOT hallucinate the code when needle is absent."""
    document = make_haystack("", filler_words=500, position_frac=0.5)
    prompt = f"Read the following document carefully:\n\n{document}\n\n{QUESTION}"
    response = chat(prompt, max_tokens=30)
    assert "TURBO-KV-42" not in response, (
        f"Model hallucinated needle: {response!r}"
    )
```

- [ ] **Step 2: Run needle tests against live server**

```bash
cd /Users/eoh/turbo-kv && python3 -m pytest tests/test_needle.py -v -m integration
```

Expected: all 3 tests pass.

If `test_needle_4k_context` fails but `test_needle_2k_context` passes: the compression is losing context at 4K. Likely fix: increase `window_size` from 128 to 256, or investigate which layers are bottlenecking with `pm2 logs mlx-server`.

- [ ] **Step 3: Commit**

```bash
cd /Users/eoh/turbo-kv && git add tests/test_needle.py && git commit -m "test: needle-in-haystack integration validation for turbo-kv"
```

---

## Self-Review

**Spec coverage:**
- ✅ Standalone `/Users/eoh/turbo-kv/` project — Task 1
- ✅ WHT rotation — Task 3 `turboquant_v3.py`
- ✅ K6/V4 PolarQuant — Task 3 `turboquant_v3.py` + Task 2 centroids
- ✅ 128-token fp16 rolling window — Task 4 `HybridCache`
- ✅ Protected layers {0,1,62,63} — Task 5 `PROTECTED_LAYERS`
- ✅ RoPE-correct patching (post-RoPE key interception) — Task 5, Task 6
- ✅ PM2 update — Task 7
- ✅ Needle-in-haystack validation — Task 8

**Spec correction applied:** layer_idx injection requires patching `TransformerBlock` and `Model`, not just `Attention`. This is more invasive than the spec anticipated but necessary — documented in Task 6.

**Type consistency check:**
- `HybridCache.update_and_fetch` signature matches across Tasks 4 and 5
- `wht_rotation`, `quantize`, `dequantize` signatures match across Tasks 3 and 4
- `TurboQwen3Attention.__init__(args, layer_idx)` consistent across Tasks 5 and 6
- `PROTECTED_LAYERS: frozenset[int]` consistent across Tasks 5 and 6

**No placeholders:** all steps have complete code.
