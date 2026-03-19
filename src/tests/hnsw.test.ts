// src/tests/hnsw.test.ts — Phase 9.5: HNSW live index
// Tests: buildHNSWIndex, searchHNSW, serialize/deserialize round-trip

import { describe, test, expect } from "bun:test";
import {
  buildHNSWIndex,
  searchHNSW,
  serializeHNSW,
  deserializeHNSW,
  type HNSWResult,
} from "../rag/hnsw";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic pseudo-unit vector of given dims seeded by integer */
function seedVec(dims: number, seed: number): number[] {
  const v = Array.from({ length: dims }, (_, i) => Math.sin(seed * (i + 1) * 0.37));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm < 1e-10 ? v : v.map((x) => x / norm);
}

/** Cosine distance (1 - similarity) — ground truth for brute-force checks */
function cosDist(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom < 1e-10 ? 1 : 1 - dot / denom;
}

// ---------------------------------------------------------------------------
// buildHNSWIndex / searchHNSW — core behaviour
// ---------------------------------------------------------------------------

describe("buildHNSWIndex + searchHNSW", () => {
  test("empty vectors — build succeeds, search returns []", () => {
    const index = buildHNSWIndex(new Map());
    const results = searchHNSW(index, new Map(), [1, 0, 0], 5);
    expect(results).toHaveLength(0);
  });

  test("single vector — search returns it with near-zero distance", () => {
    const v = [1, 0, 0];
    const vecs = new Map([["1", v]]);
    const index = buildHNSWIndex(vecs);
    const results = searchHNSW(index, vecs, v, 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
    expect(results[0].distance).toBeCloseTo(0, 4);
  });

  test("identical query — distance is 0", () => {
    const v = [0.6, 0.8];
    const vecs = new Map([["a", v], ["b", [0, 1]], ["c", [1, 0]]]);
    const index = buildHNSWIndex(vecs);
    const results = searchHNSW(index, vecs, v, 1);
    expect(results[0].id).toBe("a");
    expect(results[0].distance).toBeCloseTo(0, 4);
  });

  test("nearest neighbour is found correctly (3-D)", () => {
    const vecs = new Map([
      ["close", [0.98, 0.2, 0]],    // nearest to query [1,0,0]
      ["mid",   [0.7, 0.7, 0.14]],
      ["far",   [0, 1, 0]],
      ["anti",  [-1, 0, 0]],        // furthest
    ]);
    const index = buildHNSWIndex(vecs);
    const results = searchHNSW(index, vecs, [1, 0, 0], 1);
    expect(results[0].id).toBe("close");
  });

  test("top-2 result set contains 2 closest", () => {
    const vecs = new Map([
      ["a", [1, 0, 0]],
      ["b", [0.9, 0.44, 0]],
      ["c", [0, 1, 0]],
      ["d", [-1, 0, 0]],
    ]);
    const index = buildHNSWIndex(vecs);
    const results = searchHNSW(index, vecs, [1, 0, 0], 2);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("d");
  });

  test("topK clamped when k > total nodes", () => {
    const vecs = new Map([["x", [1, 0]], ["y", [0, 1]]]);
    const index = buildHNSWIndex(vecs);
    const results = searchHNSW(index, vecs, [1, 0], 100);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("results are sorted ascending by distance", () => {
    const vecs = new Map([
      ["1", [1, 0]],
      ["2", [0.8, 0.6]],
      ["3", [0, 1]],
      ["4", [-1, 0]],
    ]);
    const index = buildHNSWIndex(vecs);
    const results = searchHNSW(index, vecs, [1, 0], 4);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  test("all returned distances are ≥ 0", () => {
    const vecs = new Map<string, number[]>();
    for (let i = 0; i < 10; i++) vecs.set(String(i), seedVec(8, i));
    const index = buildHNSWIndex(vecs);
    const query = seedVec(8, 99);
    const results = searchHNSW(index, vecs, query, 5);
    for (const r of results) {
      expect(r.distance).toBeGreaterThanOrEqual(0);
    }
  });

  test("no duplicate ids in results", () => {
    const vecs = new Map<string, number[]>();
    for (let i = 0; i < 20; i++) vecs.set(String(i), seedVec(16, i));
    const index = buildHNSWIndex(vecs);
    const results = searchHNSW(index, vecs, seedVec(16, 99), 10);
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("larger dataset (50 nodes, 16-D): HNSW recall ≥ 80% vs brute-force", () => {
    const dim = 16;
    const vecs = new Map<string, number[]>();
    for (let i = 0; i < 50; i++) vecs.set(String(i), seedVec(dim, i));
    const query = seedVec(dim, 99);

    const index = buildHNSWIndex(vecs);
    const hnswTop5 = new Set(searchHNSW(index, vecs, query, 5).map((r) => r.id));

    const bfTop5 = new Set(
      [...vecs.entries()]
        .map(([id, v]) => ({ id, d: cosDist(query, v) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 5)
        .map((x) => x.id),
    );

    const overlap = [...bfTop5].filter((id) => hnswTop5.has(id)).length;
    expect(overlap).toBeGreaterThanOrEqual(4); // ≥ 80% recall
  });
});

// ---------------------------------------------------------------------------
// Serialize / deserialize
// ---------------------------------------------------------------------------

describe("serializeHNSW / deserializeHNSW", () => {
  test("round-trip: serialized is valid JSON", () => {
    const vecs = new Map([["1", [1, 0]], ["2", [0, 1]], ["3", [0.7, 0.7]]]);
    const index = buildHNSWIndex(vecs);
    const s = serializeHNSW(index);
    expect(() => JSON.parse(JSON.stringify(s))).not.toThrow();
  });

  test("round-trip: search results identical before/after serialization", () => {
    const dim = 8;
    const vecs = new Map<string, number[]>();
    for (let i = 0; i < 15; i++) vecs.set(String(i), seedVec(dim, i));
    const query = seedVec(dim, 42);

    const index = buildHNSWIndex(vecs);
    const before = searchHNSW(index, vecs, query, 5).map((r) => r.id);

    const restored = deserializeHNSW(serializeHNSW(index));
    const after = searchHNSW(restored, vecs, query, 5).map((r) => r.id);

    expect(after).toEqual(before);
  });

  test("round-trip: entrypoint and maxLevel preserved", () => {
    const vecs = new Map([["a", [1, 0, 0]], ["b", [0, 1, 0]], ["c", [0, 0, 1]]]);
    const index = buildHNSWIndex(vecs);
    const restored = deserializeHNSW(serializeHNSW(index));
    expect(restored.entrypoint).toBe(index.entrypoint);
    expect(restored.maxLevel).toBe(index.maxLevel);
    expect(restored.M).toBe(index.M);
  });
});
