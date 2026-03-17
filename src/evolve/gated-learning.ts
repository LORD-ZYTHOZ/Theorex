// evolve/gated-learning.ts — Gated learning for Phase 13 / OpenJarvis-inspired.
// Only accepts routing/promotion policy updates when they measurably improve
// avg_composite_score by at least a configurable threshold (default 2%).
// All state is immutable; snapshots are written atomically via .tmp swap.

import { mkdir, readdir, rename } from "node:fs/promises";
import { computeCompositeScore, readOutcomes } from "./outcome";

export const DEFAULT_OUTCOMES_DIR = "data/outcomes";
export const DEFAULT_SNAPSHOTS_DIR = "data/policy-snapshots";
const MIN_SAMPLES = 5;
const DEFAULT_THRESHOLD = 0.02;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicySnapshot {
  readonly version: number;
  readonly timestamp: string;
  readonly metrics: PolicyMetrics;
  readonly config_hash: string; // hash of key config values at snapshot time
}

export interface PolicyMetrics {
  readonly promotion_count: number;
  readonly avg_composite_score: number; // from computeCompositeScore
  readonly success_rate: number;
  readonly sample_count: number;
}

export interface GatedUpdateResult {
  readonly accepted: boolean;
  readonly reason: string;
  readonly before: PolicyMetrics;
  readonly after: PolicyMetrics;
  readonly improvement_pct: number;
}

// ---------------------------------------------------------------------------
// evaluateCurrentPolicy
// ---------------------------------------------------------------------------

/**
 * Read all OutcomeRecords from outcomesDir, compute PolicyMetrics.
 * Requires minimum 5 samples to produce meaningful metrics; if fewer,
 * returns a partial metrics object with sample_count < 5 and zeroed scores.
 */
export async function evaluateCurrentPolicy(
  outcomesDir: string = DEFAULT_OUTCOMES_DIR
): Promise<PolicyMetrics> {
  const outcomes = await readOutcomes(outcomesDir);
  const sample_count = outcomes.length;

  if (sample_count < MIN_SAMPLES) {
    return {
      promotion_count: outcomes.filter((o) => o.success).length,
      avg_composite_score: 0,
      success_rate: 0,
      sample_count,
    };
  }

  const promotion_count = outcomes.filter((o) => o.success).length;
  const success_rate = promotion_count / sample_count;
  const total_composite = outcomes.reduce(
    (sum, o) => sum + computeCompositeScore(o),
    0
  );
  const avg_composite_score = total_composite / sample_count;

  return {
    promotion_count,
    avg_composite_score,
    success_rate,
    sample_count,
  };
}

// ---------------------------------------------------------------------------
// shouldAcceptUpdate
// ---------------------------------------------------------------------------

/**
 * Compare before/after PolicyMetrics and decide whether to accept the update.
 * - If sample_count < 5 → accept unconditionally (not enough data to gate).
 * - If after.avg_composite_score >= before * (1 + threshold) → accept.
 * - Otherwise → reject.
 * Default threshold: 0.02 (2%).
 */
export function shouldAcceptUpdate(
  before: PolicyMetrics,
  after: PolicyMetrics,
  threshold: number = DEFAULT_THRESHOLD
): GatedUpdateResult {
  const improvement_pct =
    before.avg_composite_score > 0
      ? (after.avg_composite_score - before.avg_composite_score) /
        before.avg_composite_score
      : 0;

  if (after.sample_count < MIN_SAMPLES) {
    return {
      accepted: true,
      reason: `Insufficient data (${after.sample_count} samples < ${MIN_SAMPLES} minimum). Accepting by default.`,
      before,
      after,
      improvement_pct,
    };
  }

  const required = before.avg_composite_score * (1 + threshold);
  const accepted = after.avg_composite_score >= required;
  const pctFormatted = (improvement_pct * 100).toFixed(2);
  const thresholdFormatted = (threshold * 100).toFixed(0);

  const reason = accepted
    ? `Accepted: avg_composite_score improved by ${pctFormatted}% (threshold ${thresholdFormatted}%).`
    : `Rejected: avg_composite_score changed by ${pctFormatted}% — below required ${thresholdFormatted}% threshold.`;

  return { accepted, reason, before, after, improvement_pct };
}

// ---------------------------------------------------------------------------
// saveSnapshot
// ---------------------------------------------------------------------------

/**
 * Write a PolicySnapshot to {snapshotsDir}/{version}.json atomically.
 * Auto-increments version by reading existing files.
 */
export async function saveSnapshot(
  metrics: PolicyMetrics,
  snapshotsDir: string = DEFAULT_SNAPSHOTS_DIR
): Promise<PolicySnapshot> {
  await mkdir(snapshotsDir, { recursive: true });

  const version = await nextSnapshotVersion(snapshotsDir);
  const snapshot: PolicySnapshot = {
    version,
    timestamp: new Date().toISOString(),
    metrics,
    config_hash: buildConfigHash(metrics),
  };

  const filePath = `${snapshotsDir}/${version}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(snapshot, null, 2));
  await rename(tmpPath, filePath);

  return snapshot;
}

// ---------------------------------------------------------------------------
// loadLatestSnapshot
// ---------------------------------------------------------------------------

/**
 * Read data/policy-snapshots/, find highest version number, return it.
 * Returns null if no snapshots exist.
 */
export async function loadLatestSnapshot(
  snapshotsDir: string = DEFAULT_SNAPSHOTS_DIR
): Promise<PolicySnapshot | null> {
  let entries: string[];
  try {
    entries = await readdir(snapshotsDir);
  } catch {
    return null;
  }

  const versions = parseSnapshotVersions(entries);
  if (versions.length === 0) return null;

  const maxVersion = Math.max(...versions);
  try {
    const raw = await Bun.file(`${snapshotsDir}/${maxVersion}.json`).json();
    return raw as PolicySnapshot;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function nextSnapshotVersion(snapshotsDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(snapshotsDir);
  } catch {
    return 1;
  }
  const versions = parseSnapshotVersions(entries);
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

function parseSnapshotVersions(entries: string[]): number[] {
  return entries
    .filter((e) => e.endsWith(".json") && !e.endsWith(".tmp"))
    .map((e) => parseInt(e.replace(".json", ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Produce a short deterministic hash string from PolicyMetrics key values.
 * Used as a lightweight config fingerprint at snapshot time.
 */
function buildConfigHash(metrics: PolicyMetrics): string {
  const payload = [
    metrics.sample_count,
    metrics.avg_composite_score.toFixed(6),
    metrics.success_rate.toFixed(6),
    metrics.promotion_count,
  ].join("|");
  // Bun.hash returns bigint — convert to hex string for a stable config_hash
  return Bun.hash(payload).toString(16);
}
