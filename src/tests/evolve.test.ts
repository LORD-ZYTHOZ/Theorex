// tests/evolve.test.ts — Phase 13 Living Code tests.
// Covers: outcome recording/reading, evolution review, refinement loop.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildOutcome,
  recordOutcome,
  readOutcomes,
  readOutcomesSince,
} from "../evolve/outcome";
import type { OutcomeRecord } from "../evolve/outcome";

import { reviewOutcomes } from "../evolve/review";
import { refineFromReport, readEvolutionLog } from "../evolve/refine";
import { DEFAULT_CONFIG } from "../config";
import type { Config } from "../config";

const TMP = join(tmpdir(), "theorex-evolve-test-" + Date.now());
const OUTCOMES_DIR = join(TMP, "outcomes");
const AXON_PATH = join(TMP, "axon.json");
const EVOLUTION_LOG = join(TMP, "evolution.jsonl");

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    axonPath: AXON_PATH,
    outcomesDir: OUTCOMES_DIR,
    evolutionLogPath: EVOLUTION_LOG,
    evolveWindowDays: 7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildOutcome
// ---------------------------------------------------------------------------

describe("buildOutcome", () => {
  test("produces a valid OutcomeRecord with required fields", () => {
    const o = buildOutcome({
      agentId: "main",
      decision: "Switch to trend-following strategy",
      result: "Win rate improved by 10%",
      success: true,
      tags: ["trading", "strategy"],
    });
    expect(o.id).toBeString();
    expect(o.id.length).toBeGreaterThan(10);
    expect(o.agent_id).toBe("main");
    expect(o.success).toBe(true);
    expect(o.tags).toEqual(["trading", "strategy"]);
    expect(o.concept_ids).toEqual([]);
    expect(new Date(o.timestamp).getFullYear()).toBeGreaterThan(2020);
  });

  test("defaults concept_ids and tags to empty arrays", () => {
    const o = buildOutcome({ agentId: "qwen-sage", decision: "test", result: "", success: false });
    expect(o.concept_ids).toEqual([]);
    expect(o.tags).toEqual([]);
  });

  test("each call produces a unique id", () => {
    const a = buildOutcome({ agentId: "main", decision: "A", result: "", success: true });
    const b = buildOutcome({ agentId: "main", decision: "B", result: "", success: true });
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// recordOutcome + readOutcomes
// ---------------------------------------------------------------------------

describe("recordOutcome / readOutcomes", () => {
  test("writes and reads back an outcome", async () => {
    const o = buildOutcome({ agentId: "main", decision: "test decision", result: "test result", success: true });
    await recordOutcome(o, OUTCOMES_DIR);
    const all = await readOutcomes(OUTCOMES_DIR);
    const found = all.find((r) => r.id === o.id);
    expect(found).toBeDefined();
    expect(found?.decision).toBe("test decision");
    expect(found?.success).toBe(true);
  });

  test("reads multiple outcomes", async () => {
    const a = buildOutcome({ agentId: "main", decision: "A", result: "ra", success: true, tags: ["alpha"] });
    const b = buildOutcome({ agentId: "main", decision: "B", result: "rb", success: false, tags: ["beta"] });
    await recordOutcome(a, OUTCOMES_DIR);
    await recordOutcome(b, OUTCOMES_DIR);
    const all = await readOutcomes(OUTCOMES_DIR);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("returns empty array for non-existent dir", async () => {
    const result = await readOutcomes(join(TMP, "nonexistent"));
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readOutcomesSince
// ---------------------------------------------------------------------------

describe("readOutcomesSince", () => {
  test("filters outcomes by timestamp", async () => {
    const old = buildOutcome({ agentId: "main", decision: "old decision", result: "", success: false });
    // Override timestamp to be in the past
    const oldRecord: OutcomeRecord = { ...old, timestamp: "2020-01-01T00:00:00.000Z" };
    await recordOutcome(oldRecord, OUTCOMES_DIR);

    const recent = buildOutcome({ agentId: "main", decision: "recent decision", result: "", success: true });
    await recordOutcome(recent, OUTCOMES_DIR);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // last 24h
    const results = await readOutcomesSince(since, OUTCOMES_DIR);

    const foundOld = results.find((r) => r.id === oldRecord.id);
    const foundRecent = results.find((r) => r.id === recent.id);
    expect(foundOld).toBeUndefined();
    expect(foundRecent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// reviewOutcomes
// ---------------------------------------------------------------------------

describe("reviewOutcomes", () => {
  test("returns zero-outcome report when dir is empty", async () => {
    const emptyDir = join(TMP, "empty-outcomes");
    await mkdir(emptyDir, { recursive: true });
    const report = await reviewOutcomes("main", 7, emptyDir);
    expect(report.total_outcomes).toBe(0);
    expect(report.overall_win_rate).toBe(0);
    expect(report.insights.length).toBeGreaterThan(0); // has "no outcomes" message
  });

  test("computes correct win rate from outcomes", async () => {
    const dir = join(TMP, "review-outcomes");
    for (let i = 0; i < 4; i++) {
      const o = buildOutcome({ agentId: "main", decision: `decision-${i}`, result: "", success: i < 3, tags: ["test-pattern"] });
      await recordOutcome(o, dir);
    }
    const report = await reviewOutcomes("main", 7, dir);
    expect(report.total_outcomes).toBe(4);
    expect(report.successful).toBe(3);
    expect(report.failed).toBe(1);
    expect(report.overall_win_rate).toBeCloseTo(0.75, 2);
  });

  test("identifies top patterns with >= 2 outcomes", async () => {
    const dir = join(TMP, "pattern-outcomes");
    // 3 successes + 1 failure for "alpha", 2 failures for "beta"
    for (let i = 0; i < 3; i++) {
      const o = buildOutcome({ agentId: "main", decision: `alpha-win-${i}`, result: "", success: true, tags: ["alpha"] });
      await recordOutcome(o, dir);
    }
    const o4 = buildOutcome({ agentId: "main", decision: "alpha-fail", result: "", success: false, tags: ["alpha"] });
    await recordOutcome(o4, dir);
    for (let i = 0; i < 2; i++) {
      const o = buildOutcome({ agentId: "main", decision: `beta-fail-${i}`, result: "", success: false, tags: ["beta"] });
      await recordOutcome(o, dir);
    }

    const report = await reviewOutcomes("main", 7, dir);
    const alphaPattern = report.top_patterns.find((p) => p.pattern === "alpha");
    const betaPattern = report.weak_patterns.find((p) => p.pattern === "beta");
    expect(alphaPattern).toBeDefined();
    expect(alphaPattern?.win_rate).toBeCloseTo(0.75, 2);
    expect(betaPattern).toBeDefined();
    expect(betaPattern?.win_rate).toBe(0);
  });

  test("filters outcomes by agent_id", async () => {
    const dir = join(TMP, "agent-filter-outcomes");
    const mainOutcome = buildOutcome({ agentId: "main", decision: "main decision", result: "", success: true });
    const otherOutcome = buildOutcome({ agentId: "other-agent", decision: "other decision", result: "", success: false });
    await recordOutcome(mainOutcome, dir);
    await recordOutcome(otherOutcome, dir);

    const report = await reviewOutcomes("main", 7, dir);
    expect(report.total_outcomes).toBe(1);
    expect(report.successful).toBe(1);
  });

  test("includes all agents when agent_id is 'all'", async () => {
    const dir = join(TMP, "all-agents-outcomes");
    await recordOutcome(buildOutcome({ agentId: "a1", decision: "d1", result: "", success: true }), dir);
    await recordOutcome(buildOutcome({ agentId: "a2", decision: "d2", result: "", success: false }), dir);

    const report = await reviewOutcomes("all", 7, dir);
    expect(report.total_outcomes).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// refineFromReport + readEvolutionLog
// ---------------------------------------------------------------------------

describe("refineFromReport", () => {
  test("writes EvolutionEntry to log and returns summary", async () => {
    const dir = join(TMP, "refine-outcomes");
    const o = buildOutcome({ agentId: "main", decision: "try new approach", result: "worked", success: true, tags: ["momentum"] });
    await recordOutcome(o, dir);

    const config = makeConfig({ outcomesDir: dir });
    const { reviewOutcomes: rev } = await import("../evolve/review");
    const report = await rev("main", 7, dir);

    const entry = await refineFromReport(report, config, AXON_PATH);
    expect(entry.agent_id).toBe("main");
    expect(entry.window_days).toBe(7);
    expect(typeof entry.concepts_reinforced).toBe("number");
    expect(typeof entry.concepts_decayed).toBe("number");
    expect(entry.overall_win_rate).toBe(1);
  });

  test("appends to evolution log", async () => {
    const dir = join(TMP, "log-test-outcomes");
    const logPath = join(TMP, "test-evolution.jsonl");
    const config = makeConfig({ outcomesDir: dir, evolutionLogPath: logPath });

    const o = buildOutcome({ agentId: "main", decision: "log test", result: "ok", success: true });
    await recordOutcome(o, dir);

    const { reviewOutcomes: rev } = await import("../evolve/review");
    const report = await rev("main", 7, dir);
    await refineFromReport(report, config, AXON_PATH);
    await refineFromReport(report, config, AXON_PATH);

    const log = await readEvolutionLog(logPath);
    expect(log.length).toBe(2);
  });

  test("readEvolutionLog returns empty array for missing file", async () => {
    const log = await readEvolutionLog(join(TMP, "nonexistent.jsonl"));
    expect(log).toEqual([]);
  });
});
