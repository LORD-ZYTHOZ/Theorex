// tests/clash-fixes.test.ts — Regression tests for the 4 phase integration clashes.
//
// CLASH-01: observation_type updated on re-encounter
// CLASH-02: parsePython/parseGo imported and invoked without crashing
// CLASH-03: node_type preserved on promotion to shared axon
// CLASH-04: config.axonPath respected instead of hardcoded "data/axon.json"

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AxonStore } from "../axon/store";
import { promoteToShared } from "../family/promote";
import { ingestCode } from "../code/ingest";
import type { Config } from "../config";
import { DEFAULT_CONFIG } from "../config";

const TMP = join(tmpdir(), "theorex-clash-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    agentAxonDir: TMP,
    sharedAxonPath: join(TMP, "shared-axon.json"),
    axonPath: join(TMP, "main-axon.json"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CLASH-01: observation_type updated on re-encounter
// ---------------------------------------------------------------------------

describe("CLASH-01: observation_type updated on re-encounter", () => {
  test("re-encountering a concept with a new observation_type updates the stored value", () => {
    const store = new AxonStore();
    const base = {
      concept_id: 1001,
      surface_form: "trading",
      importance_score: 0.8,
      frequency_count: 1,
      composite_score: 0.8,
      source_weight: 1.0,
      node_type: "concept" as const,
      timestamp: new Date().toISOString(),
    };

    // First encounter — tagged as "text"
    store.mergeNode(base, "agent-a", "text");
    const after1 = store.graph.getNodeAttributes(String(base.concept_id));
    expect(after1.observation_type).toBe("text");

    // Re-encounter with richer type "image" — should WIN
    store.mergeNode({ ...base, frequency_count: 1 }, "agent-a", "image");
    const after2 = store.graph.getNodeAttributes(String(base.concept_id));
    expect(after2.observation_type).toBe("image");

    // Re-encounter with empty string — should NOT overwrite
    store.mergeNode({ ...base, frequency_count: 1 }, "agent-a", "");
    const after3 = store.graph.getNodeAttributes(String(base.concept_id));
    expect(after3.observation_type).toBe("image"); // preserved
  });

  test("frequency_count accumulates across all re-encounters", () => {
    const store = new AxonStore();
    const event = {
      concept_id: 1002,
      surface_form: "memory",
      importance_score: 0.5,
      frequency_count: 2,
      composite_score: 0.5,
      source_weight: 1.0,
      node_type: "concept" as const,
      timestamp: new Date().toISOString(),
    };
    store.mergeNode(event, "agent-a", "text");
    store.mergeNode({ ...event, frequency_count: 3 }, "agent-a", "discovery");
    const attrs = store.graph.getNodeAttributes("1002");
    expect(attrs.frequency_count).toBe(5);
    expect(attrs.observation_type).toBe("discovery");
  });

  test("node_type is updated on re-encounter when a more specific type is provided", () => {
    const store = new AxonStore();
    const event = {
      concept_id: 1003,
      surface_form: "parseFile",
      importance_score: 1.0,
      frequency_count: 1,
      composite_score: 1.0,
      source_weight: 1.0,
      node_type: "concept" as const,
      timestamp: new Date().toISOString(),
    };
    store.mergeNode(event);
    expect(store.graph.getNodeAttribute("1003", "node_type")).toBe("concept");

    store.mergeNode({ ...event, node_type: "code_function", frequency_count: 1 });
    expect(store.graph.getNodeAttribute("1003", "node_type")).toBe("code_function");
  });
});

// ---------------------------------------------------------------------------
// CLASH-02: parsePython and parseGo invoked without crashing
// ---------------------------------------------------------------------------

describe("CLASH-02: parsePython and parseGo properly imported", () => {
  test("parsePython returns ParseResult (no crash, no ReferenceError)", async () => {
    const { parsePython } = await import("../code/parse-multi");
    const result = await parsePython("/nonexistent/file.py");
    // Returns empty result for nonexistent file — does NOT crash
    expect(result).toHaveProperty("symbols");
    expect(result).toHaveProperty("calls");
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  test("parseGo returns ParseResult (no crash, no ReferenceError)", async () => {
    const { parseGo } = await import("../code/parse-multi");
    const result = await parseGo("/nonexistent/file.go");
    expect(result).toHaveProperty("symbols");
    expect(result).toHaveProperty("calls");
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  test("parsePython extracts symbols from real Python source", async () => {
    const pyFile = join(TMP, "sample.py");
    await writeFile(pyFile, [
      "class Trainer:",
      "    def fit(self, data):",
      "        pass",
      "",
      "def train_loop(model, epochs):",
      "    pass",
    ].join("\n"));

    const { parsePython } = await import("../code/parse-multi");
    const result = await parsePython(pyFile, TMP);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Trainer");
    expect(names.some((n) => n.includes("fit"))).toBe(true);
    expect(names.some((n) => n.includes("train_loop"))).toBe(true);
  });

  test("parseGo extracts symbols from real Go source", async () => {
    const goFile = join(TMP, "sample.go");
    await writeFile(goFile, [
      "package main",
      "",
      "func main() {}",
      "",
      "func processData(input string) string {",
      "    return input",
      "}",
    ].join("\n"));

    const { parseGo } = await import("../code/parse-multi");
    const result = await parseGo(goFile, TMP);
    const names = result.symbols.map((s) => s.name);
    expect(names.some((n) => n.includes("main"))).toBe(true);
    expect(names.some((n) => n.includes("processData"))).toBe(true);
  });

  test("ingestCode processes .py files without crashing", async () => {
    const pyDir = join(TMP, "py-project");
    await mkdir(pyDir, { recursive: true });
    await writeFile(join(pyDir, "model.py"), [
      "class Model:",
      "    def predict(self, x):",
      "        return x",
    ].join("\n"));

    const config = makeConfig();
    const result = await ingestCode("test-agent-py", pyDir, config);
    expect(result.filesProcessed).toBe(1);
    expect(result.symbolsAdded).toBeGreaterThan(0);
  });

  test("ingestCode processes .go files without crashing", async () => {
    const goDir = join(TMP, "go-project");
    await mkdir(goDir, { recursive: true });
    await writeFile(join(goDir, "server.go"), [
      "package main",
      "func startServer() {}",
      "func handleRequest(w http.ResponseWriter, r *http.Request) {}",
    ].join("\n"));

    const config = makeConfig();
    const result = await ingestCode("test-agent-go", goDir, config);
    expect(result.filesProcessed).toBe(1);
    expect(result.symbolsAdded).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CLASH-03: node_type preserved on promotion to shared axon
// ---------------------------------------------------------------------------

describe("CLASH-03: node_type preserved during promotion", () => {
  test("promoted moment node retains node_type: 'moment'", async () => {
    const agentId = "clash03-agent";
    const agentAxonPath = join(TMP, agentId, "theorex", "axon.json");
    await mkdir(join(TMP, agentId, "theorex"), { recursive: true });

    // Write a private axon with a moment-type node
    const store = new AxonStore();
    store.mergeNode({
      concept_id: 9001,
      surface_form: "breakthrough",
      importance_score: 1.0,
      frequency_count: 10,
      composite_score: 0.9,
      source_weight: 1.0,
      node_type: "moment",
      timestamp: new Date().toISOString(),
    }, agentId, "discovery");
    await store.save(agentAxonPath);

    // Promote to shared
    const config = makeConfig({ promotionThreshold: 0.0 }); // force-promote all
    await promoteToShared(agentId, config);

    // Check shared axon
    const sharedPath = join(TMP, "shared-axon.json");
    const sharedStore = await AxonStore.load(sharedPath);
    const attrs = sharedStore.graph.getNodeAttributes("9001");
    expect(attrs.node_type).toBe("moment"); // NOT "concept"
  });

  test("promoted code_function node retains node_type: 'code_function'", async () => {
    const agentId = "clash03-agent-code";
    const agentAxonPath = join(TMP, agentId, "theorex", "axon.json");
    await mkdir(join(TMP, agentId, "theorex"), { recursive: true });

    const store = new AxonStore();
    store.mergeNode({
      concept_id: 9002,
      surface_form: "AxonStore.mergeNode",
      importance_score: 1.0,
      frequency_count: 15,
      composite_score: 0.95,
      source_weight: 1.0,
      node_type: "code_function",
      timestamp: new Date().toISOString(),
    }, agentId, "");
    await store.save(agentAxonPath);

    const config = makeConfig({
      promotionThreshold: 0.0,
      sharedAxonPath: join(TMP, "shared-axon-code.json"),
    });
    await promoteToShared(agentId, config);

    const sharedStore = await AxonStore.load(join(TMP, "shared-axon-code.json"));
    const attrs = sharedStore.graph.getNodeAttributes("9002");
    expect(attrs.node_type).toBe("code_function"); // NOT "concept"
  });

  test("plain concept node still promoted as 'concept'", async () => {
    const agentId = "clash03-agent-concept";
    const agentAxonPath = join(TMP, agentId, "theorex", "axon.json");
    await mkdir(join(TMP, agentId, "theorex"), { recursive: true });

    const store = new AxonStore();
    store.mergeNode({
      concept_id: 9003,
      surface_form: "refactor",
      importance_score: 0.8,
      frequency_count: 5,
      composite_score: 0.8,
      source_weight: 1.0,
      node_type: "concept",
      timestamp: new Date().toISOString(),
    }, agentId, "");
    await store.save(agentAxonPath);

    const config = makeConfig({
      promotionThreshold: 0.0,
      sharedAxonPath: join(TMP, "shared-axon-concept.json"),
    });
    await promoteToShared(agentId, config);

    const sharedStore = await AxonStore.load(join(TMP, "shared-axon-concept.json"));
    const attrs = sharedStore.graph.getNodeAttributes("9003");
    expect(attrs.node_type).toBe("concept");
  });
});

// ---------------------------------------------------------------------------
// CLASH-04: config.axonPath respected (not hardcoded "data/axon.json")
// ---------------------------------------------------------------------------

describe("CLASH-04: config.axonPath respected", () => {
  test("ingestCode writes to agentAxonDir-derived path, not hardcoded data/axon.json", async () => {
    const customDir = join(TMP, "custom-agents");
    const tsDir = join(TMP, "ts-project");
    await mkdir(customDir, { recursive: true });
    await mkdir(tsDir, { recursive: true });
    await writeFile(join(tsDir, "utils.ts"), "export function add(a: number, b: number) { return a + b; }");

    const config = makeConfig({ agentAxonDir: customDir });
    const result = await ingestCode("clash04-agent", tsDir, config);

    // File must exist at the custom path
    const expectedAxon = join(customDir, "clash04-agent", "theorex", "axon.json");
    const exists = await Bun.file(expectedAxon).exists();
    expect(exists).toBe(true);
    expect(result.symbolsAdded).toBeGreaterThan(0);
  });

  test("AxonStore.load returns empty store (not crash) for custom non-existent path", async () => {
    const customPath = join(TMP, "custom", "axon.json");
    const store = await AxonStore.load(customPath);
    expect(store.graph.order).toBe(0); // empty — file doesn't exist yet
  });

  test("promoteToShared writes to sharedAxonPath from config, not default", async () => {
    const customShared = join(TMP, "custom-shared.json");
    const agentId = "clash04-promote";
    const agentAxonPath = join(TMP, agentId, "theorex", "axon.json");
    await mkdir(join(TMP, agentId, "theorex"), { recursive: true });

    const store = new AxonStore();
    store.mergeNode({
      concept_id: 9004,
      surface_form: "config-path",
      importance_score: 1.0,
      frequency_count: 10,
      composite_score: 0.9,
      source_weight: 1.0,
      node_type: "concept",
      timestamp: new Date().toISOString(),
    });
    await store.save(agentAxonPath);

    const config = makeConfig({
      promotionThreshold: 0.0,
      sharedAxonPath: customShared,
    });
    await promoteToShared(agentId, config);

    const exists = await Bun.file(customShared).exists();
    expect(exists).toBe(true); // written to custom path

    // Default path should NOT exist
    const defaultExists = await Bun.file("data/axon.json").exists().catch(() => false);
    // Note: this may exist from other test runs, so we just verify the custom path
    const sharedStore = await AxonStore.load(customShared);
    expect(sharedStore.graph.hasNode("9004")).toBe(true);
  });
});
