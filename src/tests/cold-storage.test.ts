// tests/cold-storage.test.ts — Phase 9: ColdStore, compressNode, decompressNode
// Covers: SQLite write/read/delete, compression to stub, decompression to full attrs,
// graceful fallback when archive is missing, AxonStore wake integration.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

import { ColdStore } from "../axon/cold";
import { compressNode } from "../axon/compress";
import { decompressNode } from "../axon/decompress";
import { AxonStore } from "../axon/store";
import type { AxonNodeAttrs } from "../axon/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDbPath(): string {
  return join(tmpdir(), `theorex-cold-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function makeAttrs(overrides: Partial<AxonNodeAttrs> = {}): AxonNodeAttrs {
  return {
    concept_id: 42,
    surface_form: "memory compression",
    importance_weight: 0.75,
    relevance_tier: "LESS",
    archive_id: "",
    sentiment_tier: "NEUTRAL",
    last_seen: "2026-01-01T00:00:00.000Z",
    frequency_count: 5,
    source_weight: 1.0,
    agent_id: "main",
    node_type: "concept",
    observation_type: "discovery",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ColdStore
// ---------------------------------------------------------------------------

describe("ColdStore", () => {
  let dbPath: string;
  let cold: ColdStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    cold = new ColdStore(dbPath);
  });

  afterEach(() => {
    cold.close();
    rm(dbPath, { force: true }).catch(() => {});
    // WAL files
    rm(`${dbPath}-wal`, { force: true }).catch(() => {});
    rm(`${dbPath}-shm`, { force: true }).catch(() => {});
  });

  test("count() is 0 for empty store", () => {
    expect(cold.count()).toBe(0);
  });

  test("archive() + restore() round-trip preserves all fields", () => {
    const attrs = makeAttrs();
    cold.archive("node-42-ts", attrs);

    expect(cold.count()).toBe(1);
    const restored = cold.restore("node-42-ts") as AxonNodeAttrs;
    expect(restored.concept_id).toBe(42);
    expect(restored.surface_form).toBe("memory compression");
    expect(restored.importance_weight).toBe(0.75);
    expect(restored.observation_type).toBe("discovery");
  });

  test("restore() returns null for unknown archive_id", () => {
    expect(cold.restore("does-not-exist")).toBeNull();
  });

  test("archive() is idempotent — overwrites on second call", () => {
    const attrs = makeAttrs({ importance_weight: 0.5 });
    cold.archive("node-42-ts", attrs);

    const updated = makeAttrs({ importance_weight: 0.9 });
    cold.archive("node-42-ts", updated);

    expect(cold.count()).toBe(1);
    const row = cold.restore("node-42-ts") as AxonNodeAttrs;
    expect(row.importance_weight).toBe(0.9);
  });

  test("delete() removes the row and count decrements", () => {
    cold.archive("to-delete", makeAttrs());
    expect(cold.count()).toBe(1);
    cold.delete("to-delete");
    expect(cold.count()).toBe(0);
    expect(cold.restore("to-delete")).toBeNull();
  });

  test("delete() is a no-op for unknown archive_id", () => {
    cold.delete("phantom");
    expect(cold.count()).toBe(0);
  });

  test("multiple rows co-exist independently", () => {
    cold.archive("a", makeAttrs({ concept_id: 1, surface_form: "alpha" }));
    cold.archive("b", makeAttrs({ concept_id: 2, surface_form: "beta" }));
    cold.archive("c", makeAttrs({ concept_id: 3, surface_form: "gamma" }));

    expect(cold.count()).toBe(3);
    expect((cold.restore("b") as AxonNodeAttrs).surface_form).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// compressNode
// ---------------------------------------------------------------------------

describe("compressNode", () => {
  let dbPath: string;
  let cold: ColdStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    cold = new ColdStore(dbPath);
  });

  afterEach(() => {
    cold.close();
    rm(dbPath, { force: true }).catch(() => {});
    rm(`${dbPath}-wal`, { force: true }).catch(() => {});
    rm(`${dbPath}-shm`, { force: true }).catch(() => {});
  });

  test("returns a stub with SLEEPING tier and archive_id set", () => {
    const attrs = makeAttrs();
    const stub = compressNode("42", attrs, cold, 1000);

    expect(stub.relevance_tier).toBe("SLEEPING");
    expect(stub.archive_id).toBe("42_1000");
    expect(stub.importance_weight).toBe(0);
  });

  test("original attrs are preserved in cold storage", () => {
    const attrs = makeAttrs({ importance_weight: 0.75 });
    compressNode("42", attrs, cold, 1000);

    const archived = cold.restore("42_1000") as AxonNodeAttrs;
    expect(archived.importance_weight).toBe(0.75);
    expect(archived.surface_form).toBe("memory compression");
    expect(archived.relevance_tier).toBe("LESS"); // original, not "SLEEPING"
  });

  test("does not mutate input attrs", () => {
    const attrs = makeAttrs();
    compressNode("42", attrs, cold, 1000);

    expect(attrs.relevance_tier).toBe("LESS");
    expect(attrs.archive_id).toBe("");
  });

  test("stub preserves surface_form and concept_id", () => {
    const attrs = makeAttrs({ concept_id: 99, surface_form: "cold storage" });
    const stub = compressNode("99", attrs, cold, 2000);

    expect(stub.concept_id).toBe(99);
    expect(stub.surface_form).toBe("cold storage");
  });
});

// ---------------------------------------------------------------------------
// decompressNode
// ---------------------------------------------------------------------------

describe("decompressNode", () => {
  let dbPath: string;
  let cold: ColdStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    cold = new ColdStore(dbPath);
  });

  afterEach(() => {
    cold.close();
    rm(dbPath, { force: true }).catch(() => {});
    rm(`${dbPath}-wal`, { force: true }).catch(() => {});
    rm(`${dbPath}-shm`, { force: true }).catch(() => {});
  });

  test("restores full attrs from cold storage and deletes archive entry", () => {
    const attrs = makeAttrs({ importance_weight: 0.75 });
    const stub = compressNode("42", attrs, cold, 1000);

    const restored = decompressNode(stub, cold);
    expect(restored.importance_weight).toBe(0.75);
    expect(restored.relevance_tier).toBe("LESS");

    // Entry removed from cold storage after decompress
    expect(cold.count()).toBe(0);
  });

  test("fallback to LESS tier when archive is missing", () => {
    const stub = makeAttrs({
      relevance_tier: "SLEEPING",
      archive_id: "missing-archive",
      importance_weight: 0,
    });

    const restored = decompressNode(stub, cold);
    expect(restored.relevance_tier).toBe("LESS");
    expect(restored.archive_id).toBe("");
  });

  test("no-op for non-SLEEPING nodes", () => {
    const attrs = makeAttrs({ relevance_tier: "MILD" });
    const result = decompressNode(attrs, cold);
    expect(result).toEqual(attrs);
    expect(cold.count()).toBe(0);
  });

  test("no-op for SLEEPING node with empty archive_id", () => {
    const attrs = makeAttrs({ relevance_tier: "SLEEPING", archive_id: "" });
    const result = decompressNode(attrs, cold);
    expect(result).toEqual(attrs); // unchanged
  });

  test("round-trip: compress then decompress returns original attrs", () => {
    const original = makeAttrs({
      concept_id: 77,
      surface_form: "round-trip test",
      importance_weight: 0.6,
      frequency_count: 12,
      observation_type: "decision",
    });

    const stub = compressNode("77", original, cold, 5000);
    const restored = decompressNode(stub, cold);

    expect(restored.concept_id).toBe(77);
    expect(restored.surface_form).toBe("round-trip test");
    expect(restored.importance_weight).toBe(0.6);
    expect(restored.frequency_count).toBe(12);
    expect(restored.observation_type).toBe("decision");
    expect(restored.relevance_tier).toBe("LESS");
  });
});

// ---------------------------------------------------------------------------
// AxonStore.wakeNode integration
// ---------------------------------------------------------------------------

describe("AxonStore.wakeNode (Phase 9 integration)", () => {
  let dbPath: string;
  let cold: ColdStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    cold = new ColdStore(dbPath);
  });

  afterEach(() => {
    cold.close();
    rm(dbPath, { force: true }).catch(() => {});
    rm(`${dbPath}-wal`, { force: true }).catch(() => {});
    rm(`${dbPath}-shm`, { force: true }).catch(() => {});
  });

  test("wakeNode restores SLEEPING node to LESS tier", () => {
    const store = new AxonStore();
    store.openCold(dbPath);

    // Manually add a sleeping stub node
    const original = makeAttrs({ importance_weight: 0.65 });
    const stub = compressNode("42", original, cold, 9000);

    store.graph.addNode("42", stub);
    expect(store.graph.getNodeAttribute("42", "relevance_tier")).toBe("SLEEPING");

    store.wakeNode("42");

    const woken = store.graph.getNodeAttributes("42");
    expect(woken.relevance_tier).toBe("LESS");
    expect(woken.importance_weight).toBe(0.65);
    expect(woken.archive_id).toBe("");
  });

  test("wakeNode is a no-op on non-SLEEPING nodes", () => {
    const store = new AxonStore();
    store.openCold(dbPath);

    store.graph.addNode("10", makeAttrs({ concept_id: 10, relevance_tier: "ACTIVE" }));
    store.wakeNode("10");

    expect(store.graph.getNodeAttribute("10", "relevance_tier")).toBe("ACTIVE");
  });

  test("wakeNode is a no-op without cold storage open", () => {
    const store = new AxonStore(); // no openCold()
    const stub = makeAttrs({ relevance_tier: "SLEEPING", archive_id: "x_1" });
    store.graph.addNode("99", stub);
    store.wakeNode("99"); // should not throw
    expect(store.graph.getNodeAttribute("99", "relevance_tier")).toBe("SLEEPING");
  });
});
