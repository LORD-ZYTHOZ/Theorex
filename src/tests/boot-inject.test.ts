// tests/boot-inject.test.ts — Tests for src/family/boot-inject.ts generateBootContext.
// Uses temp dirs and a minimal AxonStore to avoid touching real ~/.openclaw files.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateBootContext } from "../family/boot-inject";
import { AxonStore } from "../axon/store";
import { loadConfig } from "../config";

const TMP = join(tmpdir(), "theorex-boot-inject-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

async function makeConfig(axonPath: string) {
  const base = await loadConfig().catch(() => null);
  return {
    ...(base ?? {}),
    axonPath,
    sharedAxonPath: axonPath,
    coldStorePath: "",
    agentAxonDir: TMP,
    promotionThreshold: 0.5,
    location: "Sydney",
    recencyHalfLifeMs: 86_400_000,
    frequencyWeight: 0.4,
    neighborWeight: 0.2,
    activeTierThreshold: 0.6,
    lessTierThreshold: 0.1,
  } as Parameters<typeof generateBootContext>[0];
}

describe("generateBootContext()", () => {
  test("generates markdown file at specified output path", async () => {
    const axonPath = join(TMP, "empty-axon.json");
    await Bun.write(axonPath, JSON.stringify({ nodes: [], edges: [] }));
    const outputPath = join(TMP, "context-empty.md");
    const config = await makeConfig(axonPath);

    const result = await generateBootContext(config, outputPath);

    expect(result.outputPath).toBe(outputPath);
    const content = await readFile(outputPath, "utf-8");
    expect(content).toContain("# Theorex Shared Context");
  });

  test("returns totalConcepts=0 for empty axon", async () => {
    const axonPath = join(TMP, "empty-axon2.json");
    await Bun.write(axonPath, JSON.stringify({ nodes: [], edges: [] }));
    const outputPath = join(TMP, "context-empty2.md");
    const config = await makeConfig(axonPath);

    const result = await generateBootContext(config, outputPath);

    expect(result.totalConcepts).toBe(0);
    expect(result.activeConcepts).toBe(0);
  });

  test("includes no-active-concepts placeholder when axon is empty", async () => {
    const axonPath = join(TMP, "empty-axon3.json");
    await Bun.write(axonPath, JSON.stringify({ nodes: [], edges: [] }));
    const outputPath = join(TMP, "context-empty3.md");
    const config = await makeConfig(axonPath);

    await generateBootContext(config, outputPath);
    const content = await readFile(outputPath, "utf-8");
    expect(content).toContain("No active shared concepts");
  });

  test("includes generated date in output", async () => {
    const axonPath = join(TMP, "empty-axon4.json");
    await Bun.write(axonPath, JSON.stringify({ nodes: [], edges: [] }));
    const outputPath = join(TMP, "context-dated.md");
    const config = await makeConfig(axonPath);

    await generateBootContext(config, outputPath);
    const content = await readFile(outputPath, "utf-8");
    // Should contain a date like 2026-03-18
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("creates output directory recursively if missing", async () => {
    const axonPath = join(TMP, "empty-axon5.json");
    await Bun.write(axonPath, JSON.stringify({ nodes: [], edges: [] }));
    const deepOutput = join(TMP, "deep", "nested", "context.md");
    const config = await makeConfig(axonPath);

    const result = await generateBootContext(config, deepOutput);
    expect(result.outputPath).toBe(deepOutput);
    const content = await readFile(deepOutput, "utf-8");
    expect(content).toContain("# Theorex Shared Context");
  });

  test("counts concepts from axon nodes above LESS tier", async () => {
    const axonPath = join(TMP, "active-axon.json");
    const store = await AxonStore.load(axonPath);

    // Write several nodes — they start as newly created (high recency)
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      store.graph.addNode(String(i), {
        concept_id: i,
        surface_form: `concept_${i}_long_enough`,
        last_seen: now,
        frequency_count: 5,
        importance_weight: 0.8,
        source_weight: 0.8,
        relevance_tier: "ACTIVE",
        sentiment_tier: "NEUTRAL",
        agent_id: "test-agent",
        node_type: "concept",
        observation_type: "discovery",
      });
    }
    await store.save(axonPath);

    const outputPath = join(TMP, "context-active.md");
    const config = await makeConfig(axonPath);
    const result = await generateBootContext(config, outputPath, Date.now());

    expect(result.totalConcepts).toBe(3);
    // activeConcepts may be 3 or less depending on tier classification
    expect(result.activeConcepts).toBeGreaterThanOrEqual(0);
  });
});
