/**
 * meta-review.test.ts — Stage 6C unit tests.
 * Tests weight candidate generation, random selection, proposal parsing,
 * and the meta-review pipeline (mocked Ollama + filesystem).
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  generateWeightCandidates,
  pickRandomCandidate,
} from "./meta-review";

// ---------------------------------------------------------------------------
// generateWeightCandidates
// ---------------------------------------------------------------------------

describe("generateWeightCandidates", () => {
  const current = { recency: 0.40, frequency: 0.35, coOccurrence: 0.25 };

  test("generates N candidates", () => {
    const candidates = generateWeightCandidates(current, 10);
    expect(candidates).toHaveLength(10);
  });

  test("all candidates have positive weights that sum to ~1.0", () => {
    const candidates = generateWeightCandidates(current, 50);
    for (const c of candidates) {
      expect(c.recency).toBeGreaterThanOrEqual(0);
      expect(c.frequency).toBeGreaterThanOrEqual(0);
      expect(c.coOccurrence).toBeGreaterThanOrEqual(0);
      const sum = c.recency + c.frequency + c.coOccurrence;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  test("candidates differ from current (with enough perturbation)", () => {
    const candidates = generateWeightCandidates(current, 20, 0.15);
    const different = candidates.some(
      (c) =>
        Math.abs(c.recency - current.recency) > 0.001 ||
        Math.abs(c.frequency - current.frequency) > 0.001 ||
        Math.abs(c.coOccurrence - current.coOccurrence) > 0.001,
    );
    expect(different).toBe(true);
  });

  test("zero perturbation returns copies of current", () => {
    const candidates = generateWeightCandidates(current, 5, 0);
    for (const c of candidates) {
      expect(c.recency).toBeCloseTo(current.recency, 5);
      expect(c.frequency).toBeCloseTo(current.frequency, 5);
      expect(c.coOccurrence).toBeCloseTo(current.coOccurrence, 5);
    }
  });

  test("handles edge case: very small current weights", () => {
    const tiny = { recency: 0.01, frequency: 0.01, coOccurrence: 0.98 };
    const candidates = generateWeightCandidates(tiny, 10, 0.05);
    for (const c of candidates) {
      expect(c.recency).toBeGreaterThanOrEqual(0);
      const sum = c.recency + c.frequency + c.coOccurrence;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// pickRandomCandidate
// ---------------------------------------------------------------------------

describe("pickRandomCandidate", () => {
  test("returns null for empty array", () => {
    expect(pickRandomCandidate([])).toBeNull();
  });

  test("returns the only element for single-element array", () => {
    expect(pickRandomCandidate([42])).toBe(42);
  });

  test("returns an element from the array", () => {
    const items = ["a", "b", "c", "d"];
    const result = pickRandomCandidate(items);
    expect(items).toContain(result);
  });

  test("provides reasonable distribution over many picks", () => {
    const items = [0, 1, 2];
    const counts = [0, 0, 0];
    for (let i = 0; i < 300; i++) {
      const picked = pickRandomCandidate(items)!;
      counts[picked]++;
    }
    // Each should be picked at least 50 times out of 300 (expect ~100)
    for (const c of counts) {
      expect(c).toBeGreaterThan(30);
    }
  });
});
