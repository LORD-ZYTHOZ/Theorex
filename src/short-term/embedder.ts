// src/short-term/embedder.ts — LM Studio embedding client with graceful degradation.
// CRITICAL: cosineSimilarity uses reduce() not Math.hypot(...vec) spread.
//   Math.hypot spread fails for large embedding dims (>~1000 args) due to stack limits.

const EMBED_TIMEOUT_MS = 3000;

/**
 * Fetch a text embedding from LM Studio's /v1/embeddings endpoint.
 * Returns number[] on success, null on any failure (network error, timeout, non-200).
 * Never throws — all failure modes produce null for graceful degradation.
 */
export async function embedText(
  text: string,
  lmStudioUrl = "http://localhost:11434",
  model = "nomic-embed-text",
  timeoutMs = EMBED_TIMEOUT_MS
): Promise<number[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${lmStudioUrl}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [text], model }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute cosine similarity between two equal-length vectors.
 * Uses reduce() internally — safe for large embedding dimensions (e.g. 768, 1536, 3072).
 * Throws if vectors have different lengths.
 * Returns 0 if either vector is a zero vector.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}
