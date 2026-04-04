import type { DoomLoopResult } from "./types";

/**
 * Compute normalized Levenshtein similarity between two strings.
 * Returns 1.0 for identical, 0.0 for completely different.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  const distance = dp[m][n];
  return 1 - distance / Math.max(m, n);
}

/**
 * Detect doom loop from the last N outputs for an agent+task.
 * Loop = last 3 outputs all have pairwise similarity > threshold (default 0.9).
 */
export function isDoomLoop(
  recentOutputs: string[],
  threshold = 0.9,
  window = 3,
): DoomLoopResult {
  if (recentOutputs.length < window) {
    return { is_doom_loop: false, span_ids: [], similarity_score: 0 };
  }

  const last = recentOutputs.slice(-window);
  const s01 = levenshteinSimilarity(last[0], last[1]);
  const s12 = levenshteinSimilarity(last[1], last[2]);
  const s02 = levenshteinSimilarity(last[0], last[2]);
  const avg = (s01 + s12 + s02) / 3;

  return {
    is_doom_loop: avg >= threshold,
    span_ids: [],
    similarity_score: avg,
  };
}
