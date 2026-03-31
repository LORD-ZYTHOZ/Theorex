/**
 * Ollama embedder — generates 768d embeddings via nomic-embed-text.
 * Replaces LM Studio embed dependency.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const TIMEOUT_MS = 10_000;

/**
 * Generate an embedding vector for a single text string.
 * Returns null on failure — callers should handle gracefully.
 */
export async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const data = await res.json() as { embeddings?: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Batch embed multiple texts. Returns array of vectors (null for failures).
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  return Promise.all(texts.map(embedText));
}
