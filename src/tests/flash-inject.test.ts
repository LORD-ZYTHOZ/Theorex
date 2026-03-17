// tests/flash-inject.test.ts — Tests for src/flash/inject.ts injectContext.
// Uses mock dependency injection to avoid real file I/O and API calls.

import { describe, test, expect } from "bun:test";
import { injectContext } from "../flash/inject";
import { AxonStore } from "../axon/store";
import type { ShortTermEntry } from "../short-term/store";
import type { MomentNode } from "../moments/store";
import type { Config } from "../config";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

async function emptyAxon(): Promise<AxonStore> {
  const path = join(tmpdir(), `test-axon-inject-${Date.now()}.json`);
  await Bun.write(path, JSON.stringify({ nodes: [], edges: [] }));
  return AxonStore.load(path);
}

const emptyStm = async (): Promise<ShortTermEntry[]> => [];
const emptyMoments = async (): Promise<MomentNode[]> => [];
const nullConfig = async () => null;

const minimalConfig: Config = {
  axonPath: "/tmp/test.json",
  sharedAxonPath: "/tmp/shared.json",
  coldStorePath: "",
  agentAxonDir: tmpdir(),
  temporalAgentId: "main",
  temporalStorePath: "/tmp/temporal.json",
  lmStudioUrl: "http://localhost:9999",
  lmStudioEmbedModel: "nomic",
  lmStudioTimeoutMs: 100,
  ragOnnxModel: "",
  ragBootstrapK: 5,
  ragBootstrapMinSimilarity: 0.4,
  synthEndpoint: "http://localhost:9999",
  promotionThreshold: 0.5,
  recencyHalfLifeMs: 86_400_000,
  frequencyWeight: 0.4,
  neighborWeight: 0.2,
  activeTierThreshold: 0.6,
  lessTierThreshold: 0.1,
  location: "Sydney",
  deploymentMode: "personal",
  professionPack: null,
  professionPacksDir: null,
  contextSlideThreshold: 0.5,
  contextSlideCooldownCalls: 20,
};

// ---------------------------------------------------------------------------
// injectContext — cold start (all lobes empty)
// ---------------------------------------------------------------------------

describe("injectContext() — cold start", () => {
  test("returns empty string when all lobes are empty", async () => {
    const result = await injectContext("test-session", {
      loadAxon: emptyAxon,
      readShortTermFiles: emptyStm,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });
    expect(result).toBe("");
  });

  test("never throws even when axon/stm/moments throw", async () => {
    // loadConfig must return null (not throw) — injectContext calls it outside try/catch
    const result = await injectContext("test-session", {
      loadAxon: async () => { throw new Error("axon unavailable"); },
      readShortTermFiles: async () => { throw new Error("stm unavailable"); },
      readMoments: async () => { throw new Error("moments unavailable"); },
      loadConfig: nullConfig,
    });
    // Should not throw and returns a string (possibly empty)
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// injectContext — with ACTIVE nodes
// ---------------------------------------------------------------------------

describe("injectContext() — with ACTIVE axon nodes", () => {
  test("includes THEOREX ACTIVE CONTEXT header when ACTIVE nodes present", async () => {
    const path = join(tmpdir(), `test-axon-active-${Date.now()}.json`);
    const store = await AxonStore.load(path);
    const now = new Date().toISOString();
    store.graph.addNode("1", {
      concept_id: 1,
      surface_form: "trading strategy",
      last_seen: now,
      frequency_count: 5,
      importance_weight: 0.9,
      source_weight: 0.9,
      relevance_tier: "ACTIVE",
      sentiment_tier: "POSITIVE",
      agent_id: "main",
      node_type: "concept",
      observation_type: "discovery",
    });
    await store.save(path);

    const result = await injectContext("test-active", {
      loadAxon: async () => AxonStore.load(path),
      readShortTermFiles: emptyStm,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });

    expect(result).toContain("=== THEOREX ACTIVE CONTEXT ===");
    expect(result).toContain("trading strategy");
  });

  test("includes relevance_tier and sentiment_tier in bracket notation", async () => {
    const path = join(tmpdir(), `test-axon-tier-${Date.now()}.json`);
    const store = await AxonStore.load(path);
    const now = new Date().toISOString();
    store.graph.addNode("2", {
      concept_id: 2,
      surface_form: "risk management",
      last_seen: now,
      frequency_count: 3,
      importance_weight: 0.7,
      source_weight: 0.7,
      relevance_tier: "ACTIVE",
      sentiment_tier: "NEUTRAL",
      agent_id: "main",
      node_type: "concept",
      observation_type: "feature",
    });
    await store.save(path);

    const result = await injectContext("test-tier", {
      loadAxon: async () => AxonStore.load(path),
      readShortTermFiles: emptyStm,
      readMoments: emptyMoments,
      loadConfig: nullConfig,
    });

    expect(result).toContain("[ACTIVE/NEUTRAL]");
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
      loadAxon: emptyAxon,
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
      loadAxon: emptyAxon,
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
  test("includes Relevant moments section when moments overlap ACTIVE concept_ids", async () => {
    const axonPath = join(tmpdir(), `test-axon-moments-${Date.now()}.json`);
    const store = await AxonStore.load(axonPath);
    const now = new Date().toISOString();
    store.graph.addNode("30", {
      concept_id: 30,
      surface_form: "scalping session",
      last_seen: now,
      frequency_count: 4,
      importance_weight: 0.85,
      source_weight: 0.85,
      relevance_tier: "ACTIVE",
      sentiment_tier: "POSITIVE",
      agent_id: "main",
      node_type: "concept",
      observation_type: "discovery",
    });
    await store.save(axonPath);

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
      loadAxon: async () => AxonStore.load(axonPath),
      readShortTermFiles: emptyStm,
      readMoments: async () => moments,
      loadConfig: nullConfig,
    });

    expect(result).toContain("Relevant moments");
    expect(result).toContain("Scalping session went very well");
  });
});
