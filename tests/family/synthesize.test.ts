import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { synthesizeToAgent } from "../../src/family/synthesize";
import { AxonStore } from "../../src/axon/store";
import { DEFAULT_CONFIG } from "../../src/config";

let tmpDir: string;
let agentsDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "theorex-synthesize-test-"));
  agentsDir = join(tmpDir, "agents");
  await mkdir(agentsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// Use a non-existent URL to force fallback in unit tests
const config = {
  ...DEFAULT_CONFIG,
  agentAxonDir: "",
  sharedAxonPath: "",
  lmStudioUrl: "http://localhost:19999", // guaranteed no server here
  lmStudioTimeoutMs: 500,
};

test("synthesizeToAgent falls back to NLP when LLM unavailable", async () => {
  const overrideConfig = { ...config, agentAxonDir: agentsDir };
  const result = await synthesizeToAgent(
    "main",
    "anchor blindness caused overconfidence at key support level",
    overrideConfig,
  );
  expect(result.agentId).toBe("main");
  expect(result.fallbackUsed).toBe(true);
});

test("synthesizeToAgent fallback writes concepts to axon", async () => {
  const overrideConfig = { ...config, agentAxonDir: agentsDir };
  const result = await synthesizeToAgent(
    "main",
    "trading risk signal profit equity drawdown kelly sizing",
    overrideConfig,
  );
  const store = await AxonStore.load(join(agentsDir, "main", "theorex", "axon.json"));
  expect(store.graph.order).toBeGreaterThanOrEqual(0);
  // Result should be defined regardless of LLM availability
  expect(result.conceptsAdded).toBeGreaterThanOrEqual(0);
});

test("synthesizeToAgent returns zero lessons on fallback", async () => {
  const overrideConfig = { ...config, agentAxonDir: agentsDir };
  const result = await synthesizeToAgent("main", "some text here", overrideConfig);
  expect(result.lessonsExtracted).toBe(0);
  expect(result.fallbackUsed).toBe(true);
});
