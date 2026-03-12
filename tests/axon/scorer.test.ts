import { test, expect } from "bun:test";
import {
  recencyScore,
  frequencyScore,
  coOccurrenceScore,
  compositeScore,
  classifyTier,
} from "../../src/axon/scorer";
import type { ScoringConfig } from "../../src/axon/scorer";

const DEFAULT_CFG: ScoringConfig = {
  halfLifeDays: 14,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
};

const DAY_MS = 86_400_000;

// ─── recencyScore ─────────────────────────────────────────────────────────────

test("recencyScore: lastSeen=now → 1.0", () => {
  const now = 1_700_000_000_000;
  expect(recencyScore(new Date(now).toISOString(), now, 14)).toBeCloseTo(1.0, 10);
});

test("recencyScore: lastSeen=14 days ago → 0.5", () => {
  const now = 1_700_000_000_000;
  const lastSeen = new Date(now - 14 * DAY_MS).toISOString();
  expect(recencyScore(lastSeen, now, 14)).toBeCloseTo(0.5, 10);
});

test("recencyScore: lastSeen=28 days ago → 0.25", () => {
  const now = 1_700_000_000_000;
  const lastSeen = new Date(now - 28 * DAY_MS).toISOString();
  expect(recencyScore(lastSeen, now, 14)).toBeCloseTo(0.25, 10);
});

// ─── frequencyScore ───────────────────────────────────────────────────────────

test("frequencyScore(0) → 0.0", () => {
  expect(frequencyScore(0)).toBe(0.0);
});

test("frequencyScore(1) → Math.log(2)/Math.log(101)", () => {
  const expected = Math.log(2) / Math.log(101);
  expect(frequencyScore(1)).toBeCloseTo(expected, 6);
});

test("frequencyScore(100) → 1.0", () => {
  expect(frequencyScore(100)).toBe(1.0);
});

// ─── coOccurrenceScore ────────────────────────────────────────────────────────

test("coOccurrenceScore([]) → 0.0", () => {
  expect(coOccurrenceScore([])).toBe(0.0);
});

test("coOccurrenceScore([0.4, 0.6]) → 0.5", () => {
  expect(coOccurrenceScore([0.4, 0.6])).toBeCloseTo(0.5, 6);
});

// ─── compositeScore ───────────────────────────────────────────────────────────

test("compositeScore returns value between 0.0 and 1.0", () => {
  const now = 1_700_000_000_000;
  const lastSeen = new Date(now).toISOString();
  const score = compositeScore(lastSeen, 1, [], now, DEFAULT_CFG);
  expect(score).toBeGreaterThanOrEqual(0.0);
  expect(score).toBeLessThanOrEqual(1.0);
});

// ─── classifyTier ─────────────────────────────────────────────────────────────

test("classifyTier: score 0.7 → ACTIVE", () => {
  expect(classifyTier(0.7, DEFAULT_CFG)).toBe("ACTIVE");
});

test("classifyTier: score 0.4 → MILD", () => {
  expect(classifyTier(0.4, DEFAULT_CFG)).toBe("MILD");
});

test("classifyTier: score 0.1 → LESS", () => {
  expect(classifyTier(0.1, DEFAULT_CFG)).toBe("LESS");
});

test("classifyTier: respects custom activeThreshold: 0.8", () => {
  const customCfg: ScoringConfig = { ...DEFAULT_CFG, activeThreshold: 0.8 };
  // 0.7 is >= 0.3 (mild) but < 0.8 (active), so MILD
  expect(classifyTier(0.7, customCfg)).toBe("MILD");
});
