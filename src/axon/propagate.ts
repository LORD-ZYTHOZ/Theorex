// propagate.ts — One-hop activation and sentiment propagation on the AxonStore graph.
// CRITICAL: Always collect neighbors BEFORE mutating — never forEachNeighbor with mutations.
// Strictly one-hop only — second-hop nodes are never touched.

import type { AxonStore } from "./store";
import { appendAuditEvent } from "../audit/logger";

/**
 * Activate a node: increment frequency_count, update last_seen,
 * and spread activationDelta × 0.5 to direct neighbors (one hop only).
 * Neighbor importance_weight is clamped to 1.0.
 */
export function propagateActivation(
  store: AxonStore,
  nodeKey: string,
  activationDelta: number,
  nowMs: number,
): void {
  const g = store.graph;

  g.updateNodeAttribute(nodeKey, "frequency_count", (n) => (n ?? 0) + 1);
  g.updateNodeAttribute(nodeKey, "last_seen", () => new Date(nowMs).toISOString());

  // Collect BEFORE mutating — mutation during forEachNeighbor is unsafe
  const neighbors = g.neighbors(nodeKey);
  const dampened = activationDelta * 0.5;

  for (const neighbor of neighbors) {
    g.updateNodeAttribute(neighbor, "importance_weight", (w) =>
      Math.min(1.0, (w ?? 0) + dampened),
    );
  }
  // Strictly one hop — no further iteration
}

/**
 * Set sentiment_tier on the target node and nudge neighbor importance_weight
 * by ±0.05 (clamped 0.0–1.0). Neighbor sentiment_tier is never changed.
 */
export function propagateSentiment(
  store: AxonStore,
  nodeKey: string,
  sentiment: "PREFERRED" | "DISPREFERRED",
  _nowMs: number,
): void {
  const g = store.graph;

  const oldSentiment = g.getNodeAttributes(nodeKey).sentiment_tier;
  g.setNodeAttribute(nodeKey, "sentiment_tier", sentiment);

  if (sentiment !== oldSentiment) {
    const attrs = g.getNodeAttributes(nodeKey);
    void appendAuditEvent({
      type: "sentiment_flip",
      timestamp: new Date(Date.now()).toISOString(),
      source: "cli",
      concept_id: attrs.concept_id,
      surface_form: attrs.surface_form,
      from: oldSentiment as "PREFERRED" | "NEUTRAL" | "DISPREFERRED",
      to: sentiment,
    }).catch(() => {});
  }

  // Collect BEFORE mutating
  const neighbors = g.neighbors(nodeKey);
  const nudge = sentiment === "PREFERRED" ? 0.05 : -0.05;

  for (const neighbor of neighbors) {
    g.updateNodeAttribute(neighbor, "importance_weight", (w) =>
      Math.min(1.0, Math.max(0.0, (w ?? 0) + nudge)),
    );
    // NOTE: neighbor's sentiment_tier is intentionally NOT changed here
  }
}
