// tests/flash/inject.test.ts — Unit tests for injectContext.
// Covers HKS-03: ACTIVE-tier context injection at SessionStart.
// Extended in 05-03: moment overlap injection (MOM-04).

import { describe, test, expect } from "bun:test";
import { injectContext } from "../../src/flash/inject";
import type { AxonStore } from "../../src/axon/store";
import type { ShortTermEntry } from "../../src/short-term/store";
import type { MomentNode } from "../../src/moments/store";

// Minimal AxonStore stub with an empty graph
function makeEmptyAxon(): AxonStore {
  return {
    graph: {
      nodes: () => [] as string[],
      getNodeAttributes: (_key: string) => { throw new Error("no nodes"); },
    },
  } as unknown as AxonStore;
}

// Minimal AxonStore stub with one ACTIVE node
function makeAxonWithActive(surfaceForm: string): AxonStore {
  const nodeKey = "1";
  const attrs = {
    concept_id: 1,
    surface_form: surfaceForm,
    importance_weight: 0.9,
    relevance_tier: "ACTIVE" as const,
    sentiment_tier: "NEUTRAL" as const,
    last_seen: "2026-03-11T00:00:00Z",
    frequency_count: 5,
    source_weight: 1.0,
  };
  return {
    graph: {
      nodes: () => [nodeKey],
      getNodeAttributes: (_key: string) => attrs,
    },
  } as unknown as AxonStore;
}

// Minimal AxonStore stub with a MILD node (no ACTIVE)
function makeAxonWithMild(): AxonStore {
  const nodeKey = "2";
  const attrs = {
    concept_id: 2,
    surface_form: "mild_concept",
    importance_weight: 0.4,
    relevance_tier: "MILD" as const,
    sentiment_tier: "NEUTRAL" as const,
    last_seen: "2026-03-11T00:00:00Z",
    frequency_count: 2,
    source_weight: 1.0,
  };
  return {
    graph: {
      nodes: () => [nodeKey],
      getNodeAttributes: (_key: string) => attrs,
    },
  } as unknown as AxonStore;
}

function makeShortTermEntry(surfaceForm: string): ShortTermEntry {
  return {
    id: crypto.randomUUID(),
    concept_id: 99,
    surface_form: surfaceForm,
    composite_score: 0.75,
    source_weight: 1.0,
    timestamp: "2026-03-11T00:00:00Z",
    date: "2026-03-11",
  };
}

describe("injectContext", () => {
  test("returns empty string when axon.json does not exist (cold start)", async () => {
    // loadAxon succeeds but with empty axon (AxonStore.load returns empty on ENOENT)
    const result = await injectContext("cold-sess", {
      loadAxon: async () => makeEmptyAxon(),
      readShortTermFiles: async () => [],
    });

    expect(result).toBe("");
  });

  test("returns empty string when axon has no ACTIVE nodes", async () => {
    const result = await injectContext("mild-sess", {
      loadAxon: async () => makeAxonWithMild(),
      readShortTermFiles: async () => [],
    });

    // No ACTIVE nodes and no short-term entries → empty output
    expect(result).toBe("");
  });

  test("output contains ACTIVE node surface_form when axon has ACTIVE nodes", async () => {
    const result = await injectContext("active-sess", {
      loadAxon: async () => makeAxonWithActive("TypeScript"),
      readShortTermFiles: async () => [],
    });

    expect(result).toContain("TypeScript");
    expect(result).toContain("ACTIVE");
  });

  test("output never throws — always resolves to string", async () => {
    // loadAxon throws to simulate missing file / corrupt data
    const resultPromise = injectContext("error-sess", {
      loadAxon: async () => { throw new Error("axon missing"); },
      readShortTermFiles: async () => { throw new Error("stm missing"); },
    });

    // Must resolve (not reject) to a string
    await expect(resultPromise).resolves.toBeTypeOf("string");
  });

  test("output contains short-term entry surface_form when short-term data exists", async () => {
    const stmEntry = makeShortTermEntry("GraphQL");

    const result = await injectContext("stm-sess", {
      loadAxon: async () => makeEmptyAxon(),
      readShortTermFiles: async () => [stmEntry],
    });

    expect(result).toContain("GraphQL");
  });
});

// ---------------------------------------------------------------------------
// Moment injection tests (05-03 — MOM-04)
// ---------------------------------------------------------------------------

function makeMomentNode(conceptIds: number[], story: string): MomentNode {
  return {
    id: crypto.randomUUID(),
    timestamp: "2026-03-11T00:00:00Z",
    story,
    code_refs: [],
    concept_ids: conceptIds,
  };
}

describe("injectContext — moment overlap (MOM-04)", () => {
  test("9. includes '--- Relevant moments ---' when a moment's concept_ids overlap with ACTIVE-tier nodes", async () => {
    // Axon has concept_id=1 as ACTIVE
    const axon = makeAxonWithActive("typescript");
    // Moment shares concept_id=1
    const moment = makeMomentNode([1], "I learned about typescript today");

    const result = await injectContext("moment-overlap-sess", {
      loadAxon: async () => axon,
      readShortTermFiles: async () => [],
      readMoments: async () => [moment],
    });

    expect(result).toContain("--- Relevant moments ---");
    expect(result).toContain("I learned about typescript today");
  });

  test("10. does NOT include moments section when there is no concept_id overlap", async () => {
    // Axon has concept_id=1 as ACTIVE
    const axon = makeAxonWithActive("typescript");
    // Moment has different concept_ids — no overlap
    const moment = makeMomentNode([999, 888], "unrelated story about other things");

    const result = await injectContext("no-overlap-sess", {
      loadAxon: async () => axon,
      readShortTermFiles: async () => [],
      readMoments: async () => [moment],
    });

    expect(result).not.toContain("--- Relevant moments ---");
    expect(result).not.toContain("unrelated story about other things");
  });

  test("11. still works (no throw) when readMoments option is absent (cold start)", async () => {
    const axon = makeAxonWithActive("typescript");

    const resultPromise = injectContext("no-moments-option-sess", {
      loadAxon: async () => axon,
      readShortTermFiles: async () => [],
      // readMoments deliberately omitted
    });

    await expect(resultPromise).resolves.toBeTypeOf("string");
  });
});
