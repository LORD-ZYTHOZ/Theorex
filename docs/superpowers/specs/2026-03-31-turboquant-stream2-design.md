# Stage 4B — TurboQuant V3 Native MLX Server (Stream 2)

**Date:** 2026-03-31
**Status:** Approved — ready for implementation

---

## 1. Objective

Create a standalone Python project (`turbo-kv`) at `/Users/eoh/turbo-kv/` to serve Qwen3-32B-4bit with native MLX KV cache compression. Replaces the stock `mlx_lm.server` PM2 process with a patched server implementing asymmetric K6/V4 PolarQuant compression (TurboQuant V3 — no QJL). Intercepts keys post-RoPE, dequantizes on-the-fly for attention. Target: ~2.5–3x context window expansion, zero generation degradation.

**Why no QJL:** Softmax exponentially amplifies QJL variance. 6+ independent teams confirmed MSE-only beats MSE+QJL for attention. QJL works for vector search (Stream 1) but breaks KV cache compression.

---

## 2. Architecture & File Structure

```
/Users/eoh/turbo-kv/
├── requirements.txt          # mlx, mlx-lm, uvicorn, fastapi, numpy
├── server.py                 # PM2 entry point — class-level patch before model load
└── patches/
    ├── __init__.py
    ├── turboquant_v3.py      # WHT rotation + theoretical Gaussian Lloyd-Max K6/V4
    ├── cache_manager.py      # 128-token fp16 rolling window + JIT dequantization
    └── qwen2_attention.py    # RoPE-aware Attention subclass
```

**Not in the Theorex repo** — standalone project, separate PM2 process.

---

## 3. Core Algorithm: TurboQuant V3 (PolarQuant only, no QJL)

### Step 1: Outlier Spreading — Walsh-Hadamard Transform (WHT)
```python
# turboquant_v3.py
# WHT forces activations into near-Gaussian distribution, enabling
# theoretical centroids without calibration pass
import mlx.core as mx

def wht_rotation(x: mx.array) -> mx.array:
    """Fast Walsh-Hadamard Transform. O(n log n), deterministic."""
    n = x.shape[-1]
    h = 1
    while h < n:
        x = mx.concatenate([x[..., :n:2*h] + x[..., h:n:2*h],
                             x[..., :n:2*h] - x[..., h:n:2*h]], axis=-1)
        h *= 2
    return x / mx.sqrt(mx.array(float(n)))
```

### Step 2: Theoretical Gaussian Lloyd-Max Quantization (K6/V4)
Because WHT guarantees Gaussian shape, centroids are precomputed from standard normal — no calibration pass needed.

```python
# Pre-computed Lloyd-Max centroids for standard normal N(0,1)
# Source: theoretical values, validated against tonbistudio/turboquant-pytorch lloyd_max.py
LLOYD_MAX_4BIT = mx.array([...])   # 16 centroids, 15 boundaries
LLOYD_MAX_6BIT = mx.array([...])   # 64 centroids, 63 boundaries
# (populate from lloyd_max.py port during implementation)

def quantize(x: mx.array, centroids: mx.array) -> tuple[mx.array, mx.array]:
    """Quantize x to nearest centroid. Returns (indices, scale)."""
    scale = mx.sqrt(mx.mean(x ** 2, axis=-1, keepdims=True))
    x_norm = x / (scale + 1e-6)
    # Find nearest centroid index
    dists = mx.abs(x_norm[..., None] - centroids)
    indices = mx.argmin(dists, axis=-1)
    return indices, scale

def dequantize(indices: mx.array, scale: mx.array, centroids: mx.array) -> mx.array:
    """Reconstruct fp16 from centroid indices and scale."""
    return centroids[indices] * scale
```

**Asymmetric allocation:**
- Keys → 6-bit (norms 172–778 in Qwen3, need precision for sharp attention peaks)
- Values → 4-bit (norms 2–4, errors cancel naturally in weighted sum)

---

## 4. Cache Manager (`patches/cache_manager.py`)

```python
class HybridCache:
    """
    128-token fp16 rolling window + compressed K6/V4 history.
    Dequantizes history to fp16 on fetch — returns plain mx.array
    ready for mx.fast.scaled_dot_product_attention.
    """
    def __init__(self, window_size: int = 128):
        self.window_size = window_size
        self.fp16_window_k: list[mx.array] = []
        self.fp16_window_v: list[mx.array] = []
        self.compressed_k: list[tuple[mx.array, mx.array]] = []  # (indices, scale)
        self.compressed_v: list[tuple[mx.array, mx.array]] = []

    def update_and_fetch(
        self,
        new_k: mx.array,  # post-RoPE keys, fp16
        new_v: mx.array,  # values, fp16
    ) -> tuple[mx.array, mx.array]:
        # Add new tokens to fp16 window
        self.fp16_window_k.append(new_k)
        self.fp16_window_v.append(new_v)

        # Evict oldest tokens when window exceeds 128
        while len(self.fp16_window_k) > self.window_size:
            evict_k = self.fp16_window_k.pop(0)
            evict_v = self.fp16_window_v.pop(0)
            # Rotate + compress evicted tokens
            rotated_k = wht_rotation(evict_k)
            rotated_v = wht_rotation(evict_v)
            self.compressed_k.append(quantize(rotated_k, LLOYD_MAX_6BIT))
            self.compressed_v.append(quantize(rotated_v, LLOYD_MAX_4BIT))

        # Dequantize compressed history to fp16
        history_k = [dequantize(i, s, LLOYD_MAX_6BIT) for i, s in self.compressed_k]
        history_v = [dequantize(i, s, LLOYD_MAX_4BIT) for i, s in self.compressed_v]

        # Concatenate history + fp16 window → standard mx.array for attention
        all_k = mx.concatenate(history_k + self.fp16_window_k, axis=-2) if history_k else mx.concatenate(self.fp16_window_k, axis=-2)
        all_v = mx.concatenate(history_v + self.fp16_window_v, axis=-2) if history_v else mx.concatenate(self.fp16_window_v, axis=-2)
        return all_k, all_v
```

---

## 5. Attention Patch (`patches/qwen2_attention.py`)

Subclasses the original `Attention` module. Protected layers bypass `HybridCache` entirely.

```python
import mlx.core as mx
import mlx.nn as nn
from mlx_lm.models.qwen2 import Attention as OriginalAttention
from .cache_manager import HybridCache

PROTECTED_LAYERS = {0, 1, 62, 63}  # Qwen3-32B has 64 layers

class TurboQwen2Attention(OriginalAttention):
    def __init__(self, args, layer_idx: int):
        super().__init__(args)
        self.layer_idx = layer_idx
        self.turbo_cache = HybridCache(window_size=128) if layer_idx not in PROTECTED_LAYERS else None

    def __call__(self, x, mask=None, cache=None):
        # Standard QKV projection
        queries, keys, values = self.q_proj(x), self.k_proj(x), self.v_proj(x)

        # Reshape for multi-head attention
        B, L, _ = x.shape
        queries = queries.reshape(B, L, self.n_heads, -1).transpose(0, 2, 1, 3)
        keys    = keys.reshape(B, L, self.n_kv_heads, -1).transpose(0, 2, 1, 3)
        values  = values.reshape(B, L, self.n_kv_heads, -1).transpose(0, 2, 1, 3)

        # Apply RoPE — MUST happen before compression
        queries, keys = mx.fast.rope(queries, keys, traditional=False, base=self.rope_base, scale=1.0, offset=cache.offset if cache else 0)

        # Intercept post-RoPE keys/values into HybridCache (compressible layers only)
        if self.turbo_cache is not None:
            keys, values = self.turbo_cache.update_and_fetch(keys, values)
        elif cache is not None:
            keys, values = cache.update_and_fetch(keys, values)

        # Standard scaled dot-product attention over assembled fp16 tensors
        output = mx.fast.scaled_dot_product_attention(queries, keys, values, scale=self.scale, mask=mask)
        output = output.transpose(0, 2, 1, 3).reshape(B, L, -1)
        return self.o_proj(output)
```

---

## 6. Entry Point (`server.py`)

Class-level patch happens **before** any mlx_lm module loads the model — ensures all instantiated `Attention` objects use our subclass.

```python
# /Users/eoh/turbo-kv/server.py
import mlx_lm.models.qwen2
from patches.qwen2_attention import TurboQwen2Attention

# Patch BEFORE model load — mlx_lm will instantiate TurboQwen2Attention
mlx_lm.models.qwen2.Attention = TurboQwen2Attention

MODEL_PATH = "/Users/eoh/.cache/huggingface/hub/models--mlx-community--Qwen3-32B-4bit/snapshots/bcaaf7f538adf166c1080a2befdb4f6019f66639"

if __name__ == "__main__":
    import uvicorn
    from mlx_lm.server import app

    # NOTE: Verify mlx_lm.server's actual model-loading API before implementation.
    # May be: mlx_lm.server.load_model(MODEL_PATH) or app.state injection.
    # Source: https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py

    uvicorn.run(app, host="127.0.0.1", port=8082)
```

---

## 7. PM2 Update

In `ecosystem.config.cjs` (wherever Hades/m4 PM2 config lives):

```js
// Before:
{ script: "mlx_lm.server", args: "--model ... --port 8082" }

// After:
{ script: "/Users/eoh/turbo-kv/server.py", interpreter: "python3", args: "" }
```

---

## 8. Validation

Needle-in-haystack test (mirrors tonbistudio approach):
1. Baseline: run Qwen3-32B unpatched, hide a fact in a long document, confirm retrieval
2. Patched: same test with turbo-kv running, verify same retrieval at 2K and 4K context
3. Compression verified: log compressed token count vs raw token count

---

## 9. Open Implementation Questions (resolve during plan phase)

1. **`mlx_lm.server` model-loading API** — verify `load_model()` exists or find actual hook. Check `mlx_lm/server.py` source.
2. **`mx.fast.rope` signature** — verify exact args (`traditional`, `base`, `scale`, `offset`) against current mlx version on m4.
3. **Lloyd-Max centroid values** — port `lloyd_max.py` from tonbistudio/turboquant-pytorch, generate 4-bit and 6-bit tables once.
4. **WHT dimension constraint** — WHT requires power-of-2 dimension. Qwen3-32B head_dim needs verification (likely 128 — fine).
