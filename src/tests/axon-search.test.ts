// tests/axon-search.test.ts — Phase 4.5: Semantic axon concept search
// Tests: searchAxon (text match), searchAxonSemantic (cosine), mergeAxonResults

import { describe, test, expect } from "bun:test";
import {
  textMatchAxon,
  semanticSearchAxon,
  mergeAxonResults,
  type AxonSearchResult,
} from "../rag/axon-search";
import type { AxonNodeAttrs } from "../axon/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  conceptId: number,
  surfaceForm: string,
  overrides: Partial<AxonNodeAttrs> = {}
): AxonNodeAttrs {
  return {
    concept_id: conceptId,
    surface_form: surfaceForm,
    importance_weight: 0.8,
    relevance_tier: "ACTIVE",
    archive_id: "",
    sentiment_tier: "NEUTRAL",
    source_weight: 1.0,
    frequency_count: 1,
    node_type: "concept",
    last_seen: "2026-03-19T00:00:00.000Z",
    observation_type: "discovery",
    agent_id: "main",
    ...overrides,
  };
}

const NODES: AxonNodeAttrs[] = [
  makeNode(1, "risk management"),
  makeNode(2, "position sizing"),
  makeNode(3, "XAUUSD spot trading"),
  makeNode(4, "python refactor"),
  makeNode(5, "trade execution"),
  makeNode(6, "drawdown control"),
];

// ---------------------------------------------------------------------------
// textMatchAxon
// ---------------------------------------------------------------------------

describe("textMatchAxon()", () => {
  test("returns nodes matching query term", () => {
    const results = textMatchAxon("trad", NODES, 10);
    const forms = results.map((r) => r.surface_form);
    expect(forms).toContain("XAUUSD spot trading");
    expect(forms).toContain("trade execution");
  });

  test("case-insensitive match", () => {
    const results = textMatchAxon("RISK", NODES, 10);
    expect(results.map((r) => r.surface_form)).toContain("risk management");
  });

  test("matches partial words", () => {
    const results = textMatchAxon("pos", NODES, 10);
    expect(results.map((r) => r.surface_form)).toContain("position sizing");
  });

  test("returns empty array when no match", () => {
    const results = textMatchAxon("blockchain nft", NODES, 10);
    expect(results).toHaveLength(0);
  });

  test("respects topK limit", () => {
    const results = textMatchAxon("a", NODES, 2); // many match "a"
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("returns empty array for empty nodes", () => {
    const results = textMatchAxon("trade", [], 10);
    expect(results).toHaveLength(0);
  });

  test("assigns non-zero score to matches", () => {
    const results = textMatchAxon("risk management", NODES, 10);
    const match = results.find((r) => r.surface_form === "risk management");
    expect(match).toBeDefined();
    expect(match!.score).toBeGreaterThan(0);
  });

  test("higher significance nodes rank better for same query", () => {
    const highScore = makeNode(10, "risk analysis", { importance_weight: 0.9 });
    const lowScore  = makeNode(11, "risk check",    { importance_weight: 0.2 });
    const results = textMatchAxon("risk", [highScore, lowScore], 10);
    const highIdx = results.findIndex((r) => r.concept_id === 10);
    const lowIdx  = results.findIndex((r) => r.concept_id === 11);
    expect(highIdx).toBeLessThan(lowIdx); // higher score ranks first
  });
});

// ---------------------------------------------------------------------------
// semanticSearchAxon
// ---------------------------------------------------------------------------

describe("semanticSearchAxon()", () => {
  const nodes: AxonNodeAttrs[] = [
    makeNode(101, "risk management"),
    makeNode(102, "drawdown control"),
    makeNode(103, "python testing"),
  ];

  // Embeddings: 2-dimensional for test simplicity
  const store: Record<string, number[]> = {
    "101": [1, 0],   // risk management
    "102": [0.9, 0.1], // drawdown control — close to risk management
    "103": [0, 1],   // python testing — orthogonal
  };

  test("returns nodes ordered by cosine similarity", () => {
    const queryVec = [1, 0]; // identical to risk management
    const results = semanticSearchAxon(queryVec, nodes, store, 3);
    const ids = results.map((r) => r.concept_id);
    expect(ids[0]).toBe(101); // exact match first
    expect(ids[1]).toBe(102); // close second
    expect(ids[2]).toBe(103); // orthogonal last
  });

  test("respects topK", () => {
    const results = semanticSearchAxon([1, 0], nodes, store, 2);
    expect(results).toHaveLength(2);
  });

  test("returns empty when store is empty", () => {
    const results = semanticSearchAxon([1, 0], nodes, {}, 10);
    expect(results).toHaveLength(0);
  });

  test("returns empty when nodes is empty", () => {
    const results = semanticSearchAxon([1, 0], [], store, 10);
    expect(results).toHaveLength(0);
  });

  test("assigns scores between 0 and 1", () => {
    const results = semanticSearchAxon([1, 0], nodes, store, 3);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test("nodes without embeddings are excluded", () => {
    const extraNode = makeNode(999, "no embedding");
    const results = semanticSearchAxon([1, 0], [...nodes, extraNode], store, 10);
    expect(results.map((r) => r.concept_id)).not.toContain(999);
  });
});

// ---------------------------------------------------------------------------
// mergeAxonResults
// ---------------------------------------------------------------------------

describe("mergeAxonResults()", () => {
  const textResults: AxonSearchResult[] = [
    { concept_id: 1, surface_form: "risk management", score: 0.8, source: "text" },
    { concept_id: 2, surface_form: "position sizing",  score: 0.5, source: "text" },
  ];

  const semanticResults: AxonSearchResult[] = [
    { concept_id: 1, surface_form: "risk management", score: 0.9, source: "semantic" },
    { concept_id: 3, surface_form: "drawdown control", score: 0.7, source: "semantic" },
  ];

  test("deduplicates results present in both lists", () => {
    const merged = mergeAxonResults(textResults, semanticResults, 10);
    const ids = merged.map((r) => r.concept_id);
    const countOnes = ids.filter((id) => id === 1).length;
    expect(countOnes).toBe(1);
  });

  test("takes max score for duplicates", () => {
    const merged = mergeAxonResults(textResults, semanticResults, 10);
    const r1 = merged.find((r) => r.concept_id === 1)!;
    expect(r1.score).toBe(0.9); // max of 0.8 and 0.9
  });

  test("includes all unique concepts from both lists", () => {
    const merged = mergeAxonResults(textResults, semanticResults, 10);
    const ids = merged.map((r) => r.concept_id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });

  test("returns results sorted by score descending", () => {
    const merged = mergeAxonResults(textResults, semanticResults, 10);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i]!.score).toBeLessThanOrEqual(merged[i - 1]!.score);
    }
  });

  test("respects topK limit", () => {
    const merged = mergeAxonResults(textResults, semanticResults, 2);
    expect(merged).toHaveLength(2);
  });

  test("handles empty text results (semantic-only)", () => {
    const merged = mergeAxonResults([], semanticResults, 10);
    expect(merged).toHaveLength(2);
  });

  test("handles empty semantic results (text-only)", () => {
    const merged = mergeAxonResults(textResults, [], 10);
    expect(merged).toHaveLength(2);
  });

  test("handles both empty", () => {
    const merged = mergeAxonResults([], [], 10);
    expect(merged).toHaveLength(0);
  });
});
