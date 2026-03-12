import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { AxonStore } from "../../src/axon/store";
import type { ConceptEvent } from "../../src/types";
import { unlink } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DB_PATH = "/tmp/theorex-test-axon.json";

function makeEvent(overrides: Partial<ConceptEvent> = {}): ConceptEvent {
  return {
    concept_id: 42,
    surface_form: "machine learning",
    importance_score: 1.0,
    frequency_count: 3,
    composite_score: 3.302,
    source_weight: 1.0,
    node_type: "concept",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AxonStore", () => {
  afterEach(async () => {
    // Clean up temp test file
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // ignore ENOENT
    }
  });

  test("empty store has 0 nodes and 0 edges", () => {
    const store = new AxonStore();
    expect(store.graph.order).toBe(0); // nodes
    expect(store.graph.size).toBe(0);  // edges
  });

  test("mergeNode with ConceptEvent creates node with correct attrs", () => {
    const store = new AxonStore();
    const event = makeEvent();
    const key = store.mergeNode(event);

    expect(store.graph.order).toBe(1);
    const attrs = store.graph.getNodeAttributes(key);
    expect(attrs.concept_id).toBe(42);
    expect(attrs.surface_form).toBe("machine learning");
    expect(attrs.importance_weight).toBe(1.0);
    expect(attrs.frequency_count).toBe(3);
    expect(attrs.source_weight).toBe(1.0);
    expect(attrs.last_seen).toBe("2026-01-01T00:00:00Z");
    expect(attrs.sentiment_tier).toBe("NEUTRAL");
    expect(attrs.relevance_tier).toBe("ACTIVE");
  });

  test("mergeNode returns String(concept_id) as node key", () => {
    const store = new AxonStore();
    const event = makeEvent({ concept_id: 99 });
    const key = store.mergeNode(event);
    expect(key).toBe("99");
    expect(typeof key).toBe("string");
  });

  test("mergeNode on existing node increments frequency_count and updates last_seen", () => {
    const store = new AxonStore();
    const event1 = makeEvent({ frequency_count: 3, timestamp: "2026-01-01T00:00:00Z" });
    store.mergeNode(event1);

    const event2 = makeEvent({ frequency_count: 2, timestamp: "2026-06-01T00:00:00Z" });
    store.mergeNode(event2);

    expect(store.graph.order).toBe(1); // still 1 node
    const attrs = store.graph.getNodeAttributes("42");
    expect(attrs.frequency_count).toBe(5); // 3 + 2
    expect(attrs.last_seen).toBe("2026-06-01T00:00:00Z");
    expect(attrs.sentiment_tier).toBe("NEUTRAL"); // unchanged
    expect(attrs.relevance_tier).toBe("ACTIVE");  // unchanged
  });

  test("mergeEdge creates edge with strength 0.1, co_occurrence_count 1 on first call", () => {
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 1 }));
    store.mergeNode(makeEvent({ concept_id: 2 }));

    store.mergeEdge(1, 2, "2026-01-01T00:00:00Z");

    expect(store.graph.size).toBe(1);
    const edgeKey = store.graph.edge("1", "2");
    const attrs = store.graph.getEdgeAttributes(edgeKey!);
    expect(attrs.strength).toBeCloseTo(0.1);
    expect(attrs.co_occurrence_count).toBe(1);
    expect(attrs.last_co_occurrence).toBe("2026-01-01T00:00:00Z");
  });

  test("mergeEdge second call increments co_occurrence_count and increases strength", () => {
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 1 }));
    store.mergeNode(makeEvent({ concept_id: 2 }));

    store.mergeEdge(1, 2, "2026-01-01T00:00:00Z");
    store.mergeEdge(1, 2, "2026-06-01T00:00:00Z");

    expect(store.graph.size).toBe(1); // still 1 edge
    const edgeKey = store.graph.edge("1", "2");
    const attrs = store.graph.getEdgeAttributes(edgeKey!);
    expect(attrs.strength).toBeCloseTo(0.15); // 0.1 + 0.05
    expect(attrs.co_occurrence_count).toBe(2);
    expect(attrs.last_co_occurrence).toBe("2026-06-01T00:00:00Z");
  });

  test("mergeEdge clamps strength at 1.0 after many calls", () => {
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 1 }));
    store.mergeNode(makeEvent({ concept_id: 2 }));

    // 1 initial call = 0.1; then 19 more at +0.05 each = 0.1 + 0.95 = 1.05 → clamped to 1.0
    for (let i = 0; i < 20; i++) {
      store.mergeEdge(1, 2, "2026-01-01T00:00:00Z");
    }

    const edgeKey = store.graph.edge("1", "2");
    const attrs = store.graph.getEdgeAttributes(edgeKey!);
    expect(attrs.strength).toBe(1.0);
    expect(attrs.strength).toBeLessThanOrEqual(1.0);
  });

  test("save + load round-trip preserves node count and all node attributes", async () => {
    const store = new AxonStore();
    const event = makeEvent({
      concept_id: 7,
      surface_form: "neural network",
      importance_score: 0.9,
      frequency_count: 5,
      source_weight: 0.8,
      timestamp: "2026-03-01T12:00:00Z",
    });
    store.mergeNode(event);
    store.mergeNode(makeEvent({ concept_id: 8 }));

    await store.save(TEST_DB_PATH);
    const loaded = await AxonStore.load(TEST_DB_PATH);

    expect(loaded.graph.order).toBe(2);
    const attrs = loaded.graph.getNodeAttributes("7");
    expect(attrs.concept_id).toBe(7);
    expect(attrs.surface_form).toBe("neural network");
    expect(attrs.importance_weight).toBe(0.9);
    expect(attrs.frequency_count).toBe(5);
    expect(attrs.source_weight).toBe(0.8);
    expect(attrs.last_seen).toBe("2026-03-01T12:00:00Z");
    expect(attrs.sentiment_tier).toBe("NEUTRAL");
    expect(attrs.relevance_tier).toBe("ACTIVE");
  });

  test("load from non-existent path returns empty store without throwing", async () => {
    const store = await AxonStore.load("/tmp/theorex-does-not-exist-12345.json");
    expect(store.graph.order).toBe(0);
    expect(store.graph.size).toBe(0);
  });

  test("graph.hasNode(String(concept_id)) is true after mergeNode with numeric concept_id", () => {
    const store = new AxonStore();
    store.mergeNode(makeEvent({ concept_id: 123 }));
    // Key is stored as string "123"
    expect(store.graph.hasNode("123")).toBe(true);
    // Node key must be a string — verify the actual stored key type
    const keys = store.graph.nodes();
    expect(keys[0]).toBe("123");
    expect(typeof keys[0]).toBe("string");
  });
});
