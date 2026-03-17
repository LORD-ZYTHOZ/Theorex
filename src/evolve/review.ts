// evolve/review.ts — Nightly outcome review for Phase 13 Living Code.
// Reads recent outcomes, computes pattern success rates, and produces an EvolutionReport.
// The report is then consumed by refine.ts to write axon observations.

import { readOutcomesSince } from "./outcome";
import type { OutcomeRecord } from "./outcome";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternStats {
  readonly pattern: string;        // tag or concept label
  readonly total: number;          // outcomes involving this pattern
  readonly successes: number;      // successful outcomes
  readonly failures: number;       // failed outcomes
  readonly win_rate: number;       // successes / total (0–1)
  readonly trend: "rising" | "stable" | "declining"; // simple trend
}

export interface EvolutionReport {
  readonly timestamp: string;        // ISO 8601 — when this report was generated
  readonly agent_id: string;
  readonly window_days: number;      // how many days of outcomes were reviewed
  readonly total_outcomes: number;
  readonly successful: number;
  readonly failed: number;
  readonly overall_win_rate: number; // 0–1
  readonly top_patterns: readonly PatternStats[];    // patterns with highest win rate (min 2 outcomes)
  readonly weak_patterns: readonly PatternStats[];   // patterns with lowest win rate (min 2 outcomes)
  readonly insights: readonly string[];              // human-readable improvement notes
}

// ---------------------------------------------------------------------------
// reviewOutcomes
// ---------------------------------------------------------------------------

/**
 * Review outcomes from the last `windowDays` days for `agentId`.
 * Returns an EvolutionReport with pattern stats and human-readable insights.
 */
export async function reviewOutcomes(
  agentId: string,
  windowDays: number,
  outcomesDir: string
): Promise<EvolutionReport> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const all = await readOutcomesSince(since, outcomesDir);

  // Filter to this agent (or include all if agentId === "all")
  const outcomes = agentId === "all"
    ? all
    : all.filter((o) => o.agent_id === agentId);

  const total = outcomes.length;
  const successful = outcomes.filter((o) => o.success).length;
  const failed = total - successful;
  const overall_win_rate = total > 0 ? successful / total : 0;

  // Build pattern stats from tags
  const patternMap = new Map<string, { successes: number; failures: number }>();

  for (const outcome of outcomes) {
    for (const tag of outcome.tags) {
      const existing = patternMap.get(tag) ?? { successes: 0, failures: 0 };
      patternMap.set(tag, {
        successes: existing.successes + (outcome.success ? 1 : 0),
        failures: existing.failures + (outcome.success ? 0 : 1),
      });
    }
  }

  const patternStats: PatternStats[] = [];
  for (const [pattern, { successes, failures }] of patternMap) {
    const patternTotal = successes + failures;
    if (patternTotal < 2) continue; // need at least 2 data points
    const win_rate = successes / patternTotal;
    patternStats.push({
      pattern,
      total: patternTotal,
      successes,
      failures,
      win_rate,
      trend: classifyTrend(outcomes, pattern),
    });
  }

  const sorted = [...patternStats].sort((a, b) => b.win_rate - a.win_rate);
  const top_patterns = sorted.slice(0, 5);
  const weak_patterns = [...patternStats].sort((a, b) => a.win_rate - b.win_rate).slice(0, 5);

  const insights = buildInsights({
    total,
    successful,
    failed,
    overall_win_rate,
    top_patterns,
    weak_patterns,
    outcomes,
  });

  return {
    timestamp: new Date().toISOString(),
    agent_id: agentId,
    window_days: windowDays,
    total_outcomes: total,
    successful,
    failed,
    overall_win_rate,
    top_patterns,
    weak_patterns,
    insights,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify trend for a tag by comparing first half vs second half of outcomes.
 * "rising" = win rate improving, "declining" = dropping, "stable" = within 10%.
 */
function classifyTrend(outcomes: readonly OutcomeRecord[], tag: string): "rising" | "stable" | "declining" {
  const tagged = outcomes
    .filter((o) => o.tags.includes(tag))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (tagged.length < 4) return "stable";

  const mid = Math.floor(tagged.length / 2);
  const firstHalf = tagged.slice(0, mid);
  const secondHalf = tagged.slice(mid);

  const firstWR = firstHalf.filter((o) => o.success).length / firstHalf.length;
  const secondWR = secondHalf.filter((o) => o.success).length / secondHalf.length;

  const delta = secondWR - firstWR;
  if (delta > 0.1) return "rising";
  if (delta < -0.1) return "declining";
  return "stable";
}

/**
 * Generate human-readable insights from the review.
 */
function buildInsights(params: {
  total: number;
  successful: number;
  failed: number;
  overall_win_rate: number;
  top_patterns: readonly PatternStats[];
  weak_patterns: readonly PatternStats[];
  outcomes: readonly OutcomeRecord[];
}): string[] {
  const insights: string[] = [];
  const { total, successful, failed, overall_win_rate, top_patterns, weak_patterns } = params;

  if (total === 0) {
    insights.push("No outcomes recorded yet. Start using `theorex outcome` to track decisions and results.");
    return insights;
  }

  // Overall summary
  insights.push(
    `Reviewed ${total} outcome${total !== 1 ? "s" : ""}: ${successful} succeeded, ${failed} failed (${Math.round(overall_win_rate * 100)}% win rate).`
  );

  // Strong patterns
  const rising = top_patterns.filter((p) => p.trend === "rising" && p.win_rate >= 0.7);
  for (const p of rising) {
    insights.push(`Pattern "${p.pattern}" is trending up — ${Math.round(p.win_rate * 100)}% win rate. Lean into it.`);
  }

  const strongStable = top_patterns.filter((p) => p.trend !== "declining" && p.win_rate >= 0.8);
  for (const p of strongStable.slice(0, 2)) {
    if (!rising.includes(p)) {
      insights.push(`Pattern "${p.pattern}" is consistently strong — ${Math.round(p.win_rate * 100)}% win rate.`);
    }
  }

  // Weak patterns
  const declining = weak_patterns.filter((p) => p.trend === "declining" || p.win_rate <= 0.3);
  for (const p of declining.slice(0, 2)) {
    insights.push(`Pattern "${p.pattern}" is underperforming — ${Math.round(p.win_rate * 100)}% win rate. Review approach.`);
  }

  // High failure count
  if (failed > successful && total >= 5) {
    insights.push("More failures than successes. Consider reviewing decision criteria before next cycle.");
  }

  return insights;
}
