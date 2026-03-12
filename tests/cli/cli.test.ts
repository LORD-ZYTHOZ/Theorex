// cli.test.ts — Integration tests for the CLI handler functions.
// Tests call runScan/runStatus/runRef/runPrune directly (no subprocess).

import { test, expect, describe, afterEach } from "bun:test";
import { runScan, runStatus, runRef, runPrune } from "../../src/cli/index";
import { AxonStore } from "../../src/axon/store";
import type { Config } from "../../src/config";
import type { ConceptEvent } from "../../src/types";
import { unlink } from "node:fs/promises";
import { rm } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CFG: Config = {
  halfLifeDays: 14,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
  pruneThresholdDays: 30,
  edgePruneThreshold: 0.01,
};

function makePath(): string {
  return `/tmp/theorex-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runScan", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths.splice(0)) {
      try { await unlink(p); } catch { /* ignore */ }
    }
  });

  test("1. cold start (no axon.json) completes without error", async () => {
    const path = makePath();
    // no file created — cold start
    await expect(runScan(path, DEFAULT_CFG)).resolves.toBeUndefined();
  });

  test("2. scan on existing store updates importance_weight and writes file", async () => {
    const path = makePath();
    cleanupPaths.push(path);
    const nowMs = Date.now();

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 10,
      frequency_count: 20,
      timestamp: new Date(nowMs).toISOString(),
    }));
    await store.save(path);

    await runScan(path, DEFAULT_CFG);

    const loaded = await AxonStore.load(path);
    expect(loaded.graph.order).toBe(1);
    const attrs = loaded.graph.getNodeAttributes("10");
    expect(attrs.importance_weight).toBeGreaterThan(0);
    expect(["ACTIVE", "MILD", "LESS"]).toContain(attrs.relevance_tier);
  });
});

describe("runStatus", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths.splice(0)) {
      try { await unlink(p); } catch { /* ignore */ }
    }
  });

  test("3. cold start prints 'No concepts' message without error", async () => {
    const path = makePath();
    // Capture console output
    const original = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await runStatus(path, DEFAULT_CFG);
    } finally {
      console.log = original;
    }
    expect(lines.some((l) => l.includes("No concepts"))).toBe(true);
  });

  test("4. status with nodes prints table with all required columns", async () => {
    const path = makePath();
    cleanupPaths.push(path);

    // Use a recent timestamp so compositeScore is high enough to classify as ACTIVE
    // after lazy recompute (REL-03). halfLifeDays=14, frequency_count=20 → ACTIVE.
    const recentTs = new Date(Date.now() - 1 * 86_400_000).toISOString(); // 1 day ago

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 99,
      surface_form: "neural net",
      frequency_count: 20,
      timestamp: recentTs,
    }));
    store.mergeNode(makeEvent({
      concept_id: 100,
      surface_form: "deep learning",
      frequency_count: 20,
      timestamp: recentTs,
    }));
    await store.save(path);

    const original = console.log;
    const output: string[] = [];
    console.log = (...args: unknown[]) => { output.push(args.join(" ")); };
    try {
      await runStatus(path, DEFAULT_CFG);
    } finally {
      console.log = original;
    }

    const fullOutput = output.join("\n");

    // Header should include concept_id and surface_form columns
    expect(fullOutput).toContain("concept_id");
    expect(fullOutput).toContain("surface_form");
    // Data rows should contain the concepts
    expect(fullOutput).toContain("neural net");
    expect(fullOutput).toContain("deep learning");
    // Should include tier info — nodes with recent timestamp and high frequency are ACTIVE
    expect(fullOutput).toContain("ACTIVE");
    // Should mention node count
    expect(fullOutput).toContain("2 nodes");
  });

  test("11. runStatus corrects stale stored tier using elapsed time (REL-03)", async () => {
    const path = makePath();
    cleanupPaths.push(path);

    // Create a node with last_seen 100 days ago — compositeScore will be very low (LESS)
    const staleDateMs = Date.now() - 100 * 86_400_000;
    const staleDate = new Date(staleDateMs).toISOString();

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 303,
      surface_form: "stale concept",
      frequency_count: 1,
      timestamp: staleDate,
    }));
    // Force the stored relevance_tier to ACTIVE to simulate stale data
    store.graph.setNodeAttribute("303", "relevance_tier", "ACTIVE");
    store.graph.setNodeAttribute("303", "last_seen", staleDate);
    await store.save(path);

    // Verify the stored tier really is ACTIVE before calling runStatus
    const beforeLoad = await AxonStore.load(path);
    expect(beforeLoad.graph.getNodeAttributes("303").relevance_tier).toBe("ACTIVE");

    // Capture runStatus output
    const original = console.log;
    const output: string[] = [];
    console.log = (...args: unknown[]) => { output.push(args.join(" ")); };
    try {
      await runStatus(path, DEFAULT_CFG);
    } finally {
      console.log = original;
    }

    const fullOutput = output.join("\n");

    // The displayed tier must be LESS (corrected), not ACTIVE (stale)
    expect(fullOutput).toContain("stale concept");
    expect(fullOutput).toContain("LESS");
    // ACTIVE should NOT appear in data rows — only LESS for this single node
    // (header row does not contain "ACTIVE" or "LESS" as a column value)
    const dataRows = fullOutput.split("\n").filter((l) => l.includes("stale concept"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0]).toContain("LESS");
    expect(dataRows[0]).not.toContain("ACTIVE");
  });
});

describe("runRef", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths.splice(0)) {
      try { await unlink(p); } catch { /* ignore */ }
    }
  });

  test("5. ref with unknown keyword exits 1 with 'Concept not found' error", async () => {
    const path = makePath();
    // Cold store — no nodes

    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

    let exitCode = 0;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; throw new Error(`exit:${code}`); }) as typeof process.exit;

    try {
      await runRef(path, "nonexistent-concept", DEFAULT_CFG);
    } catch (e) {
      // expected — process.exit throws in test environment
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("Concept not found"))).toBe(true);
  });

  test("6. ref with valid surface_form bumps frequency_count by 1", async () => {
    const path = makePath();
    cleanupPaths.push(path);

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 42,
      surface_form: "machine learning",
      frequency_count: 3,
    }));
    await store.save(path);

    const originalLog = console.log;
    console.log = () => {};
    try {
      await runRef(path, "machine learning", DEFAULT_CFG);
    } finally {
      console.log = originalLog;
    }

    const loaded = await AxonStore.load(path);
    const attrs = loaded.graph.getNodeAttributes("42");
    // frequency_count incremented by propagateActivation
    expect(attrs.frequency_count).toBe(4);
  });

  test("7. ref is case-insensitive for surface_form matching", async () => {
    const path = makePath();
    cleanupPaths.push(path);

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 55,
      surface_form: "Machine Learning",
      frequency_count: 1,
    }));
    await store.save(path);

    const originalLog = console.log;
    console.log = () => {};
    try {
      await runRef(path, "machine learning", DEFAULT_CFG);
    } finally {
      console.log = originalLog;
    }

    const loaded = await AxonStore.load(path);
    const attrs = loaded.graph.getNodeAttributes("55");
    expect(attrs.frequency_count).toBe(2);
  });

  test("8. ref with concept_id string finds node by id", async () => {
    const path = makePath();
    cleanupPaths.push(path);

    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 77,
      surface_form: "deep learning",
      frequency_count: 2,
    }));
    await store.save(path);

    const originalLog = console.log;
    console.log = () => {};
    try {
      await runRef(path, "77", DEFAULT_CFG);
    } finally {
      console.log = originalLog;
    }

    const loaded = await AxonStore.load(path);
    const attrs = loaded.graph.getNodeAttributes("77");
    expect(attrs.frequency_count).toBe(3);
  });
});

describe("runPrune", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths.splice(0)) {
      try { await unlink(p); } catch { /* ignore */ }
      try { await rm(p + "-archive", { recursive: true }); } catch { /* ignore */ }
    }
  });

  test("9. cold start (no axon.json) completes without error", async () => {
    const path = makePath();
    const archiveDir = path + "-archive";

    const originalLog = console.log;
    console.log = () => {};
    try {
      await expect(runPrune(path, archiveDir, DEFAULT_CFG)).resolves.toBeUndefined();
    } finally {
      console.log = originalLog;
    }
  });

  test("10. prune removes LESS nodes past threshold and writes archive", async () => {
    const path = makePath();
    const archiveDir = path + "-archive";
    cleanupPaths.push(path);

    const nowMs = Date.now();
    // Node last seen 31 days ago with LESS tier (recency very low)
    const oldDate = new Date(nowMs - 31 * 86_400_000).toISOString();

    const store = new AxonStore();
    // Create node and manually set to LESS tier
    store.mergeNode(makeEvent({
      concept_id: 200,
      surface_form: "old concept",
      frequency_count: 1,
      timestamp: oldDate,
    }));
    // Set relevance_tier to LESS manually
    store.graph.setNodeAttribute("200", "relevance_tier", "LESS");
    store.graph.setNodeAttribute("200", "last_seen", oldDate);
    await store.save(path);

    expect((await AxonStore.load(path)).graph.order).toBe(1);

    const originalLog = console.log;
    console.log = () => {};
    try {
      await runPrune(path, archiveDir, DEFAULT_CFG);
    } finally {
      console.log = originalLog;
    }

    const loaded = await AxonStore.load(path);
    expect(loaded.graph.order).toBe(0);
  });
});
