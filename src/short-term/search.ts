// src/short-term/search.ts — Hybrid BM25+vector search entry point.
// Gracefully degrades to BM25-only when LM Studio embedder is unavailable.
// Same function, different code path depending on embedder availability (null return).

import { readShortTermFiles, type ShortTermEntry } from "./store.ts";
import { buildBm25Index, bm25Search } from "./bm25.ts";
import { embedText, cosineSimilarity } from "./embedder.ts";
import { reciprocalRankFusion, type RankedId } from "./rrf.ts";

export interface SearchResult {
  readonly entry: ShortTermEntry;
  readonly score: number;
}

/**
 * Hybrid BM25 + vector search over short-term memory entries.
 *
 * If the LM Studio embedder is available (embedText returns non-null), uses
 * Reciprocal Rank Fusion to combine BM25 and vector results.
 *
 * If the embedder is unavailable (embedText returns null), degrades gracefully
 * to BM25-only results. Same function, no error thrown.
 *
 * @param query - Search query string
 * @param limit - Maximum results to return (default: 10)
 * @param config - Optional LM Studio connection config
 * @param stmDir - Optional override for short-term data directory
 */
export async function hybridSearch(
  query: string,
  limit = 10,
  config?: {
    lmStudioUrl?: string;
    lmStudioEmbedModel?: string;
    lmStudioTimeoutMs?: number;
  },
  stmDir?: string
): Promise<SearchResult[]> {
  const entries = await readShortTermFiles(stmDir);
  if (entries.length === 0) return [];

  // BM25 path (always runs)
  const engine = buildBm25Index(entries);
  const bm25Raw = bm25Search(engine, entries, query, limit * 2);
  const bm25Ranked: RankedId[] = bm25Raw.map((r, i) => ({ id: r.id, rank: i + 1 }));

  // Vector path (attempt, degrade gracefully on any failure)
  const queryVec = await embedText(
    query,
    config?.lmStudioUrl,
    config?.lmStudioEmbedModel,
    config?.lmStudioTimeoutMs
  );

  let vectorRanked: RankedId[] | null = null;
  if (queryVec !== null) {
    // Embed all entries using surface_form as the representative text
    const entryVecs = await Promise.all(
      entries.map(e =>
        embedText(
          e.surface_form,
          config?.lmStudioUrl,
          config?.lmStudioEmbedModel,
          config?.lmStudioTimeoutMs
        )
      )
    );
    const vectorScored = entries
      .map((e, i) => ({
        id: e.id,
        score: entryVecs[i] !== null ? cosineSimilarity(queryVec, entryVecs[i]!) : -1,
      }))
      .filter(r => r.score >= 0)
      .sort((a, b) => b.score - a.score);
    vectorRanked = vectorScored.map((r, i) => ({ id: r.id, rank: i + 1 }));
  }

  // RRF fusion (or BM25-only when vectorRanked is null)
  const fused = reciprocalRankFusion(bm25Ranked, vectorRanked);
  const entryById = new Map(entries.map(e => [e.id, e]));

  return fused
    .slice(0, limit)
    .map(r => ({ entry: entryById.get(r.id)!, score: r.score }))
    .filter(r => r.entry !== undefined);
}
