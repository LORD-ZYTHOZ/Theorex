// tests/trace-bus.test.ts — Phase 15.5 EventBus trace collection tests.
// Covers: listener registration/removal, LM_INFERENCE pair assembly,
// TraceStore atomic write to a temp directory.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  bus,
  readTraces,
  type BusEvent,
  type LmInferenceEndPayload,
} from "../trace/bus";

const TMP = join(tmpdir(), "theorex-trace-bus-test-" + Date.now());
const TRACES_DIR = join(TMP, "traces");

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// on() / emit()
// ---------------------------------------------------------------------------

describe("on() / emit()", () => {
  test("registered listener is called with correct event payload", () => {
    // Use a fresh EventBus instance via module to avoid singleton bleed
    const received: BusEvent[] = [];
    const listener = (e: BusEvent) => received.push(e);

    bus.on("ROUTING_DECISION", listener as (e: BusEvent<"ROUTING_DECISION">) => void);

    bus.emit("ROUTING_DECISION", {
      agent_id: "main",
      chosen_model: "qwen3-32b",
      reason: "code keywords",
      context_pct: 30,
      query_tokens: 200,
    });

    expect(received.length).toBe(1);
    expect(received[0]!.type).toBe("ROUTING_DECISION");
    expect((received[0]!.payload as { chosen_model: string }).chosen_model).toBe("qwen3-32b");

    bus.off("ROUTING_DECISION", listener as (e: BusEvent<"ROUTING_DECISION">) => void);
  });

  test("listener receives event with a valid ISO 8601 timestamp", () => {
    const received: BusEvent[] = [];
    const listener = (e: BusEvent) => received.push(e);

    bus.on("OUTCOME_RECORDED", listener as (e: BusEvent<"OUTCOME_RECORDED">) => void);

    bus.emit("OUTCOME_RECORDED", {
      agent_id: "main",
      outcome_id: "test-outcome-id",
      success: true,
    });

    expect(received.length).toBe(1);
    expect(new Date(received[0]!.timestamp).getFullYear()).toBeGreaterThan(2020);

    bus.off("OUTCOME_RECORDED", listener as (e: BusEvent<"OUTCOME_RECORDED">) => void);
  });
});

// ---------------------------------------------------------------------------
// off() — removes listener
// ---------------------------------------------------------------------------

describe("off()", () => {
  test("removed listener no longer fires after off()", () => {
    const calls: number[] = [];
    const listener = () => calls.push(1);

    bus.on("TOOL_CALL_START", listener as (e: BusEvent<"TOOL_CALL_START">) => void);
    bus.emit("TOOL_CALL_START", { agent_id: "main", tool_name: "Read" });
    expect(calls.length).toBe(1);

    bus.off("TOOL_CALL_START", listener as (e: BusEvent<"TOOL_CALL_START">) => void);
    bus.emit("TOOL_CALL_START", { agent_id: "main", tool_name: "Read" });
    expect(calls.length).toBe(1); // still 1 — not called again
  });

  test("other listeners are not affected by off() on unrelated listener", () => {
    const callsA: number[] = [];
    const callsB: number[] = [];
    const listenerA = () => callsA.push(1);
    const listenerB = () => callsB.push(1);

    bus.on("TOOL_CALL_END", listenerA as (e: BusEvent<"TOOL_CALL_END">) => void);
    bus.on("TOOL_CALL_END", listenerB as (e: BusEvent<"TOOL_CALL_END">) => void);

    bus.off("TOOL_CALL_END", listenerA as (e: BusEvent<"TOOL_CALL_END">) => void);
    bus.emit("TOOL_CALL_END", { agent_id: "main", tool_name: "Read", latency_ms: 5, success: true });

    expect(callsA.length).toBe(0);
    expect(callsB.length).toBe(1);

    bus.off("TOOL_CALL_END", listenerB as (e: BusEvent<"TOOL_CALL_END">) => void);
  });
});

// ---------------------------------------------------------------------------
// LM_INFERENCE_START + LM_INFERENCE_END pair assembly
// ---------------------------------------------------------------------------

describe("LM_INFERENCE_START + LM_INFERENCE_END pair → TraceRecord", () => {
  test("start+end pair assembles a TraceRecord written to TRACES_DIR", async () => {
    bus.setTracesDir(TRACES_DIR);

    bus.emit("LM_INFERENCE_START", {
      agent_id: "tracer-agent",
      model: "qwen3-32b",
      prompt_tokens: 300,
      query_type: "code",
    });

    const endPayload: LmInferenceEndPayload = {
      agent_id: "tracer-agent",
      model: "qwen3-32b",
      prompt_tokens: 300,
      completion_tokens: 150,
      latency_ms: 512,
      success: true,
    };
    bus.emit("LM_INFERENCE_END", endPayload);

    // Allow the async writeTrace to settle
    await Bun.sleep(50);

    const traces = await readTraces(TRACES_DIR);
    const found = traces.find((t) => t.agent_id === "tracer-agent");
    expect(found).toBeDefined();
    expect(found?.model).toBe("qwen3-32b");
    expect(found?.latency_ms).toBe(512);
    expect(found?.success).toBe(true);
    expect(found?.total_tokens).toBe(450); // 300 + 150
  });

  test("failed inference has success=false in assembled TraceRecord", async () => {
    bus.setTracesDir(TRACES_DIR);

    bus.emit("LM_INFERENCE_START", {
      agent_id: "tracer-fail-agent",
      model: "ministral-3b",
      prompt_tokens: 100,
      query_type: "general",
    });

    bus.emit("LM_INFERENCE_END", {
      agent_id: "tracer-fail-agent",
      model: "ministral-3b",
      prompt_tokens: 100,
      completion_tokens: 0,
      latency_ms: 250,
      success: false,
      error: "timeout",
    });

    await Bun.sleep(50);

    const traces = await readTraces(TRACES_DIR);
    const found = traces.find((t) => t.agent_id === "tracer-fail-agent");
    expect(found).toBeDefined();
    expect(found?.success).toBe(false);
    expect(found?.error).toBe("timeout");
    expect(found?.latency_ms).toBe(250);
  });

  test("TraceRecord has valid UUID id and ISO timestamps", async () => {
    bus.setTracesDir(TRACES_DIR);

    bus.emit("LM_INFERENCE_START", {
      agent_id: "tracer-ts-agent",
      model: "qwen3-32b",
      prompt_tokens: 50,
      query_type: "retrieval",
    });

    bus.emit("LM_INFERENCE_END", {
      agent_id: "tracer-ts-agent",
      model: "qwen3-32b",
      prompt_tokens: 50,
      completion_tokens: 60,
      latency_ms: 100,
      success: true,
    });

    await Bun.sleep(50);

    const traces = await readTraces(TRACES_DIR);
    const found = traces.find((t) => t.agent_id === "tracer-ts-agent");
    expect(found).toBeDefined();
    // UUID pattern: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(found?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Date(found!.start_time).getFullYear()).toBeGreaterThan(2020);
    expect(new Date(found!.end_time).getFullYear()).toBeGreaterThan(2020);
  });
});

// ---------------------------------------------------------------------------
// TraceStore.write() — file created in temp dir
// ---------------------------------------------------------------------------

describe("TraceStore.write() via bus", () => {
  test("each START+END pair creates a new file in tracesDir", async () => {
    const uniqueDir = join(TMP, "traces-count-" + Date.now());
    bus.setTracesDir(uniqueDir);

    for (let i = 0; i < 3; i++) {
      const agentId = `count-agent-${i}`;
      bus.emit("LM_INFERENCE_START", {
        agent_id: agentId,
        model: "qwen3-32b",
        prompt_tokens: 10 * (i + 1),
        query_type: "general",
      });
      bus.emit("LM_INFERENCE_END", {
        agent_id: agentId,
        model: "qwen3-32b",
        prompt_tokens: 10 * (i + 1),
        completion_tokens: 5,
        latency_ms: 100,
        success: true,
      });
    }

    await Bun.sleep(80);

    const traces = await readTraces(uniqueDir);
    expect(traces.length).toBe(3);
  });

  test("readTraces returns empty array for non-existent dir", async () => {
    const result = await readTraces(join(TMP, "definitely-does-not-exist"));
    expect(result).toEqual([]);
  });
});
