// cli-drift.test.ts — Unit tests for runDrift, runAudit, and runStatus drift summary.
// Tests call exported handlers directly; tmp paths injected through parameters.

import { test, expect, describe, afterEach, beforeEach, spyOn } from "bun:test";
import { runDrift, runAudit, runStatus } from "../../src/cli/index";
import { AxonStore } from "../../src/axon/store";
import type { Config } from "../../src/config";
import type { ConceptEvent } from "../../src/types";
import { mkdir, rm, writeFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CFG: Config = {
  halfLifeDays: 14,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
  pruneThresholdDays: 30,
  edgePruneThreshold: 0.01,
  stmRetentionDays: 14,
  stmGraduateDays: 7,
  lmStudioUrl: "http://localhost:1234",
  lmStudioEmbedModel: "nomic-embed-text-v1.5",
  lmStudioTimeoutMs: 3000,
  ragBootstrapK: 5,
  ragBootstrapMinSimilarity: 0.4,
  ragSeedDissolutionDays: 7,
  ragEmbeddingStorePath: "data/concept-embeddings.json",
  ragOnnxModel: "Xenova/all-MiniLM-L6-v2",
  momentsDir: "data/moments",
  driftWindowDays: 7,
  eventsPath: "data/events.jsonl",
};

function makePath(suffix = ""): string {
  return `/tmp/theorex-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`;
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

// Build axon JSON file with specified nodes
async function buildAxon(
  path: string,
  nodes: Array<{ id: number; surface_form: string; frequency_count: number; daysAgo: number }>,
): Promise<void> {
  const store = new AxonStore();
  const nowMs = Date.now();
  for (const n of nodes) {
    const ts = new Date(nowMs - n.daysAgo * 86_400_000).toISOString();
    store.mergeNode(makeEvent({
      concept_id: n.id,
      surface_form: n.surface_form,
      frequency_count: n.frequency_count,
      timestamp: ts,
    }));
  }
  await store.save(path);
}

// Build JSONL events file
async function buildEvents(path: string, lines: object[]): Promise<void> {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  await writeFile(path, content);
}

// Build a moments directory with one moment file
async function buildMoments(dir: string, conceptIds: number[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const moment = {
    id: "test-moment-id",
    timestamp: new Date().toISOString(),
    story: "Test moment story",
    code_refs: [],
    concept_ids: conceptIds,
  };
  await Bun.write(`${dir}/test-moment-id.json`, JSON.stringify(moment));
}

// Capture console.log output from an async function
async function captureLog(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

// Capture console.error output from an async function
async function captureError(fn: () => Promise<void>): Promise<string> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    await fn();
  } catch {
    // ignore
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// runDrift tests
// ---------------------------------------------------------------------------

describe("runDrift", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const d of cleanupDirs.splice(0)) {
      try { await rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("1. cold start (no files) — no throw, output contains 'Drift Score: 1.00'", async () => {
    const axonPath = makePath(".json");
    const eventsPath = makePath("-events.jsonl");
    const momentsDir = makePath("-moments");
    const cfg = { ...DEFAULT_CFG, momentsDir, eventsPath };

    const output = await captureLog(() => runDrift(axonPath, eventsPath, cfg));

    expect(output).toContain("Drift Score: 1.00");
    // On cold start: no moments → score = 1.0 (spec: momentConceptIds.size === 0 → return 1.0)
  });

  test("2. with moments that overlap current ACTIVE set — score > 0", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = `${base}/axon.json`;
    const eventsPath = `${base}/events.jsonl`;
    const momentsDir = `${base}/moments`;

    // Node with high frequency + recent timestamp → classifies as ACTIVE
    await buildAxon(axonPath, [
      { id: 1, surface_form: "machine learning", frequency_count: 20, daysAgo: 1 },
    ]);
    await buildEvents(eventsPath, []);
    await buildMoments(momentsDir, [1]); // moment anchors concept_id=1 which is ACTIVE

    const cfg = { ...DEFAULT_CFG, momentsDir, eventsPath };
    const output = await captureLog(() => runDrift(axonPath, eventsPath, cfg));

    // Score should be > 0 since concept 1 is in both moments and ACTIVE set
    // (Jaccard: intersection=1, union=1, score=1.0)
    const scoreMatch = output.match(/Drift Score: (\d+\.\d+)/);
    expect(scoreMatch).not.toBeNull();
    const scoreVal = parseFloat(scoreMatch![1]!);
    expect(scoreVal).toBeGreaterThan(0);
  });

  test("3. with moments whose concept_ids all missing from ACTIVE — score = 0.0, output contains '[!]'", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = `${base}/axon.json`;
    const eventsPath = `${base}/events.jsonl`;
    const momentsDir = `${base}/moments`;

    // Old stale node — will classify as LESS, not ACTIVE
    await buildAxon(axonPath, [
      { id: 99, surface_form: "old concept", frequency_count: 1, daysAgo: 200 },
    ]);
    await buildEvents(eventsPath, []);
    // Moment anchors concept_id=1 which is NOT in the axon at all
    await buildMoments(momentsDir, [1]);

    const cfg = { ...DEFAULT_CFG, momentsDir, eventsPath };
    const output = await captureLog(() => runDrift(axonPath, eventsPath, cfg));

    // momentIds={1}, activeIds={} (stale node is LESS) → computeDriftScore(momentIds, activeIds)
    // activeIds.size=0 → returns 0.0
    expect(output).toContain("Drift Score: 0.00");
    expect(output).toContain("[!]");
    // trend should be "drifting" because score < 0.5
    expect(output).toContain("drifting");
  });

  test("4. with ACTIVE→MILD tier_change within window — instability flag appears in output", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = `${base}/axon.json`;
    const eventsPath = `${base}/events.jsonl`;
    const momentsDir = `${base}/moments`;

    await buildAxon(axonPath, []);
    // tier_change event from ACTIVE → MILD within last 7 days
    const recentTs = new Date(Date.now() - 2 * 86_400_000).toISOString(); // 2 days ago
    await buildEvents(eventsPath, [
      {
        type: "tier_change",
        timestamp: recentTs,
        source: "scan",
        concept_id: 42,
        surface_form: "neural network",
        from: "ACTIVE",
        to: "MILD",
      },
    ]);
    await mkdir(momentsDir, { recursive: true }); // empty moments dir

    const cfg = { ...DEFAULT_CFG, momentsDir, eventsPath };
    const output = await captureLog(() => runDrift(axonPath, eventsPath, cfg));

    expect(output).toContain("Tier Instability");
    expect(output).toContain("neural network");
    expect(output).toContain("id:42");
    expect(output).toContain("ACTIVE → MILD");
  });

  test("5. with sentiment_flip events (PREFERRED then DISPREFERRED) within window — flip flag in output", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = `${base}/axon.json`;
    const eventsPath = `${base}/events.jsonl`;
    const momentsDir = `${base}/moments`;

    await buildAxon(axonPath, []);
    const recentTs1 = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const recentTs2 = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await buildEvents(eventsPath, [
      {
        type: "sentiment_flip",
        timestamp: recentTs2,
        source: "ref",
        concept_id: 7,
        surface_form: "deep learning",
        from: "NEUTRAL",
        to: "PREFERRED",
      },
      {
        type: "sentiment_flip",
        timestamp: recentTs1,
        source: "ref",
        concept_id: 7,
        surface_form: "deep learning",
        from: "PREFERRED",
        to: "DISPREFERRED",
      },
    ]);
    await mkdir(momentsDir, { recursive: true });

    const cfg = { ...DEFAULT_CFG, momentsDir, eventsPath };
    const output = await captureLog(() => runDrift(axonPath, eventsPath, cfg));

    expect(output).toContain("Sentiment Flips");
    expect(output).toContain("deep learning");
    expect(output).toContain("id:7");
    expect(output).toMatch(/PREFERRED.*DISPREFERRED|DISPREFERRED.*PREFERRED/);
  });
});

// ---------------------------------------------------------------------------
// runAudit tests
// ---------------------------------------------------------------------------

describe("runAudit", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const d of cleanupDirs.splice(0)) {
      try { await rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("1. no events file — prints 'No events found.'", async () => {
    const eventsPath = makePath("-events.jsonl");
    // File does not exist

    const output = await captureLog(() => runAudit(eventsPath, {}));

    expect(output).toContain("No events found");
  });

  test("2. file with 3 events of mixed types — prints all 3", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });
    const eventsPath = `${base}/events.jsonl`;

    const ts = new Date(Date.now() - 1 * 86_400_000).toISOString();
    await buildEvents(eventsPath, [
      { type: "tier_change", timestamp: ts, source: "scan", concept_id: 1, surface_form: "concept a", from: "ACTIVE", to: "MILD" },
      { type: "graduation", timestamp: ts, source: "graduate", concept_id: 2, surface_form: "concept b" },
      { type: "prune", timestamp: ts, source: "prune", concept_id: 3, surface_form: "concept c" },
    ]);

    const output = await captureLog(() => runAudit(eventsPath, {}));

    // Should show all 3 events
    expect(output).toContain("3 total");
    expect(output).toContain("concept a");
    expect(output).toContain("concept b");
    expect(output).toContain("concept c");
  });

  test("3. --type=tier_change filter — only tier_change events printed", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });
    const eventsPath = `${base}/events.jsonl`;

    const ts = new Date(Date.now() - 1 * 86_400_000).toISOString();
    await buildEvents(eventsPath, [
      { type: "tier_change", timestamp: ts, source: "scan", concept_id: 1, surface_form: "concept a", from: "ACTIVE", to: "MILD" },
      { type: "graduation", timestamp: ts, source: "graduate", concept_id: 2, surface_form: "concept b" },
      { type: "prune", timestamp: ts, source: "prune", concept_id: 3, surface_form: "concept c" },
    ]);

    const output = await captureLog(() => runAudit(eventsPath, { type: "tier_change" }));

    expect(output).toContain("type: tier_change");
    expect(output).toContain("concept a");
    expect(output).not.toContain("concept b");
    expect(output).not.toContain("concept c");
  });

  test("4. --since=YYYY-MM-DD excludes events before that date", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });
    const eventsPath = `${base}/events.jsonl`;

    // old event: 30 days ago
    const oldTs = new Date(Date.now() - 30 * 86_400_000).toISOString();
    // recent event: 1 day ago
    const recentTs = new Date(Date.now() - 1 * 86_400_000).toISOString();

    await buildEvents(eventsPath, [
      { type: "graduation", timestamp: oldTs, source: "graduate", concept_id: 1, surface_form: "old concept" },
      { type: "graduation", timestamp: recentTs, source: "graduate", concept_id: 2, surface_form: "new concept" },
    ]);

    // Since 7 days ago — date format YYYY-MM-DD
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const sinceDate = sevenDaysAgo.toISOString().slice(0, 10);

    const output = await captureLog(() => runAudit(eventsPath, { since: sinceDate }));

    expect(output).toContain("new concept");
    expect(output).not.toContain("old concept");
  });

  test("5. --since with invalid date — process.exit(1) called", async () => {
    const eventsPath = makePath("-events.jsonl");

    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

    try {
      await runAudit(eventsPath, { since: "not-a-date" });
    } catch {
      // expected
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("Invalid --since date"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runStatus drift summary tests
// ---------------------------------------------------------------------------

describe("runStatus drift summary", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const d of cleanupDirs.splice(0)) {
      try { await rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("6. runStatus with loaded axon and events.jsonl — output contains 'Drift:'", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = `${base}/axon.json`;
    const eventsPath = `${base}/events.jsonl`;
    const momentsDir = `${base}/moments`;

    // Create an axon with one recent ACTIVE concept
    const recentTs = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 5,
      surface_form: "neural net",
      frequency_count: 20,
      timestamp: recentTs,
    }));
    await store.save(axonPath);

    // Create empty events file
    await buildEvents(eventsPath, []);
    await mkdir(momentsDir, { recursive: true });

    const cfg = { ...DEFAULT_CFG, eventsPath, momentsDir };
    const output = await captureLog(() => runStatus(axonPath, cfg));

    expect(output).toContain("Drift:");
  });

  test("7. runStatus with no events.jsonl — does not throw; table still printed", async () => {
    const base = makePath("-dir");
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = `${base}/axon.json`;
    const eventsPath = `${base}/events.jsonl`; // will not exist

    const recentTs = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const store = new AxonStore();
    store.mergeNode(makeEvent({
      concept_id: 5,
      surface_form: "neural net",
      frequency_count: 20,
      timestamp: recentTs,
    }));
    await store.save(axonPath);

    const cfg = { ...DEFAULT_CFG, eventsPath, momentsDir: `${base}/moments` };

    // Must not throw even if events file is absent
    await expect(
      captureLog(() => runStatus(axonPath, cfg))
    ).resolves.toBeTypeOf("string");

    const output = await captureLog(() => runStatus(axonPath, cfg));
    // Status table should still be present
    expect(output).toContain("neural net");
    expect(output).toContain("concept_id");
  });
});
