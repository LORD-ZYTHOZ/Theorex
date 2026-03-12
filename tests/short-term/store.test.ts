// tests/short-term/store.test.ts
// Unit tests for the short-term JSONL store.
// All tests use a temp directory to avoid polluting data/short-term.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { appendEntry, rotateStm, readShortTermFiles } from "../../src/short-term/store";
import type { ShortTermEntry } from "../../src/short-term/store";

const TEST_DIR = `/tmp/theorex-stm-test-${process.pid}`;

function makeEntry(overrides: Partial<ShortTermEntry> = {}): ShortTermEntry {
  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10);
  return {
    id: crypto.randomUUID(),
    concept_id: 1,
    surface_form: "machine learning",
    composite_score: 0.75,
    source_weight: 1.0,
    timestamp,
    date,
    ...overrides,
  };
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// Test 1: appendEntry writes a JSONL line
test("appendEntry writes a single entry to the correct JSONL file", async () => {
  const entry = makeEntry();
  await appendEntry(entry, TEST_DIR);

  const file = Bun.file(`${TEST_DIR}/${entry.date}.jsonl`);
  const text = await file.text();
  const parsed = Bun.JSONL.parse(text);
  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toMatchObject({
    id: entry.id,
    concept_id: entry.concept_id,
    surface_form: entry.surface_form,
    composite_score: entry.composite_score,
    source_weight: entry.source_weight,
    timestamp: entry.timestamp,
    date: entry.date,
  });
});

// Test 2: appendEntry appends (does not replace)
test("appendEntry appends to existing file without replacing it", async () => {
  const entry1 = makeEntry({ id: crypto.randomUUID(), concept_id: 1, surface_form: "alpha" });
  const entry2 = makeEntry({ id: crypto.randomUUID(), concept_id: 2, surface_form: "beta" });

  await appendEntry(entry1, TEST_DIR);
  await appendEntry(entry2, TEST_DIR);

  const file = Bun.file(`${TEST_DIR}/${entry1.date}.jsonl`);
  const text = await file.text();
  const parsed = Bun.JSONL.parse(text) as ShortTermEntry[];
  expect(parsed).toHaveLength(2);
  expect(parsed[0].surface_form).toBe("alpha");
  expect(parsed[1].surface_form).toBe("beta");
});

// Test 3: rotateStm deletes old files, keeps recent ones
test("rotateStm deletes files older than 14 days and keeps newer ones", async () => {
  const old15 = dateStr(15);
  const edge14 = dateStr(14);
  const recent1 = dateStr(1);

  await writeFile(`${TEST_DIR}/${old15}.jsonl`, '{"x":1}\n');
  await writeFile(`${TEST_DIR}/${edge14}.jsonl`, '{"x":2}\n');
  await writeFile(`${TEST_DIR}/${recent1}.jsonl`, '{"x":3}\n');

  const today = new Date();
  await rotateStm(today, TEST_DIR);

  const oldFile = Bun.file(`${TEST_DIR}/${old15}.jsonl`);
  const edgeFile = Bun.file(`${TEST_DIR}/${edge14}.jsonl`);
  const recentFile = Bun.file(`${TEST_DIR}/${recent1}.jsonl`);

  expect(await oldFile.exists()).toBe(false);
  expect(await edgeFile.exists()).toBe(true);
  expect(await recentFile.exists()).toBe(true);
});

// Test 4: rotateStm returns count of deleted files
test("rotateStm returns the count of deleted files", async () => {
  const old15 = dateStr(15);
  const old20 = dateStr(20);
  const recent1 = dateStr(1);

  await writeFile(`${TEST_DIR}/${old15}.jsonl`, '{"x":1}\n');
  await writeFile(`${TEST_DIR}/${old20}.jsonl`, '{"x":2}\n');
  await writeFile(`${TEST_DIR}/${recent1}.jsonl`, '{"x":3}\n');

  const count = await rotateStm(new Date(), TEST_DIR);
  expect(count).toBe(2);
});

// Test 5: rotateStm on absent directory returns 0, does not throw
test("rotateStm returns 0 and does not throw when directory is absent", async () => {
  const absentDir = `/tmp/theorex-stm-absent-${process.pid}`;
  const count = await rotateStm(new Date(), absentDir);
  expect(count).toBe(0);
});

// Test 6: readShortTermFiles returns all entries from multiple JSONL files in date order
test("readShortTermFiles returns entries from all JSONL files in date order", async () => {
  const day1 = dateStr(2);
  const day2 = dateStr(1);

  const e1: ShortTermEntry = makeEntry({ concept_id: 10, surface_form: "first", date: day1, timestamp: `${day1}T10:00:00.000Z` });
  const e2: ShortTermEntry = makeEntry({ concept_id: 20, surface_form: "second", date: day2, timestamp: `${day2}T10:00:00.000Z` });

  await writeFile(`${TEST_DIR}/${day1}.jsonl`, JSON.stringify(e1) + "\n");
  await writeFile(`${TEST_DIR}/${day2}.jsonl`, JSON.stringify(e2) + "\n");

  const results = await readShortTermFiles(TEST_DIR);
  expect(results).toHaveLength(2);
  // Files should come back in sorted (date ascending) order
  expect(results[0].surface_form).toBe("first");
  expect(results[1].surface_form).toBe("second");
});

// Test 7: readShortTermFiles on absent directory returns empty array, does not throw
test("readShortTermFiles returns empty array when directory is absent", async () => {
  const absentDir = `/tmp/theorex-stm-absent2-${process.pid}`;
  const results = await readShortTermFiles(absentDir);
  expect(results).toEqual([]);
});
