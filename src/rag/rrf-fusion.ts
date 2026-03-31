/**
 * Reciprocal Rank Fusion (RRF) for merging multi-query search results.
 * Standard RRF formula: score(d) = Σ 1 / (k + rank(d, list_i))
 * k=60 is the standard constant (balances depth vs. top-rank boost).
 */

export interface RankedResult {
  readonly id: string;
  readonly label: string;
  readonly body: string | null;
  readonly memory_type: string;
  readonly agent_id: string;
  readonly meta: Record<string, unknown>;
  readonly score: number;
}

const RRF_K = 60;

/**
 * Fuse multiple ranked result lists into a single ranked list via RRF.
 * Results are identified by their `id` field; scores are summed across lists.
 */
export function rrfFuse(resultLists: RankedResult[][], limit = 10): RankedResult[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, RankedResult>();

  for (const list of resultLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrfScore);
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ ...byId.get(id)!, score }));
}
