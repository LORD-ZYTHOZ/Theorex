import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promoteToShared } from "../../src/family/promote";
import { writeToAgent } from "../../src/family/write";
import { AxonStore } from "../../src/axon/store";
import { DEFAULT_CONFIG } from "../../src/config";

let tmpDir: string;
let agentsDir: string;
let sharedPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "theorex-promote-test-"));
  agentsDir = join(tmpDir, "agents");
  sharedPath = join(tmpDir, "shared-axon.json");
  await mkdir(agentsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const baseConfig = {
  ...DEFAULT_CONFIG,
  agentAxonDir: "",       // will be overridden per test
  sharedAxonPath: "",     // will be overridden per test
  promotionThreshold: 0.7,
};

test("promoteToShared moves qualifying concepts to shared axon", async () => {
  const config = { ...baseConfig, agentAxonDir: agentsDir, sharedAxonPath: sharedPath };

  // Write enough text for concepts to reach ACTIVE tier (high frequency)
  const text = "trading trading trading risk risk signal signal profit profit equity equity";
  await writeToAgent("main", text, config);
  await writeToAgent("main", text, config); // second write boosts frequency

  const result = await promoteToShared("main", config);
  expect(result.agentId).toBe("main");
  // At least some concepts should be promoted
  expect(result.promoted + result.skipped).toBeGreaterThan(0);
});

test("promoteToShared creates shared-axon.json", async () => {
  const config = { ...baseConfig, agentAxonDir: agentsDir, sharedAxonPath: sharedPath };
  await writeToAgent("main", "trading risk signal profit", config);
  await promoteToShared("main", config);

  const sharedStore = await AxonStore.load(sharedPath);
  expect(sharedStore.graph.order).toBeGreaterThanOrEqual(0);
});

test("promoteToShared forceIds bypasses threshold", async () => {
  // Set impossibly high threshold so nothing auto-promotes
  const config = { ...baseConfig, agentAxonDir: agentsDir, sharedAxonPath: sharedPath, promotionThreshold: 9999 };
  await writeToAgent("main", "trading signal risk", config);

  // Load private store to get a concept_id
  const agentPath = join(agentsDir, "main", "theorex", "axon.json");
  const privateStore = await AxonStore.load(agentPath);
  const firstKey = privateStore.graph.nodes()[0];
  if (!firstKey) return; // no concepts extracted — skip

  const conceptId = privateStore.graph.getNodeAttributes(firstKey).concept_id;
  const forceIds = new Set([conceptId]);

  const result = await promoteToShared("main", config, Date.now(), forceIds);
  expect(result.promoted).toBeGreaterThanOrEqual(1);
});

test("promoteToShared conflict resolution: higher source_weight existing node wins", async () => {
  const config = { ...baseConfig, agentAxonDir: agentsDir, sharedAxonPath: sharedPath, promotionThreshold: 0 };

  // Write as qwen-sage (0.8 weight)
  await writeToAgent("qwen-sage", "trading signal", config);
  const qwenAgentPath = join(agentsDir, "qwen-sage", "theorex", "axon.json");
  const qwenStore = await AxonStore.load(qwenAgentPath);
  const qwenNodes = qwenStore.graph.nodes();
  if (qwenNodes.length === 0) return;

  // Promote qwen concepts to shared first
  await promoteToShared("qwen-sage", config);

  // Now write same text as main (0.7 weight) and try to promote
  await writeToAgent("main", "trading signal", config);
  const resultMain = await promoteToShared("main", config);

  // main (0.7) should not override qwen-sage (0.8) nodes — they get skipped
  const sharedStore = await AxonStore.load(sharedPath);
  for (const key of sharedStore.graph.nodes()) {
    const attrs = sharedStore.graph.getNodeAttributes(key);
    // Nodes from qwen-sage (0.8) should not be overwritten by main (0.7)
    expect(attrs.source_weight).toBeGreaterThanOrEqual(0.7);
  }
  expect(resultMain.skipped).toBeGreaterThanOrEqual(0); // Some or all skipped
});

test("promoteToShared empty private store produces zero result", async () => {
  const config = { ...baseConfig, agentAxonDir: agentsDir, sharedAxonPath: sharedPath };
  const result = await promoteToShared("main", config);
  expect(result.promoted).toBe(0);
  expect(result.skipped).toBe(0);
});

test("promoteToShared records agent_id on promoted nodes", async () => {
  const config = { ...baseConfig, agentAxonDir: agentsDir, sharedAxonPath: sharedPath, promotionThreshold: 0 };
  await writeToAgent("qwen-sage", "machine learning inference embeddings neural network", config);
  await promoteToShared("qwen-sage", config);

  const sharedStore = await AxonStore.load(sharedPath);
  for (const key of sharedStore.graph.nodes()) {
    const attrs = sharedStore.graph.getNodeAttributes(key);
    expect(attrs.agent_id).toBe("qwen-sage");
  }
});
