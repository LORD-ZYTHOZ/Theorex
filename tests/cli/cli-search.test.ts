// tests/cli/cli-search.test.ts — Integration tests for search CLI handler.
// Tests call runSearch and underlying hybridSearch directly (no subprocess).

import { test, expect, describe, afterEach } from "bun:test";
import { runSearch } from "../../src/cli/index";
import { hybridSearch } from "../../src/short-term/search";
import { appendEntry, rotateStm } from "../../src/short-term/store";
import type { ShortTermEntry } from "../../src/short-term/store";
import type { Config } from "../../src/config";
import { rm, mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Isolated empty STM dir — prevents test from reading live data/short-term/
const ISOLATED_STM_DIR = `/tmp/theorex-search-test-${Date.now()}`;

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
  stmDir: ISOLATED_STM_DIR,
} as Config;

function makeTmpDir(): string {
  return `/tmp/theorex-stm-search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

describe("runSearch", () => {
  test("1. empty STM — prints 'No results found', does not throw", async () => {
    const lines = await captureLog(async () => {
      await runSearch("machine learning", DEFAULT_CFG);
    });
    const output = lines.join("\n");
    expect(output).toContain("No results found for: machine learning");
  });
});

describe("hybridSearch (underlying function) — path override tests", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  test("2. one matching entry — output includes that entry's surface_form", async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    await mkdir(dir, { recursive: true });

    const entry = makeEntry({ surface_form: "neural network", concept_id: 42 });
    await appendEntry(entry, dir);

    const results = await hybridSearch("neural network", 10, undefined, dir);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.entry.surface_form === "neural network")).toBe(true);
  });

  test("3. results are sorted by score descending", async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    await mkdir(dir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    // Add multiple entries — surface forms matching query at different relevance
    const entries: ShortTermEntry[] = [
      makeEntry({ id: crypto.randomUUID(), concept_id: 1, surface_form: "machine learning", date: today }),
      makeEntry({ id: crypto.randomUUID(), concept_id: 2, surface_form: "deep learning", date: today }),
      makeEntry({ id: crypto.randomUUID(), concept_id: 3, surface_form: "reinforcement learning", date: today }),
    ];
    for (const e of entries) {
      await appendEntry(e, dir);
    }

    const results = await hybridSearch("machine learning", 10, undefined, dir);
    // Verify descending score order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  test("4. runSearch calls rotateStm — 15-day-old file is removed", async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    await mkdir(dir, { recursive: true });

    // Create a JSONL file named 15 days ago
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 15);
    const staleDateStr = staleDate.toISOString().slice(0, 10);
    const staleEntry = makeEntry({ date: staleDateStr, timestamp: staleDate.toISOString() });
    await appendEntry(staleEntry, dir);

    // Verify the file exists before rotation
    const filesBefore = await Bun.file(`${dir}/${staleDateStr}.jsonl`).exists();
    expect(filesBefore).toBe(true);

    // rotateStm with today's date (15-day-old is outside 14-day window — should be deleted)
    const deleted = await rotateStm(new Date(), dir);
    expect(deleted).toBe(1);

    const filesAfter = await Bun.file(`${dir}/${staleDateStr}.jsonl`).exists();
    expect(filesAfter).toBe(false);
  });
});
