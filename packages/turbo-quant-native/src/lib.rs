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
