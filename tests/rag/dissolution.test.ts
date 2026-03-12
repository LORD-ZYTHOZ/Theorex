import { test, expect, describe } from "bun:test";
import { shouldDissolveSeeded } from "../../src/rag/dissolution";

type SeededEdge = {
  strength: number;
  co_occurrence_count: number;
  last_co_occurrence: string;
  seeded: boolean;
  seed_created_at: string;
};

const nowMs = new Date("2026-03-18T00:00:00Z").getTime(); // fixed "now"
const eightDaysAgo = new Date("2026-03-10T00:00:00Z").toISOString();
const threeDaysAgo = new Date("2026-03-15T00:00:00Z").toISOString();
const SEED_DAYS = 7;

const makeSeededEdge = (overrides: Partial<SeededEdge>): SeededEdge => ({
  strength: 0.15,
  co_occurrence_count: 0,
  last_co_occurrence: eightDaysAgo,
  seeded: true,
  seed_created_at: eightDaysAgo,
  ...overrides,
});

describe("shouldDissolveSeeded", () => {
  test("dissolves seeded edge with zero co-occurrence and age > seedDissolutionDays", () => {
    const edge = makeSeededEdge({ seed_created_at: eightDaysAgo }); // 8 days old, threshold 7
    expect(shouldDissolveSeeded(edge, nowMs, SEED_DAYS)).toBe(true);
  });

  test("does NOT dissolve seeded edge with co_occurrence_count > 0 (confirmed)", () => {
    const edge = makeSeededEdge({ seed_created_at: eightDaysAgo, co_occurrence_count: 1 });
    expect(shouldDissolveSeeded(edge, nowMs, SEED_DAYS)).toBe(false);
  });

  test("does NOT dissolve seeded edge that is too young (within seedDissolutionDays)", () => {
    const edge = makeSeededEdge({ seed_created_at: threeDaysAgo }); // 3 days old, threshold 7
    expect(shouldDissolveSeeded(edge, nowMs, SEED_DAYS)).toBe(false);
  });

  test("does NOT dissolve organic edge (seeded: false)", () => {
    const edge = makeSeededEdge({ seeded: false, seed_created_at: eightDaysAgo });
    expect(shouldDissolveSeeded(edge, nowMs, SEED_DAYS)).toBe(false);
  });
});
