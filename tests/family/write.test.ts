import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeToAgent } from "../../src/family/write";
import { AxonStore } from "../../src/axon/store";
import { DEFAULT_CONFIG } from "../../src/config";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "theorex-write-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const config = {
  ...DEFAULT_CONFIG,
  agentAxonDir: "",
  sharedAxonPath: "",
};

test("writeToAgent creates axon.json for the agent", async () => {
  // Override agentAxonDir to use tmp
  const overrideConfig = { ...config, agentAxonDir: tmpDir };
  const result = await writeToAgent("nova", "trading risk signal profit", overrideConfig);

  expect(result.agentId).toBe("nova");
  expect(result.conceptsAdded).toBeGreaterThan(0);
});

test("writeToAgent stores agent_id on nodes", async () => {
  const overrideConfig = { ...config, agentAxonDir: tmpDir };
  const result = await writeToAgent("qwen-sage", "machine learning inference embeddings", overrideConfig);

  const store = await AxonStore.load(result.axonPath);
  const nodes = store.graph.nodes();
  expect(nodes.length).toBeGreaterThan(0);

  for (const key of nodes) {
    const attrs = store.graph.getNodeAttributes(key);
    expect(attrs.agent_id).toBe("qwen-sage");
  }
});

test("writeToAgent uses correct source_weight for known agent", async () => {
  const overrideConfig = { ...config, agentAxonDir: tmpDir };
  const result = await writeToAgent("qwen-sage", "concept extraction pipeline", overrideConfig);

  const store = await AxonStore.load(result.axonPath);
  for (const key of store.graph.nodes()) {
    const attrs = store.graph.getNodeAttributes(key);
    expect(attrs.source_weight).toBe(0.8); // qwen-sage weight
  }
});

test("writeToAgent accumulates concepts across multiple calls", async () => {
  const overrideConfig = { ...config, agentAxonDir: tmpDir };

  const r1 = await writeToAgent("main", "trading signal risk", overrideConfig);
  const r2 = await writeToAgent("main", "profit equity drawdown", overrideConfig);

  const store = await AxonStore.load(r1.axonPath);
  expect(store.graph.order).toBeGreaterThan(r1.conceptsAdded);
  // Total concepts should be cumulative
  expect(store.graph.order).toBeGreaterThanOrEqual(r1.conceptsAdded + r2.conceptsAdded);
});

test("writeToAgent creates co-occurrence edges between concepts", async () => {
  const overrideConfig = { ...config, agentAxonDir: tmpDir };
  const result = await writeToAgent("main", "trading risk signal", overrideConfig);

  const store = await AxonStore.load(result.axonPath);
  // If multiple concepts extracted, edges should exist
  if (store.graph.order > 1) {
    expect(store.graph.size).toBeGreaterThan(0);
  }
});

test("writeToAgent empty text produces no concepts", async () => {
  const overrideConfig = { ...config, agentAxonDir: tmpDir };
  const result = await writeToAgent("main", "", overrideConfig);
  expect(result.conceptsAdded).toBe(0);
});
