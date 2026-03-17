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
import { compressNode } from "./compress";

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

  // Phase 9: Open cold storage if configured
  if (config.coldStorePath) {
    store.openCold(config.coldStorePath);
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

    // Phase 9: skip sleeping nodes — they are archived, not subject to rescoring
    if (attrs.relevance_tier === "SLEEPING") continue;

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

  // ── Phase 9: Compress old LESS nodes into cold storage ─────────────────────
  if (store.cold && config.compressAfterDays > 0) {
    const compressThresholdMs = config.compressAfterDays * 86_400_000;

    for (const key of nodeKeys) {
      const attrs = store.graph.getNodeAttributes(key);
      if (attrs.relevance_tier !== "LESS") continue;

      const ageSinceLastSeen = nowMs - new Date(attrs.last_seen).getTime();
      if (ageSinceLastSeen < compressThresholdMs) continue;

      const stub = compressNode(key, attrs, store.cold, nowMs);
      for (const [attr, val] of Object.entries(stub) as [keyof typeof stub, (typeof stub)[keyof typeof stub]][]) {
        store.graph.setNodeAttribute(key, attr, val);
      }

      void appendAuditEvent({
        type: "tier_change",
        timestamp: new Date(nowMs).toISOString(),
        source: "scan",
        concept_id: attrs.concept_id,
        surface_form: attrs.surface_form,
        from: "LESS",
        to: "SLEEPING",
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
  if (store.cold) store.cold.close();
}
