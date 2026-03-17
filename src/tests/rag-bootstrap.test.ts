// tests/rag-bootstrap.test.ts — Tests for src/rag/bootstrap.ts findKNN (pure function).
// seedEdges requires live LM Studio — not tested here.

import { describe, test, expect } from "bun:test";
import { findKNN } from "../rag/bootstrap";

// ---------------------------------------------------------------------------
// findKNN — pure KNN scan
// ---------------------------------------------------------------------------

describe("findKNN()", () => {
  // Unit vectors: easy to reason about cosine similarity
  const store: Record<string, number[]> = {
    "1": [1, 0, 0],
    "2": [0, 1, 0],
    "3": [0, 0, 1],
    "4": [0.9, 0.1, 0],
    "5": [0.8, 0.6, 0],
  };

  test("returns results above minSimilarity sorted by descending similarity", async () => {
    const query = [1, 0, 0]; // identical to id=1
    const results = await findKNN(query, store, 99, 5, 0.4);

    // All results >= 0.4 similarity
    expect(results.every((r) => r.similarity >= 0.4)).toBe(true);

    // Sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(results[i]!.similarity);
    }
  });

  test("excludes the concept being inserted (excludeConceptId)", async () => {
    const query = [1, 0, 0]; // matches id=1 perfectly
    const results = await findKNN(query, store, 1, 5, 0.4);
    expect(results.every((r) => r.targetConceptId !== 1)).toBe(true);
  });

  test("respects k limit", async () => {
    const query = [1, 0, 0];
    const results = await findKNN(query, store, 99, 2, 0.0);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("returns empty array when no results above minSimilarity", async () => {
    // Use a completely orthogonal query — cosine similarity to all unit vectors will be 0
    const query = [0, 0, 1]; // only id=3 matches, exclude it too
    const results = await findKNN(query, { "1": [1, 0, 0], "2": [0, 1, 0] }, 99, 5, 0.5);
    expect(results.length).toBe(0);
  });

  test("returns empty array for empty store", async () => {
    const results = await findKNN([1, 0, 0], {}, 99, 5, 0.4);
    expect(results.length).toBe(0);
  });

  test("edgeWeight is within [0.1, 0.2] for all results", async () => {
    const query = [1, 0, 0];
    const results = await findKNN(query, store, 99, 5, 0.0);
    for (const r of results) {
      expect(r.edgeWeight).toBeGreaterThanOrEqual(0.1);
      expect(r.edgeWeight).toBeLessThanOrEqual(0.2);
    }
  });

  test("perfect match (similarity=1.0) gets maximum edgeWeight=0.2", async () => {
    const query = [1, 0, 0]; // matches id=1
    const results = await findKNN(query, { "1": [1, 0, 0] }, 99, 5, 0.0);
    expect(results.length).toBe(1);
    expect(results[0]!.similarity).toBeCloseTo(1.0, 3);
    expect(results[0]!.edgeWeight).toBeCloseTo(0.2, 3);
  });

  test("result at minSimilarity threshold gets minimum edgeWeight=0.1", async () => {
    // At exactly minSimilarity=0.4: edgeWeight = 0.1 + (0.4 - 0.4) * 0.2 = 0.1
    // Construct a vector with exactly 0.4 cosine similarity to [1,0,0]
    // cos([1,0,0], [0.4, sqrt(1-0.16), 0]) = 0.4
    const cos = 0.4;
    const sin = Math.sqrt(1 - cos * cos);
    const query = [1, 0, 0];
    const targetVec = [cos, sin, 0];
    const results = await findKNN(query, { "100": targetVec }, 99, 5, 0.4);
    expect(results.length).toBe(1);
    expect(results[0]!.edgeWeight).toBeCloseTo(0.1, 3);
  });

  test("targetConceptId is correctly parsed as number", async () => {
    const results = await findKNN([1, 0, 0], { "42": [1, 0, 0] }, 99, 5, 0.0);
    expect(typeof results[0]?.targetConceptId).toBe("number");
    expect(results[0]?.targetConceptId).toBe(42);
  });
});
