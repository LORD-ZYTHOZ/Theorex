// tests/gated-learning.test.ts — Gated learning update acceptance tests.
// Covers: shouldAcceptUpdate logic, saveSnapshot atomic write + version increment,
// loadLatestSnapshot on empty/missing dir.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  shouldAcceptUpdate,
  saveSnapshot,
  loadLatestSnapshot,
  type PolicyMetrics,
} from "../evolve/gated-learning";

const TMP = join(tmpdir(), "theorex-gated-learning-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// shouldAcceptUpdate
// ---------------------------------------------------------------------------

describe("shouldAcceptUpdate()", () => {
  test("after.avg_composite_score=0.85, before=0.80 → accepted (6.25% > 2%)", () => {
    const before: PolicyMetrics = {
      promotion_count: 8,
      avg_composite_score: 0.80,
      success_rate: 0.8,
      sample_count: 10,
    };
    const after: PolicyMetrics = {
      promotion_count: 9,
      avg_composite_score: 0.85,
      success_rate: 0.85,
      sample_count: 10,
    };
    const result = shouldAcceptUpdate(before, after);
    expect(result.accepted).toBe(true);
    expect(result.improvement_pct).toBeCloseTo(0.0625, 4); // 6.25%
    expect(result.reason).toContain("Accepted");
  });

  test("after.avg_composite_score=0.81, before=0.80 → rejected (1.25% < 2%)", () => {
    const before: PolicyMetrics = {
      promotion_count: 8,
      avg_composite_score: 0.80,
      success_rate: 0.8,
      sample_count: 10,
    };
    const after: PolicyMetrics = {
      promotion_count: 8,
      avg_composite_score: 0.81,
      success_rate: 0.81,
      sample_count: 10,
    };
    const result = shouldAcceptUpdate(before, after);
    expect(result.accepted).toBe(false);
    expect(result.improvement_pct).toBeCloseTo(0.0125, 4); // 1.25%
    expect(result.reason).toContain("Rejected");
  });

  test("sample_count < 5 → always accepted regardless of score change", () => {
    const before: PolicyMetrics = {
      promotion_count: 2,
      avg_composite_score: 0.9,
      success_rate: 0.9,
      sample_count: 4,
    };
    const after: PolicyMetrics = {
      promotion_count: 2,
      avg_composite_score: 0.5, // much worse score
      success_rate: 0.5,
      sample_count: 4,
    };
    const result = shouldAcceptUpdate(before, after);
    expect(result.accepted).toBe(true);
    expect(result.reason).toContain("Insufficient data");
  });

  test("sample_count=0 (after) → always accepted", () => {
    const before: PolicyMetrics = {
      promotion_count: 0,
      avg_composite_score: 0.5,
      success_rate: 0.5,
      sample_count: 0,
    };
    const after: PolicyMetrics = {
      promotion_count: 0,
      avg_composite_score: 0.0,
      success_rate: 0.0,
      sample_count: 0,
    };
    const result = shouldAcceptUpdate(before, after);
    expect(result.accepted).toBe(true);
  });

  test("improvement just above threshold (2.1%) → accepted", () => {
    // required = 0.80 * 1.02 = 0.8160000000000001 (floating point)
    // Use a value clearly above the threshold to avoid float precision edge cases
    const before: PolicyMetrics = {
      promotion_count: 5,
      avg_composite_score: 0.80,
      success_rate: 0.8,
      sample_count: 10,
    };
    const after: PolicyMetrics = {
      promotion_count: 5,
      avg_composite_score: 0.817, // clearly > 0.80 * 1.02
      success_rate: 0.817,
      sample_count: 10,
    };
    const result = shouldAcceptUpdate(before, after);
    expect(result.accepted).toBe(true);
    expect(result.improvement_pct).toBeGreaterThan(0.02);
  });

  test("custom threshold of 5%: 4% improvement → rejected", () => {
    const before: PolicyMetrics = {
      promotion_count: 5,
      avg_composite_score: 0.80,
      success_rate: 0.8,
      sample_count: 10,
    };
    const after: PolicyMetrics = {
      promotion_count: 5,
      avg_composite_score: 0.832, // 4% improvement
      success_rate: 0.832,
      sample_count: 10,
    };
    const result = shouldAcceptUpdate(before, after, 0.05);
    expect(result.accepted).toBe(false);
  });

  test("result contains before, after, and improvement_pct fields", () => {
    const before: PolicyMetrics = {
      promotion_count: 5,
      avg_composite_score: 0.70,
      success_rate: 0.7,
      sample_count: 10,
    };
    const after: PolicyMetrics = {
      promotion_count: 8,
      avg_composite_score: 0.80,
      success_rate: 0.8,
      sample_count: 12,
    };
    const result = shouldAcceptUpdate(before, after);
    expect(result.before).toBe(before);
    expect(result.after).toBe(after);
    expect(typeof result.improvement_pct).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// saveSnapshot
// ---------------------------------------------------------------------------

describe("saveSnapshot()", () => {
  test("writes a file and returns a PolicySnapshot with correct fields", async () => {
    const snapshotsDir = join(TMP, "snapshots-write");
    const metrics: PolicyMetrics = {
      promotion_count: 5,
      avg_composite_score: 0.75,
      success_rate: 0.75,
      sample_count: 8,
    };

    const snapshot = await saveSnapshot(metrics, snapshotsDir);

    expect(snapshot.version).toBeGreaterThan(0);
    expect(snapshot.metrics).toEqual(metrics);
    expect(typeof snapshot.config_hash).toBe("string");
    expect(snapshot.config_hash.length).toBeGreaterThan(0);
    expect(new Date(snapshot.timestamp).getFullYear()).toBeGreaterThan(2020);

    // File must exist
    const filePath = join(snapshotsDir, `${snapshot.version}.json`);
    const exists = await Bun.file(filePath).exists();
    expect(exists).toBe(true);
  });

  test("auto-increments version on successive saves", async () => {
    const snapshotsDir = join(TMP, "snapshots-increment");
    const metrics: PolicyMetrics = {
      promotion_count: 3,
      avg_composite_score: 0.6,
      success_rate: 0.6,
      sample_count: 5,
    };

    const snap1 = await saveSnapshot(metrics, snapshotsDir);
    const snap2 = await saveSnapshot(metrics, snapshotsDir);
    const snap3 = await saveSnapshot(metrics, snapshotsDir);

    expect(snap2.version).toBe(snap1.version + 1);
    expect(snap3.version).toBe(snap2.version + 1);
  });

  test("creates snapshotsDir if it does not exist", async () => {
    const snapshotsDir = join(TMP, "snapshots-autocreate-" + Date.now());
    const metrics: PolicyMetrics = {
      promotion_count: 1,
      avg_composite_score: 0.5,
      success_rate: 0.5,
      sample_count: 5,
    };

    // Dir must not pre-exist
    const dirExists = await Bun.file(snapshotsDir).exists();
    expect(dirExists).toBe(false);

    const snapshot = await saveSnapshot(metrics, snapshotsDir);
    expect(snapshot.version).toBe(1);

    const fileExists = await Bun.file(join(snapshotsDir, "1.json")).exists();
    expect(fileExists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadLatestSnapshot
// ---------------------------------------------------------------------------

describe("loadLatestSnapshot()", () => {
  test("returns null if no snapshots directory exists", async () => {
    const result = await loadLatestSnapshot(join(TMP, "no-such-snapshots-dir"));
    expect(result).toBeNull();
  });

  test("returns null if snapshots directory exists but is empty", async () => {
    const emptyDir = join(TMP, "snapshots-empty");
    await mkdir(emptyDir, { recursive: true });
    const result = await loadLatestSnapshot(emptyDir);
    expect(result).toBeNull();
  });

  test("returns the snapshot with the highest version number", async () => {
    const snapshotsDir = join(TMP, "snapshots-latest");

    const metricsV1: PolicyMetrics = {
      promotion_count: 3,
      avg_composite_score: 0.6,
      success_rate: 0.6,
      sample_count: 5,
    };
    const metricsV2: PolicyMetrics = {
      promotion_count: 7,
      avg_composite_score: 0.75,
      success_rate: 0.75,
      sample_count: 10,
    };

    await saveSnapshot(metricsV1, snapshotsDir);
    const snap2 = await saveSnapshot(metricsV2, snapshotsDir);

    const latest = await loadLatestSnapshot(snapshotsDir);
    expect(latest).not.toBeNull();
    expect(latest?.version).toBe(snap2.version);
    expect(latest?.metrics.avg_composite_score).toBeCloseTo(0.75, 3);
  });
});
