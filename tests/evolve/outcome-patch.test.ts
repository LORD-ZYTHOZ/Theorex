// tests/evolve/outcome-patch.test.ts — Tests for outcome patching helpers
import { test, expect, describe } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  patchOutcomeJudgeScore,
  patchOutcomeTraceId,
  buildOutcome,
  recordOutcome,
} from "../../src/evolve/outcome";
import type { OutcomeRecord } from "../../src/evolve/outcome";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "theorex-outcome-patch-"));
}

function makeOutcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: crypto.randomUUID(),
    timestamp: "2026-03-18T00:00:00.000Z",
    agent_id: "main",
    decision: "test decision",
    result: "test result",
    success: false,
    concept_ids: [],
    tags: ["test"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// patchOutcomeTraceId
// ---------------------------------------------------------------------------

describe("patchOutcomeTraceId", () => {
  test("adds trace_id to an outcome that has none", async () => {
    const dir = await makeTmpDir();
    const outcome = makeOutcome();
    await recordOutcome(outcome, dir);

    const traceId = crypto.randomUUID();
    await patchOutcomeTraceId(outcome.id, traceId, dir);

    const patched = await Bun.file(`${dir}/${outcome.id}.json`).json() as OutcomeRecord;
    expect(patched.trace_id).toBe(traceId);
  });

  test("preserves all other fields when patching trace_id", async () => {
    const dir = await makeTmpDir();
    const outcome = makeOutcome({
      decision: "specific decision",
      result: "specific result",
      tags: ["a", "b"],
      concept_ids: [1, 2, 3],
    });
    await recordOutcome(outcome, dir);

    await patchOutcomeTraceId(outcome.id, "trace-abc", dir);

    const patched = await Bun.file(`${dir}/${outcome.id}.json`).json() as OutcomeRecord;
    expect(patched.decision).toBe("specific decision");
    expect(patched.result).toBe("specific result");
    expect(patched.tags).toEqual(["a", "b"]);
    expect(patched.concept_ids).toEqual([1, 2, 3]);
  });

  test("overwrites an existing trace_id", async () => {
    const dir = await makeTmpDir();
    const outcome = makeOutcome({ trace_id: "old-trace" });
    await recordOutcome(outcome, dir);

    await patchOutcomeTraceId(outcome.id, "new-trace", dir);

    const patched = await Bun.file(`${dir}/${outcome.id}.json`).json() as OutcomeRecord;
    expect(patched.trace_id).toBe("new-trace");
  });

  test("throws when outcome file does not exist", async () => {
    const dir = await makeTmpDir();
    await expect(patchOutcomeTraceId("nonexistent-id", "trace-123", dir)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// patchOutcomeJudgeScore — existing helper, quick regression
// ---------------------------------------------------------------------------

describe("patchOutcomeJudgeScore", () => {
  test("adds judge_score and judge_reasoning without touching other fields", async () => {
    const dir = await makeTmpDir();
    const outcome = makeOutcome({ decision: "keep this decision" });
    await recordOutcome(outcome, dir);

    await patchOutcomeJudgeScore(outcome.id, 0.75, "Solid reasoning", dir);

    const patched = await Bun.file(`${dir}/${outcome.id}.json`).json() as OutcomeRecord;
    expect(patched.judge_score).toBeCloseTo(0.75);
    expect(patched.judge_reasoning).toBe("Solid reasoning");
    expect(patched.decision).toBe("keep this decision");
  });

  test("clamps score above 1.0", async () => {
    const dir = await makeTmpDir();
    const outcome = makeOutcome();
    await recordOutcome(outcome, dir);
    await patchOutcomeJudgeScore(outcome.id, 1.5, "over the top", dir);
    const patched = await Bun.file(`${dir}/${outcome.id}.json`).json() as OutcomeRecord;
    expect(patched.judge_score).toBe(1);
  });

  test("clamps score below 0.0", async () => {
    const dir = await makeTmpDir();
    const outcome = makeOutcome();
    await recordOutcome(outcome, dir);
    await patchOutcomeJudgeScore(outcome.id, -0.5, "negative", dir);
    const patched = await Bun.file(`${dir}/${outcome.id}.json`).json() as OutcomeRecord;
    expect(patched.judge_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildOutcome — factory helper
// ---------------------------------------------------------------------------

describe("buildOutcome", () => {
  test("generates a UUID id", () => {
    const o = buildOutcome({ agentId: "main", decision: "d", result: "r", success: true });
    expect(o.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("sets timestamp to current time (within 2 seconds)", () => {
    const before = Date.now();
    const o = buildOutcome({ agentId: "main", decision: "d", result: "r", success: true });
    const after = Date.now();
    const ts = new Date(o.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("empty concept_ids and tags by default", () => {
    const o = buildOutcome({ agentId: "main", decision: "d", result: "r", success: false });
    expect(o.concept_ids).toEqual([]);
    expect(o.tags).toEqual([]);
  });

  test("filters empty strings from tags", () => {
    const o = buildOutcome({
      agentId: "main",
      decision: "d",
      result: "r",
      success: true,
      tags: ["good", "", "tag"],
    });
    expect(o.tags).toEqual(["good", "tag"]);
  });
});
