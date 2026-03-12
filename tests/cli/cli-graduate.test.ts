// tests/cli/cli-graduate.test.ts — Integration tests for graduate CLI handler.
// Tests call findGraduateCandidates and graduateToLongTerm directly for path overrides,
// and runGraduate for integration coverage.

import { test, expect, describe, afterEach } from "bun:test";
import { runGraduate } from "../../src/cli/index";
import { findGraduateCandidates, graduateToLongTerm } from "../../src/short-term/graduate";
import { appendEntry } from "../../src/short-term/store";
import type { ShortTermEntry } from "../../src/short-term/store";
import type { Config } from "../../src/config";
import { rm, mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CFG: Config = {
  halfLifeDays: 14,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
  pruneThresholdDays: 30,
  edgePruneThreshold: 0.01,
  stmRetentionDays: 14,
  stmGraduateDays: 7,
  lmStudioUrl: "http://localhost:1234",
  lmStudioEmbedModel: "nomic-embed-text-v1.5",
  lmStudioTimeoutMs: 3000,
};

function makeTmpDir(): string {
  return `/tmp/theorex-stm-grad-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeTmpMemory(): string {
  return `/tmp/theorex-memory-${Date.now()}-${Math.random().toString(36).slice(2)}.md`;
}

function makeEntry(overrides: Partial<ShortTermEntry> = {}): ShortTermEntry {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    concept_id: 1,
    surface_form: "machine learning",
    composite_score: 0.8,
    source_weight: 1.0,
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    ...overrides,
  };
}

/**
 * Build N entries for the same concept spanning N consecutive days ending today.
 */
function makeConsecutiveEntries(
  conceptId: number,
  surfaceForm: string,
  nDays: number
): ShortTermEntry[] {
  const entries: ShortTermEntry[] = [];
  for (let i = nDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    entries.push(makeEntry({
      id: crypto.randomUUID(),
      concept_id: conceptId,
      surface_form: surfaceForm,
      timestamp: d.toISOString(),
      date: dateStr,
    }));
  }
  return entries;
}

// Capture console.log output during an async callback
async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runGraduate", () => {
  test("1. no qualifying entries — prints 'Nothing to graduate.', does not throw", async () => {
    const memoryPath = makeTmpMemory();
    const lines = await captureLog(async () => {
      await runGraduate(DEFAULT_CFG, memoryPath);
    });
    const output = lines.join("\n");
    expect(output).toContain("Nothing to graduate.");
  });
});

describe("graduateToLongTerm (underlying function) — path override tests", () => {
  const tmpDirs: string[] = [];
  const tmpFiles: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
    for (const f of tmpFiles.splice(0)) {
      await rm(f, { force: true });
    }
  });

  test("2. 7-consecutive-day entries — writes to MEMORY.md with '## Short-Term Graduates'", async () => {
    const dir = makeTmpDir();
    const memoryPath = makeTmpMemory();
    tmpDirs.push(dir);
    tmpFiles.push(memoryPath);

    await mkdir(dir, { recursive: true });

    const entries = makeConsecutiveEntries(1, "machine learning", 7);
    for (const e of entries) {
      await appendEntry(e, dir);
    }

    // Use findGraduateCandidates + graduateToLongTerm directly with temp paths
    const candidates = await findGraduateCandidates(entries, 7);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.surface_form).toBe("machine learning");

    await graduateToLongTerm(candidates, memoryPath);

    const memContent = await Bun.file(memoryPath).text();
    expect(memContent).toContain("## Short-Term Graduates");
    expect(memContent).toContain("machine learning");
  });

  test("3. idempotency — run twice with same data, MEMORY.md section count unchanged", async () => {
    const dir = makeTmpDir();
    const memoryPath = makeTmpMemory();
    tmpDirs.push(dir);
    tmpFiles.push(memoryPath);

    await mkdir(dir, { recursive: true });

    const entries = makeConsecutiveEntries(2, "deep learning", 7);
    for (const e of entries) {
      await appendEntry(e, dir);
    }

    const candidates = await findGraduateCandidates(entries, 7);
    expect(candidates.length).toBe(1);

    // First graduation
    await graduateToLongTerm(candidates, memoryPath);
    const contentAfterFirst = await Bun.file(memoryPath).text();

    // Count occurrences of "## Short-Term Graduates" heading
    const countOccurrences = (str: string, sub: string) => {
      let count = 0;
      let pos = str.indexOf(sub);
      while (pos !== -1) {
        count++;
        pos = str.indexOf(sub, pos + 1);
      }
      return count;
    };

    const countBefore = countOccurrences(contentAfterFirst, "## Short-Term Graduates");
    expect(countBefore).toBe(1);

    // Second graduation — should be idempotent
    await graduateToLongTerm(candidates, memoryPath);
    const contentAfterSecond = await Bun.file(memoryPath).text();

    const countAfter = countOccurrences(contentAfterSecond, "## Short-Term Graduates");
    expect(countAfter).toBe(1); // Still exactly one section

    // The surface_form subsection should also appear only once
    const subsectionCount = countOccurrences(contentAfterSecond, "### deep learning");
    expect(subsectionCount).toBe(1);
  });
});
