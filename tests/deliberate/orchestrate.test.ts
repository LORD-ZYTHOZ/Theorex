// tests/deliberate/orchestrate.test.ts — Tests for the deliberation orchestrator.

import { describe, test, expect, mock } from "bun:test";
import { runDeliberation } from "../../src/deliberate/orchestrate";
import type { RunDeliberationOpts } from "../../src/deliberate/orchestrate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseOpts(overrides: Partial<RunDeliberationOpts> = {}): RunDeliberationOpts {
  return {
    session: "asian",
    date: "2026-03-24",
    paths: {
      singularity: "/tmp/test-singularity",
      divergent: "/tmp/test-divergent",
      horizon: "/tmp/test-horizon",
    },
    outputDir: "/tmp/test-output",
    model: "test-model",
    dispatch: async () => JSON.stringify({
      alignments: ["engines agreed on long bias"],
      conflicts: [],
      blind_spots: [],
      missed_opportunities: [],
      takeaways: [
        {
          insight: "Strong momentum during Asian open",
          test_condition: "price > vwap",
          engines_involved: ["singularity", "divergent"],
          confidence: 0.85,
        },
      ],
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDeliberation", () => {
  test("returns a complete DeliberationRecord on success", async () => {
    const opts = baseOpts();
    const record = await runDeliberation(opts);

    expect(record.status).toBe("complete");
    expect(record.session).toBe("asian");
    expect(record.date).toBe("2026-03-24");
    expect(record.model).toBe("test-model");
    expect(record.id).toBeTruthy();
    expect(record.created_at).toBeTruthy();
    expect(record.completed_at).toBeTruthy();
    expect(record.response).toBeTruthy();
    expect(record.prompt).toBeTruthy();
    expect(record.error).toBeUndefined();
  });

  test("record has a valid packet with perspectives", async () => {
    const opts = baseOpts();
    const record = await runDeliberation(opts);

    expect(record.packet).toBeDefined();
    expect(record.packet.session).toBe("asian");
    expect(record.packet.date).toBe("2026-03-24");
    expect(Array.isArray(record.packet.perspectives)).toBe(true);
  });

  test("passes prompt to dispatch function", async () => {
    let capturedPrompt = "";
    const opts = baseOpts({
      dispatch: async (prompt: string) => {
        capturedPrompt = prompt;
        return JSON.stringify({ alignments: [], conflicts: [], blind_spots: [], missed_opportunities: [], takeaways: [] });
      },
    });

    await runDeliberation(opts);

    expect(capturedPrompt.length).toBeGreaterThan(0);
    // The orchestrator prompt should mention the session
    expect(capturedPrompt).toContain("asian");
  });

  test("returns error record when dispatch throws", async () => {
    const opts = baseOpts({
      dispatch: async () => {
        throw new Error("LLM timeout");
      },
    });

    const record = await runDeliberation(opts);

    expect(record.status).toBe("error");
    expect(record.error).toContain("LLM timeout");
    expect(record.response).toBeUndefined();
    expect(record.completed_at).toBeTruthy();
  });

  test("uses default model when not specified", async () => {
    const { model: _, ...rest } = baseOpts();
    const opts: RunDeliberationOpts = {
      ...rest,
      dispatch: rest.dispatch,
    };

    const record = await runDeliberation(opts);

    expect(record.model).toBeTruthy();
    // Should have some default model string
    expect(typeof record.model).toBe("string");
  });

  test("latency_ms is populated on success", async () => {
    const opts = baseOpts();
    const record = await runDeliberation(opts);

    expect(record.latency_ms).toBeDefined();
    expect(typeof record.latency_ms).toBe("number");
    expect(record.latency_ms!).toBeGreaterThanOrEqual(0);
  });

  test("latency_ms is populated on error", async () => {
    const opts = baseOpts({
      dispatch: async () => { throw new Error("fail"); },
    });
    const record = await runDeliberation(opts);

    expect(record.latency_ms).toBeDefined();
    expect(typeof record.latency_ms).toBe("number");
  });
});
