// tests/moments/search.test.ts — Unit tests for BM25 moment search.
// Tests sentinel padding, result ranking, result shape, and limit enforcement.

import { describe, it, expect, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { buildMomentBm25Index, searchMoments } from "../../src/moments/search";
import type { MomentSearchResult } from "../../src/moments/search";
import type { MomentNode } from "../../src/moments/store";
import { createMoment } from "../../src/moments/store";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir = "";

function makeMoment(overrides: Partial<MomentNode> & { id: string; story: string }): MomentNode {
  return {
    id: overrides.id,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    story: overrides.story,
    code_refs: overrides.code_refs ?? [],
    concept_ids: overrides.concept_ids ?? [],
  };
}

afterEach(async () => {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true });
    testDir = "";
  }
});

// ---------------------------------------------------------------------------
// describe("searchMoments")
// ---------------------------------------------------------------------------

describe("searchMoments", () => {
  it("returns empty array when no moments provided", async () => {
    const results = await searchMoments([], "anything", 5);
    expect(results).toEqual([]);
  });

  it("handles 1 moment below 3-doc minimum without crashing (sentinel padding)", async () => {
    const moments: MomentNode[] = [
      makeMoment({ id: "abc-001", story: "Implemented BM25 search over moments" }),
    ];

    // Should not throw even with only 1 moment
    const results = await searchMoments(moments, "BM25 search", 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it("handles 2 moments below 3-doc minimum without crashing (sentinel padding)", async () => {
    const moments: MomentNode[] = [
      makeMoment({ id: "abc-001", story: "Implemented BM25 search over moments" }),
      makeMoment({ id: "abc-002", story: "Added moment node store with atomic write" }),
    ];

    const results = await searchMoments(moments, "BM25", 5);
    expect(Array.isArray(results)).toBe(true);
    // Sentinel docs should not appear in results
    for (const r of results) {
      expect(r.id).not.toBe("");
    }
  });

  it("returns results with correct shape: { id, story, score, timestamp }", async () => {
    const ts = "2026-03-11T08:00:00.000Z";
    const moments: MomentNode[] = [
      makeMoment({ id: "abc-001", story: "Implemented BM25 full-text search", timestamp: ts }),
      makeMoment({ id: "abc-002", story: "Added atomic write for moment nodes", timestamp: ts }),
      makeMoment({ id: "abc-003", story: "Created moment concept tracking", timestamp: ts }),
    ];

    const results = await searchMoments(moments, "BM25 search", 5);

    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.story).toBe("string");
      expect(typeof r.score).toBe("number");
      expect(typeof r.timestamp).toBe("string");
    }
  });

  it("ranks story text matching query higher than non-matching entries", async () => {
    const moments: MomentNode[] = [
      makeMoment({ id: "abc-001", story: "Refactored the database connection pool logic" }),
      makeMoment({ id: "abc-002", story: "Implemented BM25 full-text search ranking algorithm" }),
      makeMoment({ id: "abc-003", story: "Fixed UI rendering bug in dashboard component" }),
    ];

    const results = await searchMoments(moments, "BM25 ranking search", 5);

    expect(results.length).toBeGreaterThan(0);
    // The BM25 story should rank first
    expect(results[0]!.id).toBe("abc-002");
    // Score should be positive
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("respects limit — returns at most limit results", async () => {
    const moments: MomentNode[] = [
      makeMoment({ id: "abc-001", story: "Implemented BM25 full-text search" }),
      makeMoment({ id: "abc-002", story: "BM25 ranking with story weight boosting" }),
      makeMoment({ id: "abc-003", story: "BM25 index sentinel padding applied" }),
      makeMoment({ id: "abc-004", story: "BM25 consolidate called after addDoc" }),
      makeMoment({ id: "abc-005", story: "BM25 query result mapping to MomentNode" }),
    ];

    const results = await searchMoments(moments, "BM25", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("sentinel results (id === empty string) do not appear in results", async () => {
    const moments: MomentNode[] = [
      makeMoment({ id: "abc-001", story: "Test moment for sentinel check" }),
    ];

    const results = await searchMoments(moments, "sentinel check moment", 10);
    for (const r of results) {
      expect(r.id).not.toBe("");
    }
  });

  it("results are sorted descending by score", async () => {
    const moments: MomentNode[] = [
      makeMoment({ id: "abc-001", story: "Implemented BM25 full-text search ranking over moments" }),
      makeMoment({ id: "abc-002", story: "Added atomic write pattern" }),
      makeMoment({ id: "abc-003", story: "BM25 search used for moment retrieval" }),
    ];

    const results = await searchMoments(moments, "BM25 search", 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});
