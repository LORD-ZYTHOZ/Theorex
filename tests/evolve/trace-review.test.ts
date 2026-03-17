// tests/evolve/trace-review.test.ts — Phase 20 trace-review unit tests
import { test, expect, describe } from "bun:test";
import {
  buildTraceReviewPrompt,
  parseReviewerResponse,
  filterFailureCandidates,
} from "../../src/evolve/trace-review";
import type { OutcomeRecord } from "../../src/evolve/outcome";
import type { TraceRecord } from "../../src/trace/bus";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOutcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "test-outcome-id",
    timestamp: "2026-03-18T00:00:00.000Z",
    agent_id: "main",
    decision: "Use aggressive caching strategy for the hot path",
    result: "Cache invalidation caused stale data to be served for 10 minutes",
    success: false,
    concept_ids: [],
    tags: ["caching", "performance"],
    ...overrides,
  };
}

function makeTrace(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    id: "test-trace-id",
    agent_id: "main",
    model: "qwen3-32b",
    start_time: "2026-03-18T00:00:00.000Z",
    end_time: "2026-03-18T00:00:01.200Z",
    total_tokens: 512,
    latency_ms: 1200,
    success: false,
    error: "Cache invalidation race condition detected",
    tags: ["caching", "qwen3-32b"],
    events: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildTraceReviewPrompt
// ---------------------------------------------------------------------------

describe("buildTraceReviewPrompt", () => {
  test("includes decision and result from outcome", () => {
    const outcome = makeOutcome();
    const prompt = buildTraceReviewPrompt(outcome, null);
    expect(prompt).toContain("Use aggressive caching strategy");
    expect(prompt).toContain("stale data to be served");
  });

  test("includes tags from outcome", () => {
    const outcome = makeOutcome();
    const prompt = buildTraceReviewPrompt(outcome, null);
    expect(prompt).toContain("caching, performance");
  });

  test("shows no trace when trace is null", () => {
    const outcome = makeOutcome();
    const prompt = buildTraceReviewPrompt(outcome, null);
    expect(prompt).toContain("No trace was attached");
  });

  test("includes trace details when trace is provided", () => {
    const outcome = makeOutcome();
    const trace = makeTrace();
    const prompt = buildTraceReviewPrompt(outcome, trace);
    expect(prompt).toContain("qwen3-32b");
    expect(prompt).toContain("512");     // total_tokens
    expect(prompt).toContain("1200ms");  // latency_ms
    expect(prompt).toContain("Cache invalidation race condition");
  });

  test("omits error line when trace has no error", () => {
    const outcome = makeOutcome();
    const trace = makeTrace({ error: undefined });
    const prompt = buildTraceReviewPrompt(outcome, trace);
    expect(prompt).not.toContain("Error:");
  });

  test("uses (none) for empty tags", () => {
    const outcome = makeOutcome({ tags: [] });
    const prompt = buildTraceReviewPrompt(outcome, null);
    expect(prompt).toContain("(none)");
  });

  test("ends with JSON format instruction", () => {
    const outcome = makeOutcome();
    const prompt = buildTraceReviewPrompt(outcome, null);
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"fix_description"');
  });
});

// ---------------------------------------------------------------------------
// parseReviewerResponse
// ---------------------------------------------------------------------------

describe("parseReviewerResponse", () => {
  test("parses clean JSON response", () => {
    const raw = `{ "score": 0.85, "fix_description": "Add TTL-based cache invalidation with jitter to prevent stampedes." }`;
    const result = parseReviewerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(0.85);
    expect(result!.fix_description).toContain("TTL-based cache invalidation");
  });

  test("parses JSON embedded in prose", () => {
    const raw = `After analyzing the failure, I recommend the following fix:
{ "score": 0.7, "fix_description": "Implement write-through invalidation instead of lazy expiry." }
This should prevent the race condition.`;
    const result = parseReviewerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(0.7);
    expect(result!.fix_description).toContain("write-through invalidation");
  });

  test("parses when fix_description comes before score", () => {
    const raw = `{ "fix_description": "Use a distributed lock around cache writes.", "score": 0.9 }`;
    const result = parseReviewerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(0.9);
  });

  test("clamps score above 1.0", () => {
    const raw = `{ "score": 1.5, "fix_description": "Some fix." }`;
    const result = parseReviewerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });

  test("clamps score below 0.0", () => {
    const raw = `{ "score": -0.3, "fix_description": "Some fix." }`;
    const result = parseReviewerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0);
  });

  test("returns null for empty response", () => {
    expect(parseReviewerResponse("")).toBeNull();
  });

  test("returns null for prose with no JSON", () => {
    expect(parseReviewerResponse("Sorry, I cannot provide an answer.")).toBeNull();
  });

  test("returns null when score field missing", () => {
    const raw = `{ "fix_description": "Some fix." }`;
    expect(parseReviewerResponse(raw)).toBeNull();
  });

  test("returns null when fix_description is empty string", () => {
    const raw = `{ "score": 0.5, "fix_description": "" }`;
    expect(parseReviewerResponse(raw)).toBeNull();
  });

  test("returns null when fix_description is wrong type", () => {
    const raw = `{ "score": 0.5, "fix_description": 42 }`;
    expect(parseReviewerResponse(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterFailureCandidates — pure filter, no LLM calls
// ---------------------------------------------------------------------------

describe("filterFailureCandidates", () => {
  test("excludes successful outcomes", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({ id: "s1", success: true, agent_id: "main" }),
      makeOutcome({ id: "s2", success: true, agent_id: "main" }),
    ];
    expect(filterFailureCandidates(outcomes, "main").length).toBe(0);
  });

  test("includes failures with no feedback channels (score = 0.0)", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({ id: "f1", success: false, agent_id: "main" }),
    ];
    expect(filterFailureCandidates(outcomes, "main").length).toBe(1);
  });

  test("filters by agent_id", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({ id: "f1", success: false, agent_id: "main" }),
      makeOutcome({ id: "f2", success: false, agent_id: "qwen-sage" }),
    ];
    expect(filterFailureCandidates(outcomes, "main").length).toBe(1);
    expect(filterFailureCandidates(outcomes, "main")[0]!.id).toBe("f1");
  });

  test("includes all agents when agentId is 'all'", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({ id: "f1", success: false, agent_id: "main" }),
      makeOutcome({ id: "f2", success: false, agent_id: "qwen-sage" }),
    ];
    expect(filterFailureCandidates(outcomes, "all").length).toBe(2);
  });

  test("skips failure with thumbs_up=true (composite score = 1.0, above threshold)", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({
        id: "f-skip",
        success: false,
        agent_id: "main",
        thumbs_up: true,  // only channel → composite = 1.0 → above 0.3 threshold
      }),
    ];
    expect(filterFailureCandidates(outcomes, "main").length).toBe(0);
  });

  test("skips failure with explicit_score = 0.8 (above threshold)", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({
        id: "f-skip",
        success: false,
        agent_id: "main",
        explicit_score: 0.8,
      }),
    ];
    expect(filterFailureCandidates(outcomes, "main").length).toBe(0);
  });

  test("includes failure with explicit_score = 0.1 (below threshold)", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({
        id: "f-include",
        success: false,
        agent_id: "main",
        explicit_score: 0.1,
      }),
    ];
    expect(filterFailureCandidates(outcomes, "main").length).toBe(1);
  });

  test("excludes unknown agent from specific agent filter", () => {
    const outcomes: OutcomeRecord[] = [
      makeOutcome({ id: "f1", success: false, agent_id: "main" }),
    ];
    expect(filterFailureCandidates(outcomes, "nobody").length).toBe(0);
  });
});
