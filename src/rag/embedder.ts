// src/rag/embedder.ts
// ONNX embedding tier using @huggingface/transformers.
// Tier 1 (in src/short-term/embedder.ts): LM Studio HTTP (caller's responsibility).
// Tier 2 (this file): @huggingface/transformers ONNX.
// Tier 3: null → caller degrades to BM25-only (no seeding).
//
// INVARIANT: embedWithOnnx never throws — returns null on ANY failure.

// Note: @huggingface/transformers is imported dynamically — NOT at module top level.
// A static import triggers WASM initialization which causes Bun 1.3.10 to crash
// with SIGABRT on teardown, even when no pipeline function is ever called.

// Note: Plan 01 spike showed WASM backend is used automatically by Bun 1.3.10.
// No forced env.backends config needed — default pipeline() call works.

type PipelineFn = (texts: string[], opts: object) => Promise<{ tolist: () => unknown[][] }>;

// Cache keyed by model ID — supports hot-switching if model changes between calls.
const _pipelines = new Map<string, PipelineFn>();

async function getOnnxPipeline(modelId: string): Promise<PipelineFn | null> {
  const cached = _pipelines.get(modelId);
  if (cached) return cached;
  try {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = "./.cache/onnx-models";
    const pipe = await pipeline("feature-extraction", modelId, {
      device: "cpu",
    }) as PipelineFn;
    _pipelines.set(modelId, pipe);
    return pipe;
  } catch {
    return null; // ONNX unavailable — caller falls back to BM25-only
  }
}

/**
 * Embed text using the ONNX pipeline for the given model.
 * Returns null if modelId is empty/falsy or if the pipeline fails.
 */
export async function embedWithOnnx(text: string, modelId: string): Promise<number[] | null> {
  if (!modelId) return null; // ONNX tier disabled in config
  const pipe = await getOnnxPipeline(modelId);
  if (!pipe) return null;
  try {
    const out = await pipe([text], { pooling: "mean", normalize: true });
    return out.tolist()[0] as number[];
  } catch {
    return null;
  }
}
