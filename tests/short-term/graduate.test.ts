// tests/short-term/graduate.test.ts — Graduation logic tests (TDD).

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasConsecutiveRun,
  findGraduateCandidates,
  graduateToLongTerm,
} from "../../src/short-term/graduate.ts";
import type { ShortTermEntry } from "../../src/short-term/store.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ShortTermEntry> = {}): ShortTermEntry {
  return {
    id: crypto.randomUUID(),
    concept_id: 1,
    surface_form: "machine learning",
    composite_score: 0.8,
    source_weight: 1,
    timestamp: "2026-01-01T12:00:00.000Z",
    date: "2026-01-01",
    ...overrides,
  };
}

function datesFrom(start: string, count: number): string[] {
  const result: string[] = [];
  const base = new Date(start + "T00:00:00Z");
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

// ---------------------------------------------------------------------------
// hasConsecutiveRun tests
// ---------------------------------------------------------------------------

describe("hasConsecutiveRun", () => {
  test("1: 7 consecutive days in a set of exactly 7 → true", () => {
    const dates = datesFrom("2026-01-01", 7);
    expect(hasConsecutiveRun(dates, 7)).toBe(true);
  });

  test("2: 6 consecutive days → false", () => {
    const dates = datesFrom("2026-01-01", 6);
    expect(hasConsecutiveRun(dates, 7)).toBe(false);
  });

  test("3: 7 days with a 1-day gap (1-4 and 6-8 not consecutive) → false", () => {
    // Days 1,2,3,4 then skip day 5, then days 6,7,8 — max run = 4
    const dates = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
    ];
    expect(hasConsecutiveRun(dates, 7)).toBe(false);
  });

  test("4: 10 days total with a gap of 2, but 8 consecutive → true", () => {
    // Days 1,2 then skip 3, then days 4-11 (8 consecutive)
    const dates = [
      "2026-01-01",
      "2026-01-02",
      // gap
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
    ];
    expect(hasConsecutiveRun(dates, 7)).toBe(true);
  });

  test("5: empty set → false", () => {
    expect(hasConsecutiveRun([], 7)).toBe(false);
  });

  test("6: single day → false", () => {
    expect(hasConsecutiveRun(["2026-01-01"], 7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findGraduateCandidates tests
// ---------------------------------------------------------------------------

describe("findGraduateCandidates", () => {
  test("7: concept with entries on 7 consecutive days → returned as candidate", async () => {
    const dates = datesFrom("2026-01-01", 7);
    const entries = dates.map((date) =>
      makeEntry({ concept_id: 42, surface_form: "neural network", date, timestamp: date + "T12:00:00.000Z" })
    );
    const candidates = await findGraduateCandidates(entries);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.concept_id).toBe(42);
  });

  test("8: concept with entries on 7 non-consecutive days → NOT returned", async () => {
    // 7 days with a gap
    const dates = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-06", // gap on Jan 5
      "2026-01-07",
      "2026-01-08",
    ];
    const entries = dates.map((date) =>
      makeEntry({ concept_id: 99, surface_form: "deep learning", date, timestamp: date + "T12:00:00.000Z" })
    );
    const candidates = await findGraduateCandidates(entries);
    expect(candidates).toHaveLength(0);
  });

  test("9: two concepts — one qualifies, one doesn't → only qualifying one returned", async () => {
    const consecutiveDates = datesFrom("2026-01-01", 7);
    const nonConsecutiveDates = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-04", // gap
      "2026-01-05",
      "2026-01-07", // gap
      "2026-01-08",
      "2026-01-09",
    ];

    const qualifying = consecutiveDates.map((date) =>
      makeEntry({ concept_id: 1, surface_form: "neural network", date, timestamp: date + "T12:00:00.000Z" })
    );
    const notQualifying = nonConsecutiveDates.map((date) =>
      makeEntry({ concept_id: 2, surface_form: "deep learning", date, timestamp: date + "T12:00:00.000Z" })
    );

    const candidates = await findGraduateCandidates([...qualifying, ...notQualifying]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.concept_id).toBe(1);
  });

  test("10: returns most-recent entry for qualifying concept", async () => {
    const dates = datesFrom("2026-01-01", 7);
    const entries = dates.map((date) =>
      makeEntry({
        concept_id: 5,
        surface_form: "transformer",
        date,
        timestamp: date + "T12:00:00.000Z",
        id: `id-${date}`,
      })
    );
    const candidates = await findGraduateCandidates(entries);
    expect(candidates).toHaveLength(1);
    // Most recent date is 2026-01-07
    expect(candidates[0]!.date).toBe("2026-01-07");
  });
});

// ---------------------------------------------------------------------------
// graduateToLongTerm tests
// ---------------------------------------------------------------------------

describe("graduateToLongTerm", () => {
  let tmpDir: string;
  let memoryPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "theorex-graduate-test-"));
    memoryPath = join(tmpDir, "MEMORY.md");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("11: empty MEMORY.md + one candidate → creates Short-Term Graduates section with subsection", async () => {
    await writeFile(memoryPath, "", "utf-8");
    const candidate = makeEntry({
      concept_id: 1,
      surface_form: "machine learning",
      date: "2026-01-07",
      composite_score: 0.85,
      source_weight: 2,
    });

    await graduateToLongTerm([candidate], memoryPath);

    const content = await Bun.file(memoryPath).text();
    expect(content).toContain("## Short-Term Graduates");
    expect(content).toContain("### machine learning");
    expect(content).toContain("2026-01-07");
  });

  test("12: existing Short-Term Graduates section + new candidate → appends new subsection", async () => {
    const initial = `# Memory\n\n## Short-Term Graduates\n\n### existing concept\nGraduated from short-term on 2026-01-01. Composite score: 0.700. Source weight: 1.\n`;
    await writeFile(memoryPath, initial, "utf-8");

    const candidate = makeEntry({
      concept_id: 2,
      surface_form: "neural network",
      date: "2026-01-07",
      composite_score: 0.9,
      source_weight: 3,
    });

    await graduateToLongTerm([candidate], memoryPath);

    const content = await Bun.file(memoryPath).text();
    expect(content).toContain("### existing concept");
    expect(content).toContain("### neural network");
    // Both sections present
    const existingIdx = content.indexOf("### existing concept");
    const newIdx = content.indexOf("### neural network");
    expect(existingIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeGreaterThanOrEqual(0);
  });

  test("13: idempotency — same candidate run twice → no duplicate section created", async () => {
    await writeFile(memoryPath, "", "utf-8");
    const candidate = makeEntry({
      concept_id: 1,
      surface_form: "machine learning",
      date: "2026-01-07",
    });

    await graduateToLongTerm([candidate], memoryPath);
    await graduateToLongTerm([candidate], memoryPath);

    const content = await Bun.file(memoryPath).text();
    // Count occurrences of the heading
    const occurrences = content.split("### machine learning").length - 1;
    expect(occurrences).toBe(1);
  });

  test("14: no candidates → MEMORY.md unchanged", async () => {
    const original = `# Memory\n\n## System\n\nsome content\n`;
    await writeFile(memoryPath, original, "utf-8");

    await graduateToLongTerm([], memoryPath);

    const content = await Bun.file(memoryPath).text();
    expect(content).toBe(original);
  });
});
