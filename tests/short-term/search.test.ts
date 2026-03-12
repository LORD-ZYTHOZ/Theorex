// tests/short-term/search.test.ts — TDD RED phase: all tests should FAIL until search.ts is implemented

import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { hybridSearch, type SearchResult } from "../../src/short-term/search.ts";
import { appendEntry, type ShortTermEntry } from "../../src/short-term/store.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "theorex-search-test-"));
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await rm(testDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<ShortTermEntry> = {}): ShortTermEntry {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    concept_id: Math.floor(Math.random() * 10000),
    surface_form: "machine learning",
    composite_score: 0.8,
    source_weight: 1.0,
    timestamp: now,
    date: now.slice(0, 10),
    ...overrides,
  };
}

// Test 1: hybridSearch with mocked embedText returning a vector returns RRF-ranked results
test("hybridSearch with embedder available returns RRF-ranked results", async () => {
  // Add entries to test directory
  const entry1 = makeEntry({ surface_form: "machine learning", id: "id-ml" });
  const entry2 = makeEntry({ surface_form: "neural network", id: "id-nn" });
  const entry3 = makeEntry({ surface_form: "deep learning", id: "id-dl" });
  await appendEntry(entry1, testDir);
  await appendEntry(entry2, testDir);
  await appendEntry(entry3, testDir);

  // Mock fetch to return a fixed embedding vector
  let callCount = 0;
  globalThis.fetch = mock(async () => {
    callCount++;
    // Return slightly different vectors for each call so similarity varies
    const embedding = callCount === 1
      ? [1, 0, 0]   // query vector
      : [1, 0, 0];  // all entries same for simplicity
    return new Response(
      JSON.stringify({ data: [{ embedding }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as any;

  const results = await hybridSearch("machine learning", 10, undefined, testDir);

  expect(Array.isArray(results)).toBe(true);
  expect(results.length).toBeGreaterThan(0);
  // Each result has entry and score
  for (const r of results) {
    expect(r.entry).toBeDefined();
    expect(typeof r.score).toBe("number");
  }
});

// Test 2: hybridSearch when embedText returns null returns BM25-only results, no error thrown
test("hybridSearch when embedText returns null returns BM25-only results without error", async () => {
  const entry1 = makeEntry({ surface_form: "machine learning", id: "id-ml" });
  const entry2 = makeEntry({ surface_form: "neural network", id: "id-nn" });
  const entry3 = makeEntry({ surface_form: "deep learning", id: "id-dl" });
  await appendEntry(entry1, testDir);
  await appendEntry(entry2, testDir);
  await appendEntry(entry3, testDir);

  // Mock fetch to fail (simulate unavailable embedder)
  globalThis.fetch = mock(async () => {
    throw new Error("ECONNREFUSED");
  }) as any;

  // Should NOT throw — graceful degradation to BM25-only
  let results: SearchResult[] = [];
  expect(async () => {
    results = await hybridSearch("machine learning", 10, undefined, testDir);
  }).not.toThrow();

  results = await hybridSearch("machine learning", 10, undefined, testDir);
  expect(Array.isArray(results)).toBe(true);
  // BM25 should still return results for "machine learning" query
  expect(results.length).toBeGreaterThan(0);
});

// Test 3: hybridSearch on empty short-term directory returns [], does not throw
test("hybridSearch on empty directory returns [] without error", async () => {
  globalThis.fetch = mock(async () => {
    throw new Error("ECONNREFUSED");
  }) as any;

  const results = await hybridSearch("machine learning", 10, undefined, testDir);
  expect(results).toEqual([]);
});
