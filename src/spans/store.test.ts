// src/spans/store.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { SpanStore } from "./store";

// These tests hit real Postgres — requires THEOREX_PG_HOST set or default 100.95.91.32
const store = new SpanStore();

describe("SpanStore", () => {
  let testSpanId: string;

  test("emitSpan returns a span_id", async () => {
    const id = await store.emitSpan({
      agent_id: "test-optimizer",
      task_type: "test",
      prompt_sent: "hello",
      output_recv: "world",
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(10);
    testSpanId = id;
  });

  test("getSpans returns emitted span", async () => {
    const spans = await store.getSpans({
      agent_id: "test-optimizer",
      limit: 10,
    });
    const found = spans.find((s) => s.span_id === testSpanId);
    expect(found).toBeDefined();
    expect(found?.output_recv).toBe("world");
  });

  test("resolveSpan backfills reward_score", async () => {
    await store.resolveSpan(testSpanId, 0.75);
    const spans = await store.getSpans({
      agent_id: "test-optimizer",
      resolved_only: true,
      limit: 10,
    });
    const resolved = spans.find((s) => s.span_id === testSpanId);
    expect(resolved).toBeDefined();
    expect(resolved?.reward_score).toBeCloseTo(0.75, 3);
  });

  test("markOptimized flips optimized flag", async () => {
    await store.markOptimized(testSpanId);
    const spans = await store.getSpans({
      agent_id: "test-optimizer",
      limit: 10,
    });
    const span = spans.find((s) => s.span_id === testSpanId);
    expect(span?.optimized).toBe(true);
  });

  test("getRecentOutputs returns last N output_recv for agent+task", async () => {
    const outputs = await store.getRecentOutputs("test-optimizer", "test", 5);
    expect(Array.isArray(outputs)).toBe(true);
  });
});
