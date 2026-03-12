// prune.test.ts — TDD tests for pruneAxon (archive LESS nodes past threshold, drop from graph)
// RED phase: these tests will fail until prune.ts is implemented.

import { test, expect, describe, afterEach } from "bun:test";
import { AxonStore } from "../../src/axon/store";
import { pruneAxon } from "../../src/axon/prune";
import type { Config } from "../../src/config";
import type { ConceptEvent } from "../../src/types";
import { unlink, rm, readdir, mkdir } from "node:fs/promises";

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
  ragBootstrapK: 5,
  ragBootstrapMinSimilarity: 0.4,
  ragSeedDissolutionDays: 7,
  ragEmbeddingStorePath: "data/concept-embeddings.json",
  ragOnnxModel: "Xenova/all-MiniLM-L6-v2",
};

function makeEvent(overrides: Partial<ConceptEvent> = {}): ConceptEvent {
  return {
    concept_id: 1,
    surface_form: "test concept",
    importance_score: 0.1,
    frequency_count: 1,
    composite_score: 0.1,
    source_weight: 0.5,
    node_type: "concept",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function tempDir(): string {
  return `/tmp/theorex-prune-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pruneAxon", () => {
  const cleanupPaths: string[] = [];
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths.splice(0)) {
      try { await unlink(p); } catch { /* ignore */ }
    }
    for (const d of cleanupDirs.splice(0)) {
      try { await rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("8. pruneAxon with no LESS nodes → no archive file created, graph unchanged", async () => {
    const dir = tempDir();
    const axonPath = dir + "/axon.json";
    const archiveDir = dir + "/archive";
    cleanupDirs.push(dir);

    await mkdir(dir, { recursive: true });
    const store = new AxonStore();
    // ACTIVE node (fresh)
    store.mergeNode(makeEvent({
      concept_id: 1,
      timestamp: new Date().toISOString(),
      frequency_count: 20, // high frequency keeps it ACTIVE
    }));
    // Set relevance_tier manually — note: store sets ACTIVE on creation
    await store.save(axonPath);

    const nowMs = Date.now();
    await pruneAxon(axonPath, archiveDir, DEFAULT_CFG, nowMs);

    // archiveDir should either not exist, or contain no pruned-*.jsonl files
    let archiveFiles: string[] = [];
    try {
      const entries = await readdir(archiveDir);
      archiveFiles = entries.filter(f => f.startsWith("pruned-"));
    } catch {
      // directory may not exist — that is fine
    }
    expect(archiveFiles.length).toBe(0);

    // Graph should still have 1 node
    const loaded = await AxonStore.load(axonPath);
    expect(loaded.graph.order).toBe(1);
  });

  test("9. pruneAxon with one LESS node past 30 days → archive file created in archiveDir", async () => {
    const dir = tempDir();
    const axonPath = dir + "/axon.json";
    const archiveDir = dir + "/archive";
    cleanupDirs.push(dir);

    const nowMs = Date.now();
    // 35 days ago = past 30-day threshold
    const oldTs = new Date(nowMs - 35 * DAY_MS).toISOString();

    await mkdir(dir, { recursive: true });
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 10, timestamp: oldTs, frequency_count: 1 }));
    // Manually set tier to LESS
    store.graph.setNodeAttribute("10", "relevance_tier", "LESS");
    await store.save(axonPath);

    await pruneAxon(axonPath, archiveDir, DEFAULT_CFG, nowMs);

    // Archive file must exist
    const entries = await readdir(archiveDir);
    const prunedFiles = entries.filter(f => f.startsWith("pruned-") && f.endsWith(".jsonl"));
    expect(prunedFiles.length).toBe(1);
  });

  test("10. archive file is JSONL format (each line parseable as JSON)", async () => {
    const dir = tempDir();
    const axonPath = dir + "/axon.json";
    const archiveDir = dir + "/archive";
    cleanupDirs.push(dir);

    const nowMs = Date.now();
    const oldTs = new Date(nowMs - 35 * DAY_MS).toISOString();

    await mkdir(dir, { recursive: true });
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 20, surface_form: "old concept", timestamp: oldTs, frequency_count: 2 }));
    store.graph.setNodeAttribute("20", "relevance_tier", "LESS");
    store.mergeNode(makeEvent({ concept_id: 21, surface_form: "another old", timestamp: oldTs, frequency_count: 1 }));
    store.graph.setNodeAttribute("21", "relevance_tier", "LESS");
    await store.save(axonPath);

    await pruneAxon(axonPath, archiveDir, DEFAULT_CFG, nowMs);

    const entries = await readdir(archiveDir);
    const prunedFile = entries.find(f => f.startsWith("pruned-") && f.endsWith(".jsonl"))!;
    const content = await Bun.file(`${archiveDir}/${prunedFile}`).text();

    // Each non-empty line must be valid JSON
    const lines = content.split("\n").filter(l => l.trim() !== "");
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const parsed = JSON.parse(line); // must not throw
      expect(parsed).toHaveProperty("concept_id");
      expect(parsed).toHaveProperty("surface_form");
      expect(parsed).toHaveProperty("archived_at");
      expect(parsed).toHaveProperty("relevance_tier", "LESS");
    }
  });

  test("11. pruned node is removed from graph after archive write", async () => {
    const dir = tempDir();
    const axonPath = dir + "/axon.json";
    const archiveDir = dir + "/archive";
    cleanupDirs.push(dir);

    const nowMs = Date.now();
    const oldTs = new Date(nowMs - 35 * DAY_MS).toISOString();

    await mkdir(dir, { recursive: true });
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 30, timestamp: oldTs, frequency_count: 1 }));
    store.graph.setNodeAttribute("30", "relevance_tier", "LESS");
    // Also keep one non-prunable node
    store.mergeNode(makeEvent({ concept_id: 31, timestamp: new Date(nowMs).toISOString(), frequency_count: 10 }));
    await store.save(axonPath);

    await pruneAxon(axonPath, archiveDir, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(axonPath);
    // Pruned node removed
    expect(loaded.graph.hasNode("30")).toBe(false);
    // Non-prunable node remains
    expect(loaded.graph.hasNode("31")).toBe(true);
    expect(loaded.graph.order).toBe(1);
  });

  test("12. LESS node within 30 days → NOT pruned (threshold respected)", async () => {
    const dir = tempDir();
    const axonPath = dir + "/axon.json";
    const archiveDir = dir + "/archive";
    cleanupDirs.push(dir);

    const nowMs = Date.now();
    // 20 days ago — within 30-day window, should NOT be pruned
    const recentTs = new Date(nowMs - 20 * DAY_MS).toISOString();

    await mkdir(dir, { recursive: true });
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 40, timestamp: recentTs, frequency_count: 1 }));
    store.graph.setNodeAttribute("40", "relevance_tier", "LESS");
    await store.save(axonPath);

    await pruneAxon(axonPath, archiveDir, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(axonPath);
    // Node should still be present
    expect(loaded.graph.hasNode("40")).toBe(true);
    expect(loaded.graph.order).toBe(1);

    // No archive file should be written
    let archiveFiles: string[] = [];
    try {
      const entries = await readdir(archiveDir);
      archiveFiles = entries.filter(f => f.startsWith("pruned-"));
    } catch { /* directory may not exist */ }
    expect(archiveFiles.length).toBe(0);
  });

  test("13. LESS node past threshold with PREFERRED sentiment → still pruned (sentiment orthogonal)", async () => {
    const dir = tempDir();
    const axonPath = dir + "/axon.json";
    const archiveDir = dir + "/archive";
    cleanupDirs.push(dir);

    const nowMs = Date.now();
    const oldTs = new Date(nowMs - 35 * DAY_MS).toISOString();

    await mkdir(dir, { recursive: true });
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 50, timestamp: oldTs, frequency_count: 1 }));
    store.graph.setNodeAttribute("50", "relevance_tier", "LESS");
    store.graph.setNodeAttribute("50", "sentiment_tier", "PREFERRED"); // sentiment does NOT protect
    await store.save(axonPath);

    await pruneAxon(axonPath, archiveDir, DEFAULT_CFG, nowMs);

    const loaded = await AxonStore.load(axonPath);
    // PREFERRED sentiment should NOT protect from pruning
    expect(loaded.graph.hasNode("50")).toBe(false);

    // Archive record should include the PREFERRED sentiment_tier
    const entries = await readdir(archiveDir);
    const prunedFile = entries.find(f => f.startsWith("pruned-") && f.endsWith(".jsonl"))!;
    const content = await Bun.file(`${archiveDir}/${prunedFile}`).text();
    const record = JSON.parse(content.trim());
    expect(record.sentiment_tier).toBe("PREFERRED");
  });

  test("14. archiveDir created if missing (no pre-existing directory)", async () => {
    const dir = tempDir();
    const axonPath = dir + "/axon.json";
    // Use a nested dir that definitely doesn't exist
    const archiveDir = dir + "/deep/nested/archive";
    cleanupDirs.push(dir);

    const nowMs = Date.now();
    const oldTs = new Date(nowMs - 35 * DAY_MS).toISOString();

    await mkdir(dir, { recursive: true });
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 60, timestamp: oldTs, frequency_count: 1 }));
    store.graph.setNodeAttribute("60", "relevance_tier", "LESS");
    await store.save(axonPath);

    // Should not throw even though archiveDir does not exist
    await expect(pruneAxon(axonPath, archiveDir, DEFAULT_CFG, nowMs)).resolves.toBeUndefined();

    // Archive file should exist in the nested dir
    const entries = await readdir(archiveDir);
    const prunedFiles = entries.filter(f => f.startsWith("pruned-") && f.endsWith(".jsonl"));
    expect(prunedFiles.length).toBe(1);
  });
});
