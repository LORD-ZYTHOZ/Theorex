/**
 * session-summarizer.test.ts — Stage 3D unit tests.
 * Mocks fetch (Ollama) and PostgresStore.saveSessionSummary.
 * No real network calls.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { summarizeAndSaveSession } from "./session-summarizer";
import type { SessionSummaryInput } from "./session-summarizer";
import type { PostgresStore } from "../axon/postgres-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(saveFn?: (id: string, summary: string, decisions: unknown[]) => Promise<void>): PostgresStore {
  return {
    saveSessionSummary: saveFn ?? (() => Promise.resolve()),
  } as unknown as PostgresStore;
}

function makeInput(overrides: Partial<SessionSummaryInput> = {}): SessionSummaryInput {
  return {
    sessionId: "session-2026-03-31T09:00:00Z",
    agentId: "test-agent",
    concepts: [
      { label: "london breakout", memory_type: "episode" },
      { label: "1% risk rule", memory_type: "preference" },
    ],
    events: ["entered long XAUUSD at 2350", "closed at +120 pips"],
    notes: "Solid execution day. Stayed patient during NY open.",
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

describe("summarizeAndSaveSession", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("happy path: LLM returns valid JSON → summary saved and result returned", async () => {
    const llmPayload = JSON.stringify({
      summary: "Executed a disciplined london breakout session with strong risk management.",
      key_decisions: ["Waited for HTF confirmation", "Sized 1% risk per trade"],
    });

    globalThis.fetch = buildFetchMock(llmPayload);

    const saved: Array<{ id: string; summary: string; decisions: unknown[] }> = [];
    const store = {
      saveSessionSummary: async (id: string, summary: string, decisions: unknown[]) => {
        saved.push({ id, summary, decisions });
      },
    } as unknown as PostgresStore;

    const result = await summarizeAndSaveSession(makeInput(), store);

    expect(result.summary).toBe(
      "Executed a disciplined london breakout session with strong risk management.",
    );
    expect(result.keyDecisions).toHaveLength(2);
    expect(result.keyDecisions[0]).toBe("Waited for HTF confirmation");

    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("session-2026-03-31T09:00:00Z");
    expect(saved[0].summary).toBe(result.summary);
    expect(saved[0].decisions).toEqual(result.keyDecisions);
  });

  test("LLM returns malformed JSON → returns fallback {summary:'',keyDecisions:[]} without throwing", async () => {
    globalThis.fetch = buildFetchMock("definitely not json ## $$");

    const store = makeStore();
    const result = await summarizeAndSaveSession(makeInput(), store);

    expect(result.summary).toBe("");
    expect(result.keyDecisions).toEqual([]);
  });

  test("LLM returns malformed JSON → saveSessionSummary is NOT called", async () => {
    globalThis.fetch = buildFetchMock("not valid json at all %%$#");

    let saveCalled = false;
    const store = makeStore(async () => {
      saveCalled = true;
    });

    await summarizeAndSaveSession(makeInput(), store);

    expect(saveCalled).toBe(false);
  });

  test("LLM returns JSON with missing fields → partial data recovered gracefully", async () => {
    // summary present but key_decisions missing
    const llmPayload = JSON.stringify({ summary: "partial summary only" });

    globalThis.fetch = buildFetchMock(llmPayload);

    const saved: string[] = [];
    const store = {
      saveSessionSummary: async (_id: string, summary: string) => {
        saved.push(summary);
      },
    } as unknown as PostgresStore;

    const result = await summarizeAndSaveSession(makeInput(), store);

    expect(result.summary).toBe("partial summary only");
    expect(result.keyDecisions).toEqual([]);
    expect(saved).toContain("partial summary only");
  });

  test("empty concepts → still calls LLM and handles gracefully", async () => {
    const llmPayload = JSON.stringify({
      summary: "Sparse session with no notable concepts.",
      key_decisions: [],
    });

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
      saveSessionSummary: async (_id: string, summary: string) => {
        saved.push(summary);
      },
    } as unknown as PostgresStore;

    const input = makeInput({ concepts: [] });
    const result = await summarizeAndSaveSession(input, store);

    expect(fetchCalled).toBe(true);
    expect(result.summary).toBe("Sparse session with no notable concepts.");
    expect(result.keyDecisions).toEqual([]);
    expect(saved).toHaveLength(1);
  });

  test("Ollama returns non-ok status → returns fallback without throwing", async () => {
    globalThis.fetch = buildFetchMock("", false);

    const store = makeStore();
    const result = await summarizeAndSaveSession(makeInput(), store);

    expect(result.summary).toBe("");
    expect(result.keyDecisions).toEqual([]);
  });

  test("key_decisions filters out non-string entries", async () => {
    const llmPayload = JSON.stringify({
      summary: "Session done.",
      key_decisions: ["valid decision", 42, null, "another valid"],
    });

    globalThis.fetch = buildFetchMock(llmPayload);

    const store = makeStore();
    const result = await summarizeAndSaveSession(makeInput(), store);

    expect(result.keyDecisions).toEqual(["valid decision", "another valid"]);
  });
});
