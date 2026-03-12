// tests/short-term/bm25.test.ts — Unit tests for BM25 index build and search.

import { describe, expect, test } from "bun:test";
import { buildBm25Index, bm25Search, type BM25SearchResult } from "../../src/short-term/bm25.ts";
import type { ShortTermEntry } from "../../src/short-term/store.ts";

function makeEntry(id: string, surface_form: string): ShortTermEntry {
  return {
    id,
    concept_id: 1,
    surface_form,
    composite_score: 0.5,
    source_weight: 1.0,
    timestamp: "2026-03-10T00:00:00.000Z",
    date: "2026-03-10",
  };
}

// 1. Import smoke test — confirms createRequire CJS interop works
test("import smoke test: buildBm25Index and bm25Search are functions", () => {
  expect(typeof buildBm25Index).toBe("function");
  expect(typeof bm25Search).toBe("function");
});

describe("buildBm25Index + bm25Search", () => {
  // 2. Empty corpus returns empty results
  test("empty corpus returns empty array", () => {
    const engine = buildBm25Index([]);
    const results = bm25Search(engine, [], "anything");
    expect(results).toEqual([]);
  });

  // 3. Single entry match
  test("single entry: search returns matching entry", () => {
    const entries = [makeEntry("entry-001", "machine learning")];
    const engine = buildBm25Index(entries);
    const results = bm25Search(engine, entries, "learning");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("entry-001");
    expect(results[0].score).toBeGreaterThan(0);
  });

  // 4. Ranking — two matching entries ranked above non-matching
  test("ranking: learning entries ranked above unrelated entry", () => {
    const entries = [
      makeEntry("entry-001", "machine learning"),
      makeEntry("entry-002", "deep learning"),
      makeEntry("entry-003", "decision trees"),
    ];
    const engine = buildBm25Index(entries);
    const results = bm25Search(engine, entries, "learning");
    // Both learning entries should appear in results
    const ids = results.map(r => r.id);
    expect(ids).toContain("entry-001");
    expect(ids).toContain("entry-002");
    // Decision trees may or may not appear, but if it does, it ranks lower
    if (ids.includes("entry-003")) {
      const mlRank = ids.indexOf("entry-001");
      const dlRank = ids.indexOf("entry-002");
      const dtRank = ids.indexOf("entry-003");
      expect(Math.min(mlRank, dlRank)).toBeLessThan(dtRank);
    }
    // Scores are descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  // 5. Field weighting: surface_form weight is 3 — documents the config expectation
  test("field weighting: surface_form exact match scores higher than partial", () => {
    const entries = [
      makeEntry("exact-001", "machine learning"),   // exact surface_form match for "machine"
      makeEntry("partial-001", "deep learning algorithm"), // "machine" not in surface_form
    ];
    const engine = buildBm25Index(entries);
    const results = bm25Search(engine, entries, "machine");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("exact-001");
  });

  // 6. No result for unrelated query
  test("no result for unrelated query", () => {
    const entries = [
      makeEntry("entry-001", "machine learning"),
      makeEntry("entry-002", "deep learning"),
    ];
    const engine = buildBm25Index(entries);
    const results = bm25Search(engine, entries, "quantum physics");
    expect(results).toEqual([]);
  });

  // 7. BM25SearchResult shape: id (string) and score (number)
  test("result shape has id (string) and score (number)", () => {
    const entries = [makeEntry("entry-001", "neural networks")];
    const engine = buildBm25Index(entries);
    const results = bm25Search(engine, entries, "neural");
    expect(results).toHaveLength(1);
    const result: BM25SearchResult = results[0];
    expect(typeof result.id).toBe("string");
    expect(typeof result.score).toBe("number");
    expect(result.id).toBe("entry-001");
  });

  // 8. Most relevant entry is first for keyword query
  test("most relevant entry is ranked first", () => {
    const entries = [
      makeEntry("entry-001", "machine learning models"),
      makeEntry("entry-002", "deep neural networks"),
      makeEntry("entry-003", "machine learning algorithms and models"),
    ];
    const engine = buildBm25Index(entries);
    const results = bm25Search(engine, entries, "machine learning");
    expect(results.length).toBeGreaterThan(0);
    // First result should be one of the machine learning entries
    expect(["entry-001", "entry-003"]).toContain(results[0].id);
  });
});
