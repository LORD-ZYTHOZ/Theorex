// tests/trace/bus-trace-id.test.ts — Verify caller-supplied trace_id flows through EventBus
import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, readTraces } from "../../src/trace/bus";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "theorex-bus-test-"));
}

// Build a fresh EventBus instance (not the singleton) for isolation
function makeBus(tracesDir: string): EventBus {
  const b = new EventBus();
  b.setTracesDir(tracesDir);
  return b;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventBus — caller-supplied trace_id", () => {
  test("assembled TraceRecord uses caller-supplied trace_id from LM_INFERENCE_START", async () => {
    const dir = await makeTmpDir();
    const bus = makeBus(dir);
    const suppliedId = crypto.randomUUID();

    bus.emit("LM_INFERENCE_START", {
      agent_id: "main",
      model: "qwen3-32b",
      prompt_tokens: 100,
      query_type: "code",
      trace_id: suppliedId,
    });

    bus.emit("LM_INFERENCE_END", {
      agent_id: "main",
      model: "qwen3-32b",
      prompt_tokens: 100,
      completion_tokens: 50,
      latency_ms: 1200,
      success: true,
    });

    // Give the async writeTrace a tick to complete
    await new Promise((r) => setTimeout(r, 50));

    const traces = await readTraces(dir);
    expect(traces.length).toBe(1);
    expect(traces[0]!.id).toBe(suppliedId);
  });

  test("generates a new UUID when trace_id is not supplied", async () => {
    const dir = await makeTmpDir();
    const bus = makeBus(dir);

    bus.emit("LM_INFERENCE_START", {
      agent_id: "main",
      model: "ministral-3b",
      prompt_tokens: 80,
      query_type: "general",
      // no trace_id
    });

    bus.emit("LM_INFERENCE_END", {
      agent_id: "main",
      model: "ministral-3b",
      prompt_tokens: 80,
      completion_tokens: 40,
      latency_ms: 800,
      success: true,
    });

    await new Promise((r) => setTimeout(r, 50));

    const traces = await readTraces(dir);
    expect(traces.length).toBe(1);
    expect(traces[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("two sequential dispatches with different trace_ids produce distinct files", async () => {
    const dir = await makeTmpDir();
    const bus = makeBus(dir);
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    bus.emit("LM_INFERENCE_START", { agent_id: "a1", model: "qwen3-32b", prompt_tokens: 10, query_type: "code", trace_id: id1 });
    bus.emit("LM_INFERENCE_END", { agent_id: "a1", model: "qwen3-32b", prompt_tokens: 10, completion_tokens: 5, latency_ms: 100, success: true });
    await new Promise((r) => setTimeout(r, 50));

    bus.emit("LM_INFERENCE_START", { agent_id: "a2", model: "ministral-3b", prompt_tokens: 20, query_type: "retrieval", trace_id: id2 });
    bus.emit("LM_INFERENCE_END", { agent_id: "a2", model: "ministral-3b", prompt_tokens: 20, completion_tokens: 10, latency_ms: 200, success: false });
    await new Promise((r) => setTimeout(r, 50));

    const traces = await readTraces(dir);
    expect(traces.length).toBe(2);
    const ids = traces.map((t) => t.id).sort();
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });
});
