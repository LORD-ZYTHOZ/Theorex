// Phase 9: Memory Compression tests
// Tests: ColdStore, compress/decompress cycle, wakeNode(), scan compression trigger

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ColdStore } from "../../src/axon/cold";
import { compressNode } from "../../src/axon/compress";
import { decompressNode } from "../../src/axon/decompress";
import { AxonStore } from "../../src/axon/store";
import { scanAxon } from "../../src/axon/scan";
import type { AxonNodeAttrs } from "../../src/axon/store";
import type { ConceptEvent } from "../../src/types";
import { DEFAULT_CONFIG } from "../../src/config";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "theorex-p9-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ColdStore
// ---------------------------------------------------------------------------

test("ColdStore: archive and restore full-trip", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  const attrs: AxonNodeAttrs = {
    concept_id: 42,
    surface_form: "trading risk",
    importance_weight: 0.15,
    relevance_tier: "LESS",
    sentiment_tier: "NEUTRAL",
    last_seen: "2026-01-01T00:00:00.000Z",
    frequency_count: 3,
    source_weight: 1.0,
    agent_id: "main",
    node_type: "concept",
    observation_type: "",
    archive_id: "",
  };

  db.archive("node_42_ts", attrs);
  const restored = db.restore("node_42_ts");
  expect(restored).toEqual(attrs);

  db.close();
});

test("ColdStore: returns null for unknown archive_id", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  expect(db.restore("nonexistent")).toBeNull();
  db.close();
});

test("ColdStore: delete removes entry", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  db.archive("x", { foo: "bar" });
  expect(db.restore("x")).not.toBeNull();
  db.delete("x");
  expect(db.restore("x")).toBeNull();
  db.close();
});

test("ColdStore: count reflects archived nodes", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  expect(db.count()).toBe(0);
  db.archive("a", {});
  db.archive("b", {});
  expect(db.count()).toBe(2);
  db.delete("a");
  expect(db.count()).toBe(1);
  db.close();
});

// ---------------------------------------------------------------------------
// compressNode / decompressNode
// ---------------------------------------------------------------------------

const sampleAttrs: AxonNodeAttrs = {
  concept_id: 99,
  surface_form: "position sizing",
  importance_weight: 0.08,
  relevance_tier: "LESS",
  sentiment_tier: "NEUTRAL",
  last_seen: "2025-12-01T00:00:00.000Z",
  frequency_count: 2,
  source_weight: 1.0,
  agent_id: "main",
  node_type: "concept",
  observation_type: "",
  archive_id: "",
};

test("compressNode: returns stub with SLEEPING tier and archive_id", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  const stub = compressNode("99", sampleAttrs, db);

  expect(stub.relevance_tier).toBe("SLEEPING");
  expect(stub.archive_id).toBeTruthy();
  expect(stub.importance_weight).toBe(0);
  expect(db.count()).toBe(1);

  db.close();
});

test("decompressNode: restores full attrs and cleans up cold storage", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  const stub = compressNode("99", sampleAttrs, db);
  expect(db.count()).toBe(1);

  const restored = decompressNode(stub, db) as AxonNodeAttrs;

  expect(restored.relevance_tier).toBe("LESS");
  expect(restored.surface_form).toBe("position sizing");
  expect(restored.concept_id).toBe(99);
  expect(db.count()).toBe(0); // archive deleted after restore

  db.close();
});

test("decompressNode: missing archive falls back to LESS tier", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  const stub: AxonNodeAttrs = { ...sampleAttrs, relevance_tier: "SLEEPING", archive_id: "ghost_id" };

  const result = decompressNode(stub, db) as AxonNodeAttrs;
  expect(result.relevance_tier).toBe("LESS");
  expect(result.archive_id).toBe("");

  db.close();
});

test("decompressNode: no-op on non-SLEEPING node", () => {
  const db = new ColdStore(join(tmpDir, "cold.db"));
  const result = decompressNode(sampleAttrs, db);
  expect(result).toBe(sampleAttrs); // same reference, untouched
  db.close();
});

// ---------------------------------------------------------------------------
// AxonStore.wakeNode()
// ---------------------------------------------------------------------------

function makeEvent(id: number, surface: string): ConceptEvent {
  return {
    concept_id: id,
    surface_form: surface,
    importance_score: 1.0,
    frequency_count: 1,
    composite_score: 1.0,
    source_weight: 1.0,
    node_type: "concept",
    timestamp: new Date().toISOString(),
  };
}

test("AxonStore.wakeNode: sleeping node is restored to LESS on wake", () => {
  const store = new AxonStore();
  const dbPath = join(tmpDir, "cold.db");
  store.openCold(dbPath);

  // Manually add a sleeping node
  const event = makeEvent(1, "risk management");
  store.mergeNode(event);
  const key = "1";

  // Force to SLEEPING via compress
  const attrs = store.graph.getNodeAttributes(key);
  const stub = compressNode(key, attrs, store.cold!);
  for (const [k, v] of Object.entries(stub) as [keyof AxonNodeAttrs, AxonNodeAttrs[keyof AxonNodeAttrs]][]) {
    store.graph.setNodeAttribute(key, k, v);
  }

  expect(store.graph.getNodeAttribute(key, "relevance_tier")).toBe("SLEEPING");

  store.wakeNode(key);

  expect(store.graph.getNodeAttribute(key, "relevance_tier")).toBe("LESS");
  expect(store.graph.getNodeAttribute(key, "archive_id")).toBe("");
});

test("AxonStore.mergeNode: auto-wakes sleeping node on new co-occurrence", () => {
  const store = new AxonStore();
  store.openCold(join(tmpDir, "cold.db"));

  const event = makeEvent(2, "drawdown control");
  store.mergeNode(event);
  const key = "2";

  // Compress it to sleeping
  const attrs = store.graph.getNodeAttributes(key);
  const stub = compressNode(key, attrs, store.cold!);
  for (const [k, v] of Object.entries(stub) as [keyof AxonNodeAttrs, AxonNodeAttrs[keyof AxonNodeAttrs]][]) {
    store.graph.setNodeAttribute(key, k, v);
  }
  expect(store.graph.getNodeAttribute(key, "relevance_tier")).toBe("SLEEPING");

  // Merge same concept again — should wake it
  store.mergeNode(makeEvent(2, "drawdown control"));

  expect(store.graph.getNodeAttribute(key, "relevance_tier")).toBe("LESS");
  expect(store.graph.getNodeAttribute(key, "frequency_count")).toBeGreaterThan(1);
});

// ---------------------------------------------------------------------------
// scanAxon: compression trigger
// ---------------------------------------------------------------------------

test("scanAxon: compresses LESS nodes older than compressAfterDays", async () => {
  const axonPath = join(tmpDir, "axon.json");
  const coldPath = join(tmpDir, "cold.db");

  // Build a store with one LESS-tier node that is 60 days old
  const store = new AxonStore();
  const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const oldEvent: ConceptEvent = {
    concept_id: 777,
    surface_form: "old concept",
    importance_score: 0.1,
    frequency_count: 1,
    composite_score: 0.1,
    source_weight: 1.0,
    node_type: "concept",
    timestamp: oldDate,
  };
  store.mergeNode(oldEvent);
  // Force to LESS tier
  store.graph.setNodeAttribute("777", "relevance_tier", "LESS");
  store.graph.setNodeAttribute("777", "importance_weight", 0.05);
  await store.save(axonPath);

  const config = {
    ...DEFAULT_CONFIG,
    coldStorePath: coldPath,
    compressAfterDays: 30,
    eventsPath: join(tmpDir, "events.jsonl"),
  };

  await scanAxon(axonPath, config);

  // Reload and check
  const loaded = await AxonStore.load(axonPath);
  const tier = loaded.graph.getNodeAttribute("777", "relevance_tier");
  expect(tier).toBe("SLEEPING");

  // Verify it landed in cold storage
  const cold = new ColdStore(coldPath);
  expect(cold.count()).toBe(1);
  cold.close();
});

test("scanAxon: SLEEPING nodes survive a subsequent scan without being overwritten", async () => {
  const axonPath = join(tmpDir, "axon.json");
  const coldPath = join(tmpDir, "cold.db");

  // Create a node, compress it, save
  const store = new AxonStore();
  store.openCold(coldPath);
  const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const event: ConceptEvent = {
    concept_id: 999,
    surface_form: "sleeping concept",
    importance_score: 0.1,
    frequency_count: 1,
    composite_score: 0.1,
    source_weight: 1.0,
    node_type: "concept",
    timestamp: oldDate,
  };
  store.mergeNode(event);
  store.graph.setNodeAttribute("999", "relevance_tier", "LESS");
  store.graph.setNodeAttribute("999", "importance_weight", 0.05);

  // Compress it manually
  const attrs = store.graph.getNodeAttributes("999");
  const stub = compressNode("999", attrs, store.cold!);
  for (const [k, v] of Object.entries(stub) as [keyof typeof stub, (typeof stub)[keyof typeof stub]][]) {
    store.graph.setNodeAttribute("999", k, v);
  }
  await store.save(axonPath);

  // Run scan — sleeping node must still be SLEEPING after
  const config = {
    ...DEFAULT_CONFIG,
    coldStorePath: coldPath,
    compressAfterDays: 30,
    eventsPath: join(tmpDir, "events.jsonl"),
  };
  await scanAxon(axonPath, config);

  const loaded = await AxonStore.load(axonPath);
  expect(loaded.graph.getNodeAttribute("999", "relevance_tier")).toBe("SLEEPING");

  // Cold storage still has it (not double-compressed or deleted)
  const cold = new ColdStore(coldPath);
  expect(cold.count()).toBe(1);
  cold.close();
});

test("scanAxon: does NOT compress LESS nodes younger than compressAfterDays", async () => {
  const axonPath = join(tmpDir, "axon.json");
  const coldPath = join(tmpDir, "cold.db");

  const store = new AxonStore();
  const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const recentEvent: ConceptEvent = {
    concept_id: 888,
    surface_form: "fresh concept",
    importance_score: 0.1,
    frequency_count: 1,
    composite_score: 0.1,
    source_weight: 1.0,
    node_type: "concept",
    timestamp: recentDate,
  };
  store.mergeNode(recentEvent);
  store.graph.setNodeAttribute("888", "relevance_tier", "LESS");
  await store.save(axonPath);

  const config = {
    ...DEFAULT_CONFIG,
    coldStorePath: coldPath,
    compressAfterDays: 30,
    eventsPath: join(tmpDir, "events.jsonl"),
  };

  await scanAxon(axonPath, config);

  const loaded = await AxonStore.load(axonPath);
  const tier = loaded.graph.getNodeAttribute("888", "relevance_tier");
  expect(tier).not.toBe("SLEEPING"); // young node not archived

  const cold = new ColdStore(coldPath);
  expect(cold.count()).toBe(0);
  cold.close();
});
