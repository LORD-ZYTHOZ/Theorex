// tests/short-term/rrf.test.ts — TDD RED phase: all tests should FAIL until rrf.ts is implemented

import { test, expect } from "bun:test";
import { reciprocalRankFusion, type RankedId } from "../../src/short-term/rrf.ts";

// Test 1: Two lists with same entry at rank 1 each — fused score for shared entry > entries in only one list
test("shared entry at rank 1 in both lists has higher fused score than entry in only one list", () => {
  const bm25Results: RankedId[] = [
    { id: "shared", rank: 1 },
    { id: "bm25only", rank: 2 },
  ];
  const vectorResults: RankedId[] = [
    { id: "shared", rank: 1 },
    { id: "veconly", rank: 2 },
  ];

  const fused = reciprocalRankFusion(bm25Results, vectorResults);

  const sharedEntry = fused.find(r => r.id === "shared");
  const bm25onlyEntry = fused.find(r => r.id === "bm25only");
  const veconlyEntry = fused.find(r => r.id === "veconly");

  expect(sharedEntry).toBeDefined();
  expect(bm25onlyEntry).toBeDefined();
  expect(veconlyEntry).toBeDefined();
  expect(sharedEntry!.score).toBeGreaterThan(bm25onlyEntry!.score);
  expect(sharedEntry!.score).toBeGreaterThan(veconlyEntry!.score);
});

// Test 2: vectorResults=null — returns BM25 ranking unchanged (same order as input bm25Results)
test("vectorResults=null returns BM25-only ranking in original order", () => {
  const bm25Results: RankedId[] = [
    { id: "a", rank: 1 },
    { id: "b", rank: 2 },
    { id: "c", rank: 3 },
  ];

  const fused = reciprocalRankFusion(bm25Results, null);

  // Fused results should be sorted by score desc, which matches original BM25 rank order
  expect(fused.length).toBe(3);
  expect(fused[0].id).toBe("a");
  expect(fused[1].id).toBe("b");
  expect(fused[2].id).toBe("c");
});

// Test 3: RRF formula — entry at rank 1 in BM25 only gets score 1/(60+1) ≈ 0.01639
test("RRF formula: rank 1 BM25-only entry scores 1/(60+1) ≈ 0.01639", () => {
  const bm25Results: RankedId[] = [{ id: "doc", rank: 1 }];

  const fused = reciprocalRankFusion(bm25Results, null);

  expect(fused.length).toBe(1);
  expect(fused[0].id).toBe("doc");
  // 1 / (60 + 1) = 1/61 ≈ 0.016393...
  expect(fused[0].score).toBeCloseTo(1 / 61, 4);
});

// Test 4: Empty bm25Results with non-null vectorResults — returns vector ranking
test("empty bm25Results with vectorResults returns vector ranking", () => {
  const bm25Results: RankedId[] = [];
  const vectorResults: RankedId[] = [
    { id: "x", rank: 1 },
    { id: "y", rank: 2 },
  ];

  const fused = reciprocalRankFusion(bm25Results, vectorResults);

  expect(fused.length).toBe(2);
  expect(fused[0].id).toBe("x");
  expect(fused[1].id).toBe("y");
});

// Test 5: Both empty — returns []
test("both bm25Results and vectorResults empty returns []", () => {
  const fused = reciprocalRankFusion([], []);
  expect(fused).toEqual([]);
});
