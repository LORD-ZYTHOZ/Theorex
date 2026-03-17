// tests/outcome-feedback.test.ts — Three-channel feedback + judge prompt tests.
// Covers: computeCompositeScore channel weighting, buildJudgePrompt content,
// patchOutcomeJudgeScore atomic file update.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computeCompositeScore,
  buildJudgePrompt,
  buildOutcome,
  recordOutcome,
  patchOutcomeJudgeScore,
  readOutcomes,
  type OutcomeRecord,
} from "../evolve/outcome";

const TMP = join(tmpdir(), "theorex-outcome-feedback-test-" + Date.now());
const OUTCOMES_DIR = join(TMP, "outcomes");

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// computeCompositeScore — three-channel weighted average
// ---------------------------------------------------------------------------

describe("computeCompositeScore()", () => {
  test("all three channels present → weighted average (explicit=40%, thumbs=20%, judge=40%)", () => {
    const outcome: OutcomeRecord = {
      ...buildOutcome({ agentId: "main", decision: "test", result: "", success: true }),
      explicit_score: 0.8,
      thumbs_up: true,      // → 1.0
      judge_score: 0.6,
    };
    // weights: explicit=0.4, thumbs=0.2, judge=0.4 → total=1.0
    // score = 0.4*0.8 + 0.2*1.0 + 0.4*0.6 = 0.32 + 0.20 + 0.24 = 0.76
    expect(computeCompositeScore(outcome)).toBeCloseTo(0.76, 4);
  });

  test("thumbs_up=false counts as 0.0 in the channel", () => {
    const outcome: OutcomeRecord = {
      ...buildOutcome({ agentId: "main", decision: "test", result: "", success: true }),
      thumbs_up: false,
      judge_score: 1.0,
    };
    // weights: thumbs=0.2, judge=0.4 → total=0.6
    // score = (0.2/0.6)*0.0 + (0.4/0.6)*1.0 ≈ 0.6667
    expect(computeCompositeScore(outcome)).toBeCloseTo(0.6667, 3);
  });

  test("no channels present + success=true → returns 0.6 (binary fallback)", () => {
    const outcome: OutcomeRecord = buildOutcome({
      agentId: "main",
      decision: "test decision",
      result: "test result",
      success: true,
    });
    expect(computeCompositeScore(outcome)).toBe(0.6);
  });

  test("no channels present + success=false → returns 0.0 (binary fallback)", () => {
    const outcome: OutcomeRecord = buildOutcome({
      agentId: "main",
      decision: "bad decision",
      result: "failed",
      success: false,
    });
    expect(computeCompositeScore(outcome)).toBe(0.0);
  });

  test("only explicit_score present → uses proportional weight (weight/total = 1.0)", () => {
    const outcome: OutcomeRecord = {
      ...buildOutcome({ agentId: "main", decision: "test", result: "", success: false }),
      explicit_score: 0.7,
    };
    // Only one channel: weight=0.4, totalWeight=0.4 → (0.4/0.4) * 0.7 = 0.7
    expect(computeCompositeScore(outcome)).toBeCloseTo(0.7, 4);
  });

  test("only judge_score present → score equals judge_score", () => {
    const outcome: OutcomeRecord = {
      ...buildOutcome({ agentId: "main", decision: "test", result: "", success: true }),
      judge_score: 0.4,
    };
    expect(computeCompositeScore(outcome)).toBeCloseTo(0.4, 4);
  });

  test("only thumbs_up=true present → score equals 1.0", () => {
    const outcome: OutcomeRecord = {
      ...buildOutcome({ agentId: "main", decision: "test", result: "", success: false }),
      thumbs_up: true,
    };
    expect(computeCompositeScore(outcome)).toBeCloseTo(1.0, 4);
  });

  test("explicit_score is clamped to [0, 1]", () => {
    const outcome: OutcomeRecord = {
      ...buildOutcome({ agentId: "main", decision: "test", result: "", success: true }),
      explicit_score: 1.5, // over 1 — should clamp to 1.0
    };
    expect(computeCompositeScore(outcome)).toBeCloseTo(1.0, 4);
  });

  test("judge_score is clamped to [0, 1]", () => {
    const outcome: OutcomeRecord = {
      ...buildOutcome({ agentId: "main", decision: "test", result: "", success: true }),
      judge_score: -0.5, // below 0 — should clamp to 0.0
    };
    expect(computeCompositeScore(outcome)).toBeCloseTo(0.0, 4);
  });
});

// ---------------------------------------------------------------------------
// buildJudgePrompt
// ---------------------------------------------------------------------------

describe("buildJudgePrompt()", () => {
  test("includes the decision text in the prompt", () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "Switch to trend-following strategy",
      result: "Win rate improved by 10%",
      success: true,
    });
    const prompt = buildJudgePrompt(outcome);
    expect(prompt).toContain("Switch to trend-following strategy");
  });

  test("includes the result text in the prompt", () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "Use Qwen3 for code tasks",
      result: "Latency reduced by 200ms",
      success: true,
    });
    const prompt = buildJudgePrompt(outcome);
    expect(prompt).toContain("Latency reduced by 200ms");
  });

  test("includes tags in the prompt", () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "Enable aggressive mode",
      result: "Drawdown increased",
      success: false,
      tags: ["trading", "risk"],
    });
    const prompt = buildJudgePrompt(outcome);
    expect(prompt).toContain("trading");
    expect(prompt).toContain("risk");
  });

  test("includes success status in the prompt", () => {
    const successOutcome = buildOutcome({
      agentId: "main",
      decision: "Retry with backoff",
      result: "Succeeded on 3rd attempt",
      success: true,
    });
    const failOutcome = buildOutcome({
      agentId: "main",
      decision: "Skip validation",
      result: "Data corrupted",
      success: false,
    });
    expect(buildJudgePrompt(successOutcome)).toContain("yes");
    expect(buildJudgePrompt(failOutcome)).toContain("no");
  });

  test("prompt requests JSON response format", () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "test decision",
      result: "test result",
      success: true,
    });
    const prompt = buildJudgePrompt(outcome);
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"reasoning"');
    expect(prompt).toContain("0.0");
    expect(prompt).toContain("1.0");
  });

  test("no tags → shows (none) in prompt", () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "plain decision",
      result: "ok",
      success: true,
    });
    const prompt = buildJudgePrompt(outcome);
    expect(prompt).toContain("(none)");
  });
});

// ---------------------------------------------------------------------------
// patchOutcomeJudgeScore
// ---------------------------------------------------------------------------

describe("patchOutcomeJudgeScore()", () => {
  test("writes updated file with judge_score added", async () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "Apply momentum filter",
      result: "False signals reduced",
      success: true,
      tags: ["trading"],
    });
    await recordOutcome(outcome, OUTCOMES_DIR);

    await patchOutcomeJudgeScore(outcome.id, 0.85, "Strong decision with measurable outcome.", OUTCOMES_DIR);

    const all = await readOutcomes(OUTCOMES_DIR);
    const patched = all.find((r) => r.id === outcome.id);
    expect(patched).toBeDefined();
    expect(patched?.judge_score).toBeCloseTo(0.85, 3);
    expect(patched?.judge_reasoning).toBe("Strong decision with measurable outcome.");
  });

  test("original fields are preserved after patch", async () => {
    const outcome = buildOutcome({
      agentId: "qwen-sage",
      decision: "Reduce position size during drawdown",
      result: "Drawdown capped at 3%",
      success: true,
      tags: ["risk", "trading"],
    });
    await recordOutcome(outcome, OUTCOMES_DIR);

    await patchOutcomeJudgeScore(outcome.id, 0.9, "Excellent risk management.", OUTCOMES_DIR);

    const all = await readOutcomes(OUTCOMES_DIR);
    const patched = all.find((r) => r.id === outcome.id);
    expect(patched?.agent_id).toBe("qwen-sage");
    expect(patched?.decision).toBe("Reduce position size during drawdown");
    expect(patched?.success).toBe(true);
    expect(patched?.tags).toEqual(["risk", "trading"]);
  });

  test("judge_score is clamped to [0, 1] when value > 1", async () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "Over-score test",
      result: "ok",
      success: true,
    });
    await recordOutcome(outcome, OUTCOMES_DIR);

    await patchOutcomeJudgeScore(outcome.id, 1.5, "clamped", OUTCOMES_DIR);

    const all = await readOutcomes(OUTCOMES_DIR);
    const patched = all.find((r) => r.id === outcome.id);
    expect(patched?.judge_score).toBeLessThanOrEqual(1.0);
  });

  test("judge_score is clamped to [0, 1] when value < 0", async () => {
    const outcome = buildOutcome({
      agentId: "main",
      decision: "Under-score test",
      result: "failed",
      success: false,
    });
    await recordOutcome(outcome, OUTCOMES_DIR);

    await patchOutcomeJudgeScore(outcome.id, -0.3, "clamped below", OUTCOMES_DIR);

    const all = await readOutcomes(OUTCOMES_DIR);
    const patched = all.find((r) => r.id === outcome.id);
    expect(patched?.judge_score).toBeGreaterThanOrEqual(0.0);
  });

  test("throws when outcome file does not exist", async () => {
    expect(
      patchOutcomeJudgeScore("non-existent-uuid", 0.5, "should fail", OUTCOMES_DIR)
    ).rejects.toThrow();
  });
});
