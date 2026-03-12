// src/short-term/rrf.ts — Reciprocal Rank Fusion combiner.
// Implements RRF formula: score(d) = sum(1 / (k + rank_i(d))) across all rank lists.
// k=60 is the standard constant from the original RRF paper (Cormack et al., 2009).

const RRF_K = 60;

/**
 * A document identifier with its 1-based rank in a result list.
 */
export interface RankedId {
  readonly id: string;
  readonly rank: number; // 1-based
}

/**
 * Fuse BM25 and vector rank lists using Reciprocal Rank Fusion.
 *
 * Formula: score(d) = sum(1 / (60 + rank_i(d))) across all provided rank lists.
 *
 * @param bm25Results - BM25 ranked results (always provided)
 * @param vectorResults - Vector ranked results, or null for BM25-only degradation
 * @returns Fused results sorted by descending score
 */
export function reciprocalRankFusion(
  bm25Results: RankedId[],
  vectorResults: RankedId[] | null
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  const addResults = (results: RankedId[]): void => {
    for (const { id, rank } of results) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
    }
  };

  addResults(bm25Results);
  if (vectorResults !== null) {
    addResults(vectorResults);
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
