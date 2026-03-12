// scorer.ts — Pure scoring functions for concept relevance.
// All functions accept explicit parameters (no I/O, no side effects).
// nowMs parameter enables deterministic testing with injected clocks.

import type { Config } from "../config";

/** Subset of Config needed by scoring functions. */
export type ScoringConfig = Pick<Config, "halfLifeDays" | "activeThreshold" | "mildThreshold">;

/**
 * Exponential decay recency score.
 * lastSeen=now → 1.0; at halfLifeDays → 0.5; at 2×halfLifeDays → 0.25.
 */
export function recencyScore(
  lastSeen: string,
  nowMs: number,
  halfLifeDays: number,
): number {
  const lambda = Math.LN2 / halfLifeDays;
  const daysElapsed = (nowMs - new Date(lastSeen).getTime()) / 86_400_000;
  return Math.exp(-lambda * daysElapsed);
}

/**
 * Log-normalized frequency score.
 * count=0 → 0.0; count=100 → 1.0 (cap).
 * Formula: min(log(1 + n) / log(101), 1.0)
 */
export function frequencyScore(frequencyCount: number): number {
  return Math.min(Math.log(1 + frequencyCount) / Math.log(101), 1.0);
}

/**
 * Average strength of neighbor edges, capped at 1.0.
 * Empty array → 0.0.
 */
export function coOccurrenceScore(neighborStrengths: number[]): number {
  const len = neighborStrengths.length;
  if (len === 0) return 0.0;
  const sum = neighborStrengths.reduce((acc, s) => acc + s, 0);
  return Math.min(sum / len, 1.0);
}

/**
 * Composite relevance score.
 * Weights: 0.40 × recency + 0.35 × frequency + 0.25 × coOccurrence.
 */
export function compositeScore(
  lastSeen: string,
  frequencyCount: number,
  neighborStrengths: number[],
  nowMs: number,
  config: ScoringConfig,
): number {
  const r = recencyScore(lastSeen, nowMs, config.halfLifeDays);
  const f = frequencyScore(frequencyCount);
  const c = coOccurrenceScore(neighborStrengths);
  return 0.40 * r + 0.35 * f + 0.25 * c;
}

/**
 * Map a composite score to a relevance tier.
 * ACTIVE ≥ activeThreshold; MILD ≥ mildThreshold; else LESS.
 */
export function classifyTier(
  score: number,
  config: ScoringConfig,
): "ACTIVE" | "MILD" | "LESS" {
  if (score >= config.activeThreshold) return "ACTIVE";
  if (score >= config.mildThreshold) return "MILD";
  return "LESS";
}
