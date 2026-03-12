// scan.test.ts — TDD tests for scanAxon (re-score all nodes, decay edges, write axon.json)
// RED phase: these tests will fail until scan.ts is implemented.

import { test, expect, describe, afterEach } from "bun:test";
import { AxonStore } from "../../src/axon/store";
import { scanAxon } from "../../src/axon/scan";
import type { Config } from "../../src/config";
import type { ConceptEvent } from "../../src/types";
import { unlink, rm } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const DEFAULT_CFG: Config = {
  halfLifeDays: 14,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
  pruneThresholdDays: 30,
  edgePruneThreshold: 0.01,
};

function makeEvent(overrides: Partial<ConceptEvent> = {}): ConceptEvent {
  return {
    concept_id: 1,
    surface_form: "machine learning",
    importance_score: 1.0,
    frequency_count: 5,
    composite_score: 1.0,
    source_weight: 1.0,
    node_type: "concept",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function tempPath(): string {
  return `/tmp/theorex-scan-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scanAxon", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths.splice(0)) {
      try { await unlink(p); } catch { /* ignore ENOENT */ }
    }
  });

  test("1. returns without error when axon.json does not exist (cold start)", async () => {
    const path = tempPath();
    // do NOT create the file — cold start
    await expect(scanAxon(path, DEFAULT_CFG)).resolves.toBeUndefined();
  });

  test("2. node last_seen=now gets importance_weight updated and relevance_tier set", async () => {
    const path = tempPath();
    cleanupPaths.push(path);
    const nowMs = Date.now();

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 1,
      // frequency_count=20: freqScore ≈ log(21)/log(101) ≈ 0.648
      // composite = 0.40*1.0 + 0.35*0.648 + 0 ≈ 0.627 ≥ 0.6 → ACTIVE
      frequency_count: 20,
      timestamp: new Date(nowMs).toISOString(),
    }));
    await store.save(path);

    await scanAxon(path, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(path);
    const attrs = loaded.graph.getNodeAttributes("1");

    // importance_weight should be updated (compositeScore is non-zero since last_seen = now)
    expect(attrs.importance_weight).toBeGreaterThan(0);
    // relevance_tier should be set (ACTIVE since node is fresh with high frequency)
    expect(["ACTIVE", "MILD", "LESS"]).toContain(attrs.relevance_tier);
    expect(attrs.relevance_tier).toBe("ACTIVE"); // recency=1.0, high freq → ACTIVE
  });

  test("3. node last_seen 28 days ago: recency decayed, tier updated accordingly", async () => {
    const path = tempPath();
    cleanupPaths.push(path);
    const nowMs = Date.now();
    const lastSeen = new Date(nowMs - 28 * DAY_MS).toISOString();

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 2,
      frequency_count: 1, // low frequency
      timestamp: lastSeen,
    }));
    await store.save(path);

    await scanAxon(path, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(path);
    const attrs = loaded.graph.getNodeAttributes("2");

    // 28 days ago with halfLife=14 → recency = exp(-LN2/14*28) = 0.25
    // freqScore(1) = log(2)/log(101) ≈ 0.1505
    // composite = 0.40*0.25 + 0.35*0.1505 + 0.25*0 ≈ 0.1 + 0.0527 = 0.1527
    // 0.1527 < 0.3 → LESS
    expect(attrs.importance_weight).toBeCloseTo(0.1527, 3);
    expect(attrs.relevance_tier).toBe("LESS");
  });

  test("4. two connected nodes: co-occurrence score contributes to composite", async () => {
    const path = tempPath();
    cleanupPaths.push(path);
    const nowMs = Date.now();

    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 10, frequency_count: 1, timestamp: new Date(nowMs).toISOString() }));
    store.mergeNode(makeEvent({ concept_id: 11, frequency_count: 1, timestamp: new Date(nowMs).toISOString() }));
    store.mergeEdge(10, 11, new Date(nowMs).toISOString());
    await store.save(path);

    // Scan with connected node
    await scanAxon(path, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(path);
    const attrsA = loaded.graph.getNodeAttributes("10");
    const attrsB = loaded.graph.getNodeAttributes("11");

    // Both nodes have a neighbor with strength 0.1 → coOccurrenceScore = 0.1
    // composite = 0.40*1.0 + 0.35*freqScore(1) + 0.25*0.1 > 0.40*1.0 + 0.35*freqScore(1) + 0
    expect(attrsA.importance_weight).toBeGreaterThan(0.4);
    expect(attrsB.importance_weight).toBeGreaterThan(0.4);
  });

  test("5. edge that hasn't been seen in 15 days decays in strength during scanAxon", async () => {
    const path = tempPath();
    cleanupPaths.push(path);
    const nowMs = Date.now();
    const edgeTs = new Date(nowMs - 15 * DAY_MS).toISOString();
    const nodeTs = new Date(nowMs).toISOString();

    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 20, frequency_count: 5, timestamp: nodeTs }));
    store.mergeNode(makeEvent({ concept_id: 21, frequency_count: 5, timestamp: nodeTs }));
    store.mergeEdge(20, 21, edgeTs); // edge last_co_occurrence is 15 days ago
    await store.save(path);

    await scanAxon(path, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(path);
    // After 15 days decay with halfLife=14: strength × exp(-LN2/14 × 15)
    // 0.1 × exp(-0.04951 × 15) = 0.1 × exp(-0.7426) ≈ 0.1 × 0.4761 ≈ 0.0476
    const edgeKey = loaded.graph.edge("20", "21");
    expect(edgeKey).not.toBeUndefined();
    if (edgeKey) {
      const edgeAttrs = loaded.graph.getEdgeAttributes(edgeKey);
      expect(edgeAttrs.strength).toBeCloseTo(0.0476, 3);
    }
  });

  test("6. edge with strength below 0.01 after decay is dropped from graph", async () => {
    const path = tempPath();
    cleanupPaths.push(path);
    const nowMs = Date.now();
    // Edge strength 0.1, need to decay below 0.01: need >33 days
    // 0.1 × exp(-LN2/14 × 50) = 0.1 × exp(-2.475) ≈ 0.1 × 0.0841 ≈ 0.00841 < 0.01
    const edgeTs = new Date(nowMs - 50 * DAY_MS).toISOString();
    const nodeTs = new Date(nowMs).toISOString();

    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 30, frequency_count: 5, timestamp: nodeTs }));
    store.mergeNode(makeEvent({ concept_id: 31, frequency_count: 5, timestamp: nodeTs }));
    store.mergeEdge(30, 31, edgeTs);
    await store.save(path);

    // Verify edge exists before scan
    const beforeStore = await AxonStore.load(path);
    expect(beforeStore.graph.size).toBe(1);

    await scanAxon(path, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(path);
    // Edge should be dropped since decayed strength < 0.01
    expect(loaded.graph.size).toBe(0);
  });

  test("7. scanAxon writes updated axon.json at the correct path", async () => {
    const path = tempPath();
    cleanupPaths.push(path);
    const nowMs = Date.now();

    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 40, frequency_count: 3, timestamp: new Date(nowMs).toISOString() }));
    await store.save(path);

    const statBefore = await Bun.file(path).json();
    await scanAxon(path, DEFAULT_CFG, nowMs);
    const statAfter = await Bun.file(path).json();

    // File must exist and have been updated (nodes with new importance_weight)
    expect(statAfter).not.toBeNull();
    // The serialized output should be valid JSON with node attributes
    const loaded = await AxonStore.load(path);
    expect(loaded.graph.order).toBe(1);
    const attrs = loaded.graph.getNodeAttributes("40");
    // importance_weight should now be the compositeScore result
    expect(attrs.importance_weight).toBeGreaterThan(0);
  });
});
