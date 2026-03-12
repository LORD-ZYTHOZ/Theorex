// scan.ts — Re-score all nodes and decay edges in the axon graph.
// Called by the `theorex scan` CLI command (PM2 cron: every 6 hours).
//
// INVARIANTS:
//   - Does NOT touch MEMORY.md — axon.json only
//   - Collects node/edge keys BEFORE mutation (safe iteration pattern)
//   - Writes axon.json atomically via store.save()

import { AxonStore } from "./store";
import { compositeScore, classifyTier } from "./scorer";
import type { Config } from "../config";
import { dissolveSeededEdges } from "../rag/dissolution";
import { appendAuditEvent } from "../audit/logger";

/**
 * Re-score all nodes with compositeScore, update relevance_tier on every node.
 * Apply exponential decay to edge strengths; drop edges below edgePruneThreshold.
 * Write updated graph atomically to axonPath.
 *
 * Returns early without error if axonPath does not exist (cold start).
 */
export async function scanAxon(
  axonPath: string,
  config: Config,
  nowMs: number = Date.now(),
): Promise<void> {
  const store = await AxonStore.load(axonPath);

  // Cold start: nothing to scan
  if (store.graph.order === 0) {
    return;
  }

  const scoringConfig = {
    halfLifeDays: config.halfLifeDays,
    activeThreshold: config.activeThreshold,
    mildThreshold: config.mildThreshold,
  };

  // ── Node rescoring ─────────────────────────────────────────────────────────
  // Collect node keys BEFORE mutation to avoid issues during iteration
  const nodeKeys = store.graph.nodes();

  for (const key of nodeKeys) {
    const attrs = store.graph.getNodeAttributes(key);
    const oldTier = attrs.relevance_tier;

    // Gather neighbor edge strengths for co-occurrence score
    const neighborStrengths: number[] = [];
    store.graph.forEachNeighbor(key, (neighborKey, _neighborAttrs) => {
      const edgeKey = store.graph.edge(key, neighborKey);
      if (edgeKey !== undefined) {
        const edgeAttrs = store.graph.getEdgeAttributes(edgeKey);
        neighborStrengths.push(edgeAttrs.strength);
      }
    });

    const score = compositeScore(
      attrs.last_seen,
      attrs.frequency_count,
      neighborStrengths,
      nowMs,
      scoringConfig,
    );

    const tier = classifyTier(score, scoringConfig);

    store.graph.setNodeAttribute(key, "importance_weight", score);
    store.graph.setNodeAttribute(key, "relevance_tier", tier);

    if (tier !== oldTier) {
      void appendAuditEvent({
        type: "tier_change",
        timestamp: new Date(nowMs).toISOString(),
        source: "scan",
        concept_id: attrs.concept_id,
        surface_form: attrs.surface_form,
        from: oldTier,
        to: tier,
      }, config.eventsPath ?? "data/events.jsonl").catch(() => {});
    }
  }

  // ── Edge decay ─────────────────────────────────────────────────────────────
  // Collect edge keys BEFORE mutation to avoid modifying graph during iteration
  const edgeKeys = store.graph.edges();
  const edgesToDrop: string[] = [];

  for (const edgeKey of edgeKeys) {
    const edgeAttrs = store.graph.getEdgeAttributes(edgeKey);
    const daysSince =
      (nowMs - new Date(edgeAttrs.last_co_occurrence).getTime()) / 86_400_000;
    const newStrength =
      edgeAttrs.strength *
      Math.exp((-Math.LN2 / config.halfLifeDays) * daysSince);

    if (newStrength < config.edgePruneThreshold) {
      edgesToDrop.push(edgeKey);
    } else {
      store.graph.setEdgeAttribute(edgeKey, "strength", newStrength);
    }
  }

  for (const edgeKey of edgesToDrop) {
    store.graph.dropEdge(edgeKey);
  }

  // ── Phase 4: dissolve unreinforced seeded edges (RAG-03) ───────────────────
  dissolveSeededEdges(store, config, nowMs);

  // ── Atomic write ───────────────────────────────────────────────────────────
  await store.save(axonPath);
}
