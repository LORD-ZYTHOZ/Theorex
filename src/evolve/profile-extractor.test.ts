/**
 * profile-extractor.test.ts — Stage 3D unit tests.
 * Mocks fetch (Ollama) and PostgresStore.upsertProfile.
 * No real network calls.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { extractAndSaveProfiles } from "./profile-extractor";
import type { ProfileExtractionInput } from "./profile-extractor";
import type { PostgresStore } from "../axon/postgres-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(upsertFn?: () => Promise<void>): PostgresStore {
  return {
    upsertProfile: upsertFn ?? (() => Promise.resolve()),
  } as unknown as PostgresStore;
}

function makeInput(
  overrides: Partial<ProfileExtractionInput> = {},
): ProfileExtractionInput {
  return {
    agentId: "test-agent",
    recentConcepts: [
      { label: "london breakout", memory_type: "episode", meta: { importance: 0.8 } },
      { label: "risk 1%", memory_type: "preference", meta: {} },
    ],
    outcomes: [
      { direction: "long", pnl: 120, meta: {} },
      { direction: "short", pnl: -40, meta: {} },
    ],
    sessionNote: "Focused on London session entries today.",
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

describe("extractAndSaveProfiles", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("happy path: LLM returns valid JSON array → profiles upserted and returned", async () => {
    const llmPayload = JSON.stringify([
      { subject: "trading_style", traits: { style: "breakout", timeframe: "M15" } },
      { subject: "risk_preferences", traits: { risk_per_trade: "1%" } },
    ]);

    globalThis.fetch = buildFetchMock(llmPayload);

    const upserted: Array<{ subject: string; traits: Record<string, unknown> }> = [];
    const store = makeStore(async (subject: string, traits: Record<string, unknown>) => {
      upserted.push({ subject, traits });
    }) as unknown as PostgresStore;
    (store as unknown as { upsertProfile: (s: string, t: Record<string, unknown>) => Promise<void> }).upsertProfile =
      async (subject: string, traits: Record<string, unknown>) => {
        upserted.push({ subject, traits });
      };

    const result = await extractAndSaveProfiles(makeInput(), store);

    expect(result).toHaveLength(2);
    expect(result[0].subject).toBe("trading_style");
    expect(result[0].traits).toEqual({ style: "breakout", timeframe: "M15" });
    expect(result[1].subject).toBe("risk_preferences");
    expect(upserted).toHaveLength(2);
    expect(upserted[0].subject).toBe("trading_style");
  });

  test("LLM returns malformed JSON → returns [] without throwing", async () => {
    globalThis.fetch = buildFetchMock("not valid json at all %%$#");

    const store = makeStore();
    const result = await extractAndSaveProfiles(makeInput(), store);

    expect(result).toEqual([]);
  });

  test("LLM returns non-array JSON → returns [] without throwing", async () => {
    globalThis.fetch = buildFetchMock(JSON.stringify({ summary: "wrong shape" }));

    const store = makeStore();
    const result = await extractAndSaveProfiles(makeInput(), store);

    expect(result).toEqual([]);
  });

  test("empty concepts input → still calls LLM, handles gracefully", async () => {
    const llmPayload = JSON.stringify([
      { subject: "market_views", traits: { bias: "neutral" } },
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

    const upserted: string[] = [];
    const store = {
      upsertProfile: async (subject: string) => {
        upserted.push(subject);
      },
    } as unknown as PostgresStore;

    const input = makeInput({ recentConcepts: [] });
    const result = await extractAndSaveProfiles(input, store);

    expect(fetchCalled).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("market_views");
    expect(upserted).toContain("market_views");
  });

  test("Ollama returns non-ok status → returns [] without throwing", async () => {
    globalThis.fetch = buildFetchMock("", false);

    const store = makeStore();
    const result = await extractAndSaveProfiles(makeInput(), store);

    expect(result).toEqual([]);
  });

  test("items missing required fields are filtered out", async () => {
    const llmPayload = JSON.stringify([
      { subject: "trading_style", traits: { style: "scalp" } },
      { subject: "bad_item" }, // missing traits
      { traits: { x: 1 } },   // missing subject
      "not an object",
    ]);

    globalThis.fetch = buildFetchMock(llmPayload);

    const store = makeStore();
    const result = await extractAndSaveProfiles(makeInput(), store);

    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("trading_style");
  });
});
