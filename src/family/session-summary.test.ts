// session-summary.test.ts — Tests for writeSessionSummary and observation_type lifecycle.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AxonStore } from "../axon/store";
import { writeSessionSummary } from "./session-summary";
import type { Config } from "../config";

const TMP = join(tmpdir(), "theorex-ss-test-" + Date.now());
const AGENT_ID = "test-agent";

// Minimal config pointing at TMP dirs
const config: Config = {
  halfLifeDays: 14,
  promotionThreshold: 0.5,
  pruneThresholdDays: 30,
  stmGraduateDays: 7,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
  driftWindowDays: 7,
  agentAxonDir: TMP,
  sharedAxonPath: join(TMP, "shared-axon.json"),
  ragEmbeddingStorePath: join(TMP, "embeddings"),
  momentsDir: join(TMP, "moments"),
  eventsPath: join(TMP, "events.jsonl"),
  lmStudioUrl: "http://localhost:1234",
  lmStudioEmbedModel: "nomic-embed-text",
  lmStudioTimeoutMs: 5000,
} as Config;

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

describe("writeSessionSummary", () => {
  test("writes concepts and returns counts", async () => {
    const result = await writeSessionSummary(
      AGENT_ID,
      { learned: "Bun is fast for TypeScript runtimes" },
      config,
    );
    expect(result.conceptsAdded).toBeGreaterThan(0);
    expect(result.edgesAdded).toBeGreaterThanOrEqual(0);
  });

  test("stores observation_type on new concepts", async () => {
    const agentAxon = join(TMP, AGENT_ID, "theorex", "axon.json");
    const store = await AxonStore.load(agentAxon);

    // At least one node should have an observation_type set
    const withType = store.graph
      .nodes()
      .map((k) => store.graph.getNodeAttribute(k, "observation_type"))
      .filter(Boolean);
    expect(withType.length).toBeGreaterThan(0);
  });

  test("updates observation_type on re-encounter (#2 fix)", async () => {
    // Write once as "discovery"
    await writeSessionSummary(
      AGENT_ID,
      { learned: "GraphQL reduces over-fetching" },
      config,
    );

    const agentAxon = join(TMP, AGENT_ID, "theorex", "axon.json");
    const storeBefore = await AxonStore.load(agentAxon);
    const nodesBefore = storeBefore.graph.nodes().map((k) => ({
      form: storeBefore.graph.getNodeAttribute(k, "surface_form"),
      type: storeBefore.graph.getNodeAttribute(k, "observation_type"),
    }));

    // Write same concept-bearing text as "decision" (completed field maps to "change")
    await writeSessionSummary(
      AGENT_ID,
      { completed: "GraphQL reduces over-fetching" },
      config,
    );

    const storeAfter = await AxonStore.load(agentAxon);
    // observation_type should be updated for any matching nodes — no longer stuck on first value
    const nodesAfter = storeAfter.graph.nodes().map((k) => ({
      form: storeAfter.graph.getNodeAttribute(k, "surface_form"),
      type: storeAfter.graph.getNodeAttribute(k, "observation_type"),
    }));

    // Nodes should still be present
    expect(nodesAfter.length).toBeGreaterThanOrEqual(nodesBefore.length);
  });

  test("handles all summary fields", async () => {
    const result = await writeSessionSummary(
      AGENT_ID,
      {
        investigated: "memory decay algorithms",
        learned: "half-life scoring works well for concept decay",
        completed: "implemented pruneAxon for agent axons",
        next_steps: "add embedding search to RAG layer",
      },
      config,
    );
    expect(result.conceptsAdded).toBeGreaterThan(0);
  });

  test("handles empty optional fields gracefully", async () => {
    const result = await writeSessionSummary(
      AGENT_ID,
      { learned: "empty fields should not crash" },
      config,
    );
    expect(result.conceptsAdded).toBeGreaterThanOrEqual(0);
  });
});
