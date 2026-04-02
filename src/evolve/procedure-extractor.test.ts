/**
 * procedure-extractor.test.ts — Stage 6A unit tests.
 * Mocks fetch (Ollama) and PostgresStore procedure methods.
 * No real network calls.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  extractAndSaveProcedures,
  refineProcedure,
  shouldAutoExtract,
} from "./procedure-extractor";
import type { ProcedureExtractionInput } from "./procedure-extractor";
import type { PostgresStore } from "../axon/postgres-store";
import type { FlashEvent } from "../flash/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(saveFn?: () => Promise<void>): PostgresStore {
  return {
    saveProcedure: saveFn ?? (() => Promise.resolve()),
  } as unknown as PostgresStore;
}

function makeInput(
  overrides: Partial<ProcedureExtractionInput> = {},
): ProcedureExtractionInput {
  return {
    agentId: "test-agent",
    recentConcepts: [
      { label: "london breakout", memory_type: "episode", meta: { importance: 0.8 } },
      { label: "set SL at swing low", memory_type: "procedure", meta: {} },
      { label: "wait for candle close", memory_type: "procedure", meta: {} },
    ],
    sessionNote: "Refined the London breakout entry procedure today.",
    ...overrides,
  };
}

function buildFetchMock(responseText: string, ok = true) {
  return mock(async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ response: responseText }),
    } as unknown as Response),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractAndSaveProcedures", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("happy path: LLM returns valid procedures → saved and returned", async () => {
    const llmPayload = JSON.stringify([
      {
        name: "London Breakout Entry",
        steps: [
          "Wait for London open at 08:00 GMT",
          "Identify Asian session range high/low",
          "Enter long on break above range high with candle close confirmation",
          "Set SL at swing low minus 5 pips",
        ],
        conditions: "Only during London session, after major news cleared",
        tools: ["M15 chart", "ATR indicator"],
      },
    ]);

    globalThis.fetch = buildFetchMock(llmPayload);

    const saved: Array<{ name: string; steps: string[] }> = [];
    const store = makeStore();
    (store as unknown as { saveProcedure: unknown }).saveProcedure = async (
      name: string,
      steps: string[],
      _conditions?: string,
      _tools?: string[],
    ) => {
      saved.push({ name, steps });
    };

    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("London Breakout Entry");
    expect(result[0].steps).toHaveLength(4);
    expect(result[0].steps[0]).toContain("London open");
    expect(result[0].conditions).toContain("London session");
    expect(result[0].tools).toContain("ATR indicator");
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("London Breakout Entry");
  });

  test("multiple procedures extracted in one call", async () => {
    const llmPayload = JSON.stringify([
      {
        name: "Entry Checklist",
        steps: ["Check trend", "Confirm momentum", "Enter"],
      },
      {
        name: "Exit Checklist",
        steps: ["Check target", "Trail stop", "Close at resistance"],
      },
    ]);

    globalThis.fetch = buildFetchMock(llmPayload);

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Entry Checklist");
    expect(result[1].name).toBe("Exit Checklist");
  });

  test("LLM returns malformed JSON → returns [] without throwing", async () => {
    globalThis.fetch = buildFetchMock("not valid json at all %%$#");

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toEqual([]);
  });

  test("LLM returns non-array JSON → returns [] without throwing", async () => {
    globalThis.fetch = buildFetchMock(JSON.stringify({ summary: "wrong shape" }));

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toEqual([]);
  });

  test("empty concepts input → still calls LLM, handles gracefully", async () => {
    const llmPayload = JSON.stringify([
      { name: "Generic Workflow", steps: ["Step 1", "Step 2"] },
    ]);

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: llmPayload }),
      } as unknown as Response;
    });

    const saved: string[] = [];
    const store = {
      saveProcedure: async (name: string) => {
        saved.push(name);
      },
    } as unknown as PostgresStore;

    const input = makeInput({ recentConcepts: [] });
    const result = await extractAndSaveProcedures(input, store);

    expect(fetchCalled).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Generic Workflow");
    expect(saved).toContain("Generic Workflow");
  });

  test("Ollama returns non-ok status → returns [] without throwing", async () => {
    globalThis.fetch = buildFetchMock("", false);

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toEqual([]);
  });

  test("items missing required fields are filtered out", async () => {
    const llmPayload = JSON.stringify([
      { name: "Valid Procedure", steps: ["Step 1", "Step 2"] },
      { name: "No Steps" },                    // missing steps
      { steps: ["orphan step"] },              // missing name
      "not an object",
      { name: "Empty Steps", steps: [] },      // empty steps array — still valid
      { name: 123, steps: ["step"] },          // name not string
    ]);

    globalThis.fetch = buildFetchMock(llmPayload);

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Valid Procedure");
    expect(result[1].name).toBe("Empty Steps");
  });

  test("steps with non-string items are filtered out", async () => {
    const llmPayload = JSON.stringify([
      { name: "Mixed Steps", steps: ["valid step", 42, null, "another valid"] },
    ]);

    globalThis.fetch = buildFetchMock(llmPayload);

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toHaveLength(1);
    expect(result[0].steps).toEqual(["valid step", "another valid"]);
  });

  test("optional conditions and tools default to undefined when absent", async () => {
    const llmPayload = JSON.stringify([
      { name: "Bare Procedure", steps: ["Do thing"] },
    ]);

    globalThis.fetch = buildFetchMock(llmPayload);

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toHaveLength(1);
    expect(result[0].conditions).toBeUndefined();
    expect(result[0].tools).toBeUndefined();
  });

  test("fetch throws network error → returns [] without throwing", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    });

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toEqual([]);
  });

  test("JSON embedded in freeform text is extracted", async () => {
    const wrapped = `Here are the procedures:\n${JSON.stringify([
      { name: "Embedded", steps: ["Step A"] },
    ])}\nDone.`;

    globalThis.fetch = buildFetchMock(wrapped);

    const store = makeStore();
    const result = await extractAndSaveProcedures(makeInput(), store);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Embedded");
  });
});

// ---------------------------------------------------------------------------
// shouldAutoExtract — multi-step detection heuristic
// ---------------------------------------------------------------------------

describe("shouldAutoExtract", () => {
  function makeEvent(overrides: Partial<FlashEvent> = {}): FlashEvent {
    return {
      tool_name: "Edit",
      tool_input_preview: '{"file_path":"/src/foo.ts"}',
      tool_response_preview: "ok",
      timestamp: "2026-04-02T10:00:00Z",
      significance_score: 1,
      ...overrides,
    };
  }

  test("returns true when >= 3 distinct significant tool types used", () => {
    const events: FlashEvent[] = [
      makeEvent({ tool_name: "Edit" }),
      makeEvent({ tool_name: "Bash" }),
      makeEvent({ tool_name: "Read" }),
      makeEvent({ tool_name: "Edit" }), // duplicate tool, shouldn't count extra
    ];
    expect(shouldAutoExtract(events)).toBe(true);
  });

  test("returns false with fewer than 3 distinct tool types", () => {
    const events: FlashEvent[] = [
      makeEvent({ tool_name: "Edit" }),
      makeEvent({ tool_name: "Edit" }),
      makeEvent({ tool_name: "Read" }),
    ];
    expect(shouldAutoExtract(events)).toBe(false);
  });

  test("returns false with empty events", () => {
    expect(shouldAutoExtract([])).toBe(false);
  });

  test("ignores low-significance events", () => {
    const events: FlashEvent[] = [
      makeEvent({ tool_name: "Edit", significance_score: 1 }),
      makeEvent({ tool_name: "Bash", significance_score: 0.3 }), // below threshold
      makeEvent({ tool_name: "Read", significance_score: 1 }),
      makeEvent({ tool_name: "Write", significance_score: 0.2 }), // below threshold
    ];
    expect(shouldAutoExtract(events)).toBe(false); // only 2 significant distinct tools
  });

  test("returns true when procedure-type keywords appear in tool input", () => {
    const events: FlashEvent[] = [
      makeEvent({ tool_name: "Edit", tool_input_preview: "how to deploy the service" }),
      makeEvent({ tool_name: "Bash" }),
    ];
    // keyword "how to" triggers even with < 3 tools
    expect(shouldAutoExtract(events)).toBe(true);
  });

  test("returns true when >= 5 significant events (high activity session)", () => {
    const events: FlashEvent[] = [
      makeEvent({ tool_name: "Edit" }),
      makeEvent({ tool_name: "Edit" }),
      makeEvent({ tool_name: "Edit" }),
      makeEvent({ tool_name: "Edit" }),
      makeEvent({ tool_name: "Edit" }),
    ];
    expect(shouldAutoExtract(events)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// refineProcedure — compare outcome to stored procedure, refine steps
// ---------------------------------------------------------------------------

describe("refineProcedure", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("happy path: LLM returns refined steps → saves updated procedure", async () => {
    const refinedPayload = JSON.stringify({
      name: "London Breakout Entry",
      steps: [
        "Wait for London open at 08:00 GMT",
        "Confirm no major news in next 30 min",
        "Identify Asian session range high/low",
        "Enter long on break above range high with M15 candle close",
        "Set SL at swing low minus 3 pips (tighter than before)",
      ],
      conditions: "London session only, after news cleared, avoid Friday",
    });

    globalThis.fetch = buildFetchMock(refinedPayload);

    let savedSteps: string[] = [];
    const store = {
      getProcedure: async () => ({
        name: "London Breakout Entry",
        steps: ["Wait for London open", "Enter on breakout", "Set SL"],
        conditions: "London session",
      }),
      saveProcedure: async (_name: string, steps: string[]) => {
        savedSteps = steps;
        return "uuid";
      },
    } as unknown as PostgresStore;

    const result = await refineProcedure(
      "London Breakout Entry",
      "Took the trade but SL was too wide, tightened to 3 pips and added news check",
      store,
    );

    expect(result).not.toBeNull();
    expect(result!.steps.length).toBeGreaterThan(3);
    expect(savedSteps.length).toBeGreaterThan(0);
  });

  test("procedure not found → returns null without LLM call", async () => {
    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    const store = {
      getProcedure: async () => null,
    } as unknown as PostgresStore;

    const result = await refineProcedure("Nonexistent", "some feedback", store);

    expect(result).toBeNull();
    expect(fetchCalled).toBe(false);
  });

  test("LLM returns malformed response → returns null without saving", async () => {
    globalThis.fetch = buildFetchMock("garbage response !@#");

    let saveCalled = false;
    const store = {
      getProcedure: async () => ({
        name: "Test",
        steps: ["Step 1"],
      }),
      saveProcedure: async () => {
        saveCalled = true;
        return "uuid";
      },
    } as unknown as PostgresStore;

    const result = await refineProcedure("Test", "feedback", store);

    expect(result).toBeNull();
    expect(saveCalled).toBe(false);
  });

  test("Ollama unavailable → returns null without throwing", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    });

    const store = {
      getProcedure: async () => ({
        name: "Test",
        steps: ["Step 1"],
      }),
    } as unknown as PostgresStore;

    const result = await refineProcedure("Test", "feedback", store);

    expect(result).toBeNull();
  });
});
