import { test, expect } from "bun:test";
import { AxonStore } from "../../src/axon/store";
import { propagateActivation, propagateSentiment } from "../../src/axon/propagate";
import type { ConceptEvent } from "../../src/types";

const NOW_MS = 1_700_000_000_000;

function makeEvent(id: number, overrides?: Partial<ConceptEvent>): ConceptEvent {
  return {
    concept_id: id,
    surface_form: `concept_${id}`,
    importance_score: 0.5,
    composite_score: 0.5,
    frequency_count: 1,
    timestamp: new Date(NOW_MS).toISOString(),
    source_weight: 1.0,
    node_type: "concept",
    ...overrides,
  };
}

function buildStore(...ids: number[]): { store: AxonStore; keys: string[] } {
  const store = new AxonStore();
  const keys: string[] = [];
  for (const id of ids) {
    keys.push(store.mergeNode(makeEvent(id)));
  }
  return { store, keys };
}

// ─── propagateActivation ──────────────────────────────────────────────────────

test("propagateActivation increments activated node frequency_count by 1", () => {
  const { store, keys } = buildStore(1);
  const [keyA] = keys;
  const before = store.graph.getNodeAttribute(keyA, "frequency_count");
  propagateActivation(store, keyA, 0.4, NOW_MS);
  const after = store.graph.getNodeAttribute(keyA, "frequency_count");
  expect(after).toBe(before + 1);
});

test("propagateActivation updates activated node last_seen to nowMs", () => {
  const { store, keys } = buildStore(1);
  const [keyA] = keys;
  const laterMs = NOW_MS + 5000;
  propagateActivation(store, keyA, 0.4, laterMs);
  const lastSeen = store.graph.getNodeAttribute(keyA, "last_seen");
  expect(lastSeen).toBe(new Date(laterMs).toISOString());
});

test("propagateActivation increases neighbor importance_weight by activationDelta × 0.5", () => {
  const { store, keys } = buildStore(1, 2);
  const [keyA, keyB] = keys;
  store.mergeEdge(1, 2, new Date(NOW_MS).toISOString());
  const before = store.graph.getNodeAttribute(keyB, "importance_weight");
  propagateActivation(store, keyA, 0.4, NOW_MS);
  const after = store.graph.getNodeAttribute(keyB, "importance_weight");
  expect(after).toBeCloseTo(before + 0.4 * 0.5, 6);
});

test("propagateActivation clamps neighbor importance_weight at 1.0", () => {
  const store = new AxonStore();
  // B already near max
  store.mergeNode(makeEvent(1));
  store.mergeNode(makeEvent(2, { importance_score: 0.9 }));
  store.mergeEdge(1, 2, new Date(NOW_MS).toISOString());
  propagateActivation(store, "1", 1.0, NOW_MS);
  const weight = store.graph.getNodeAttribute("2", "importance_weight");
  expect(weight).toBeLessThanOrEqual(1.0);
});

test("second-hop nodes are untouched after propagateActivation", () => {
  // Chain: A → B → C; activate A; C must be unchanged
  const { store, keys } = buildStore(1, 2, 3);
  const [keyA, , keyC] = keys;
  store.mergeEdge(1, 2, new Date(NOW_MS).toISOString());
  store.mergeEdge(2, 3, new Date(NOW_MS).toISOString());
  const cBefore = store.graph.getNodeAttribute(keyC, "importance_weight");
  propagateActivation(store, keyA, 0.4, NOW_MS);
  const cAfter = store.graph.getNodeAttribute(keyC, "importance_weight");
  expect(cAfter).toBe(cBefore);
});

// ─── propagateSentiment ───────────────────────────────────────────────────────

test("propagateSentiment sets PREFERRED sentiment_tier on target node", () => {
  const { store, keys } = buildStore(1);
  const [keyA] = keys;
  propagateSentiment(store, keyA, "PREFERRED", NOW_MS);
  expect(store.graph.getNodeAttribute(keyA, "sentiment_tier")).toBe("PREFERRED");
});

test("propagateSentiment DISPREFERRED nudges neighbor importance_weight down by 0.05", () => {
  const { store, keys } = buildStore(1, 2);
  const [keyA, keyB] = keys;
  store.mergeEdge(1, 2, new Date(NOW_MS).toISOString());
  const before = store.graph.getNodeAttribute(keyB, "importance_weight");
  propagateSentiment(store, keyA, "DISPREFERRED", NOW_MS);
  const after = store.graph.getNodeAttribute(keyB, "importance_weight");
  expect(after).toBeCloseTo(before - 0.05, 6);
});

test("neighbor sentiment_tier is NOT changed by propagateSentiment", () => {
  const { store, keys } = buildStore(1, 2);
  const [keyA, keyB] = keys;
  store.mergeEdge(1, 2, new Date(NOW_MS).toISOString());
  const sentBefore = store.graph.getNodeAttribute(keyB, "sentiment_tier");
  propagateSentiment(store, keyA, "PREFERRED", NOW_MS);
  const sentAfter = store.graph.getNodeAttribute(keyB, "sentiment_tier");
  expect(sentAfter).toBe(sentBefore);
});

test("a node can have relevance_tier ACTIVE and sentiment_tier DISPREFERRED simultaneously (SNT-04)", () => {
  const { store, keys } = buildStore(1);
  const [keyA] = keys;
  store.graph.setNodeAttribute(keyA, "relevance_tier", "ACTIVE");
  propagateSentiment(store, keyA, "DISPREFERRED", NOW_MS);
  expect(store.graph.getNodeAttribute(keyA, "relevance_tier")).toBe("ACTIVE");
  expect(store.graph.getNodeAttribute(keyA, "sentiment_tier")).toBe("DISPREFERRED");
});
