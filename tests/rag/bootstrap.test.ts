import { test, expect, describe } from "bun:test";
import { findKNN } from "../../src/rag/bootstrap";

// Fixed 4-dim test vectors (simplified from 384-dim for unit test speed)
const makeVec = (vals: number[]): number[] => vals;

const STORE: Record<string, number[]> = {
  "100": makeVec([1, 0, 0, 0]),
  "200": makeVec([0.9, 0.1, 0, 0]),   // high similarity to query
  "300": makeVec([0, 1, 0, 0]),        // low similarity
  "400": makeVec([0.85, 0.15, 0, 0]), // medium-high similarity
};

const QUERY_VEC = makeVec([1, 0, 0, 0]); // identical to concept 100

describe("findKNN", () => {
  test("returns 2-5 seeded results for concept with neighbours above threshold", async () => {
    const results = await findKNN(QUERY_VEC, STORE, 999, 5, 0.4);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("excludes the new concept itself from KNN results", async () => {
    const results = await findKNN(QUERY_VEC, STORE, 100, 5, 0.4);
    const ids = results.map(r => r.targetConceptId);
    expect(ids).not.toContain(100);
  });

  test("all seeded edge weights are in range 0.1–0.2", async () => {
    const results = await findKNN(QUERY_VEC, STORE, 999, 5, 0.4);
    for (const r of results) {
      expect(r.edgeWeight).toBeGreaterThanOrEqual(0.1);
      expect(r.edgeWeight).toBeLessThanOrEqual(0.2);
    }
  });

  test("returns empty array when no neighbours meet minSimilarity threshold", async () => {
    const dissimilarVec = makeVec([0, 0, 0, 1]); // orthogonal to all stored
    const results = await findKNN(dissimilarVec, STORE, 999, 5, 0.9);
    expect(results).toHaveLength(0);
  });

  test("returns empty array when embeddingStore is empty", async () => {
    const results = await findKNN(QUERY_VEC, {}, 999, 5, 0.4);
    expect(results).toHaveLength(0);
  });
});
