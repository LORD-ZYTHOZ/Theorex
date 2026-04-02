// tests/flash-inject.test.ts — Tests for src/flash/inject.ts injectContext.
// Uses mock dependency injection to avoid real file I/O and API calls.

import { describe, test, expect } from "bun:test";
import { injectContext } from "../flash/inject";
import type { ShortTermEntry } from "../short-term/store";
import type { MomentNode } from "../moments/store";
import type { Config } from "../config";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const emptyConcepts = async () => [];
const emptyStm = async (): Promise<ShortTermEntry[]> => [];
const emptyMoments = async (): Promise<MomentNode[]> => [];
const nullConfig = async () => null;

// ---------------------------------------------------------------------------
// injectContext — cold start (all lobes empty)
// ---------------------------------------------------------------------------

describe("injectContext() — cold start", () => {
  test("returns empty string when all lobes are empty", async () => {
    const result = await injectContext("test-session", {
      loadConcepts: emptyConcepts,
      readShortTermFiles: emptyStm,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });
    expect(result).toBe("");
  });

  test("never throws even when concepts/stm/moments throw", async () => {
    const result = await injectContext("test-session", {
      loadConcepts: async () => { throw new Error("pg unavailable"); },
      readShortTermFiles: async () => { throw new Error("stm unavailable"); },
      readMoments: async () => { throw new Error("moments unavailable"); },
      loadConfig: nullConfig,
    });
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// injectContext — with concepts
// ---------------------------------------------------------------------------

describe("injectContext() — with concepts", () => {
  test("includes THEOREX ACTIVE CONTEXT header when concepts present", async () => {
    const result = await injectContext("test-active", {
      loadConcepts: async () => [
        { label: "trading strategy", memory_type: "fact", meta: {} },
      ],
      readShortTermFiles: emptyStm,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });

    expect(result).toContain("=== THEOREX ACTIVE CONTEXT ===");
    expect(result).toContain("trading strategy");
  });

  test("includes memory_type in bracket notation", async () => {
    const result = await injectContext("test-tier", {
      loadConcepts: async () => [
        { label: "risk management", memory_type: "preference", meta: {} },
      ],
      readShortTermFiles: emptyStm,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });

    expect(result).toContain("[preference]");
  });
});

// ---------------------------------------------------------------------------
// injectContext — with short-term entries
// ---------------------------------------------------------------------------

describe("injectContext() — with short-term entries", () => {
  test("includes Recent short-term section when entries present", async () => {
    const stmEntries: ShortTermEntry[] = [
      {
        concept_id: 10,
        surface_form: "bun runtime",
        composite_score: 0.75,
        timestamp: new Date().toISOString(),
        importance_weight: 0.8,
        frequency_count: 2,
        node_type: "concept",
      },
    ];

    const result = await injectContext("test-stm", {
      loadConcepts: emptyConcepts,
      readShortTermFiles: async () => stmEntries,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });

    expect(result).toContain("Recent short-term");
    expect(result).toContain("bun runtime");
    expect(result).toContain("0.75");
  });

  test("sorts short-term entries by timestamp descending", async () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    const recent = new Date().toISOString();
    const stmEntries: ShortTermEntry[] = [
      {
        concept_id: 20,
        surface_form: "old concept",
        composite_score: 0.5,
        timestamp: old,
        importance_weight: 0.5,
        frequency_count: 1,
        node_type: "concept",
      },
      {
        concept_id: 21,
        surface_form: "recent concept",
        composite_score: 0.8,
        timestamp: recent,
        importance_weight: 0.8,
        frequency_count: 3,
        node_type: "concept",
      },
    ];

    const result = await injectContext("test-stm-sort", {
      loadConcepts: emptyConcepts,
      readShortTermFiles: async () => stmEntries,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });

    const recentIdx = result.indexOf("recent concept");
    const oldIdx = result.indexOf("old concept");
    expect(recentIdx).toBeLessThan(oldIdx);
  });
});

// ---------------------------------------------------------------------------
// injectContext — with moments
// ---------------------------------------------------------------------------

describe("injectContext() — with moments", () => {
  test("includes Relevant moments section when concepts and moments present", async () => {
    const moments: MomentNode[] = [
      {
        moment_id: "m1",
        story: "Scalping session went very well with tight spreads.",
        timestamp: "2026-03-18T09:00:00.000Z",
        concept_ids: [30],
        significance: 0.9,
      },
    ];

    const result = await injectContext("test-moments", {
      loadConcepts: async () => [
        { label: "scalping session", memory_type: "episode", meta: {} },
      ],
      readShortTermFiles: emptyStm,
      readMoments: async () => moments,
      loadConfig: nullConfig,
    });

    expect(result).toContain("Relevant moments");
    expect(result).toContain("Scalping session went very well");
  });
});
