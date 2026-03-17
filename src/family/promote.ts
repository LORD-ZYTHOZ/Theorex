// family/promote.ts — Promote concepts from a private agent axon to the shared web.
// Phase 6: AI Family Shared Layer
//
// Promotion criteria (either condition qualifies):
//   1. composite_score >= config.promotionThreshold (auto-promote by significance)
//   2. concept_id is in the explicit forceIds set (manual promotion)
//
// Conflict resolution: if a concept already exists in shared and the existing
// source_weight is higher than the incoming node, the existing record wins (skip).
//
// Edges are promoted only between pairs of concepts that BOTH qualify.

import { mkdir, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AxonStore } from "../axon/store";
import { compositeScore } from "../axon/scorer";
import { resolvedSharedAxonPath, agentAxonPath } from "./paths";
import type { Config } from "../config";
import type { NodeType } from "../types";

export interface PromoteResult {
  readonly agentId: string;
  readonly promoted: number;   // concepts merged into shared
  readonly edgesPromoted: number;
  readonly skipped: number;    // below threshold or source_weight conflict
}

/**
 * Promote qualifying concepts from an agent's private axon into the shared axon.
 * Returns counts of promoted and skipped concepts.
 */
export async function promoteToShared(
  agentId: string,
  config: Config,
  nowMs: number = Date.now(),
  forceIds?: ReadonlySet<number>,
): Promise<PromoteResult> {
  const privatePath = agentAxonPath(agentId, config.agentAxonDir);
  const sharedPath = resolvedSharedAxonPath(config.sharedAxonPath);

  const privateStore = await AxonStore.load(privatePath);
  privateStore.openCold(config.coldStorePath);
  await mkdir(dirname(sharedPath), { recursive: true });
  const sharedStore = await AxonStore.load(sharedPath);

  const threshold = config.promotionThreshold;
  let promoted = 0;
  let skipped = 0;
  const promotedIds = new Set<number>();

  for (const key of privateStore.graph.nodes()) {
    // Wake SLEEPING nodes so they can be scored and promoted (Phase 9 compat)
    privateStore.wakeNode(key);

    const attrs = privateStore.graph.getNodeAttributes(key);

    const neighborStrengths = privateStore.graph
      .neighbors(key)
      .map((nbr) => {
        const edgeKey = privateStore.graph.edge(key, nbr);
        return edgeKey ? privateStore.graph.getEdgeAttributes(edgeKey).strength : 0;
      });

    const score = compositeScore(
      attrs.last_seen,
      attrs.frequency_count,
      neighborStrengths,
      nowMs,
      config,
    );

    const qualifies = score >= threshold || forceIds?.has(attrs.concept_id);
    if (!qualifies) {
      skipped++;
      continue;
    }

    // Conflict resolution: merge frequency and take latest timestamp; higher source_weight wins for weight field
    const sharedKey = String(attrs.concept_id);
    if (sharedStore.graph.hasNode(sharedKey)) {
      const existing = sharedStore.graph.getNodeAttributes(sharedKey);
      if (existing.source_weight > attrs.source_weight) {
        // Merge frequency and recency into the existing node instead of skipping
        const merged_freq = existing.frequency_count + attrs.frequency_count;
        const merged_last = existing.last_seen > attrs.last_seen ? existing.last_seen : attrs.last_seen;
        sharedStore.graph.setNodeAttribute(sharedKey, "frequency_count", merged_freq);
        sharedStore.graph.setNodeAttribute(sharedKey, "last_seen", merged_last);
        promotedIds.add(attrs.concept_id);
        promoted++;
        continue;
      }
    }

    // Promote node (reuse mergeNode with a synthetic ConceptEvent)
    sharedStore.mergeNode(
      {
        concept_id: attrs.concept_id,
        surface_form: attrs.surface_form,
        importance_score: attrs.importance_weight,
        frequency_count: attrs.frequency_count,
        composite_score: score,
        source_weight: attrs.source_weight,
        node_type: (attrs.node_type || "concept") as NodeType,
        timestamp: new Date(nowMs).toISOString(),
      },
      agentId,
    );

    promotedIds.add(attrs.concept_id);
    promoted++;
  }

  // Promote edges between pairs of promoted concepts
  let edgesPromoted = 0;
  const promotedArr = [...promotedIds];
  for (let i = 0; i < promotedArr.length; i++) {
    for (let j = i + 1; j < promotedArr.length; j++) {
      const idA = promotedArr[i]!;
      const idB = promotedArr[j]!;
      // Only promote edge if it existed in the private store
      const privateEdge = privateStore.graph.edge(String(idA), String(idB));
      if (privateEdge !== undefined) {
        const edgeAttrs = privateStore.graph.getEdgeAttributes(privateEdge);
        sharedStore.mergeEdge(idA, idB, edgeAttrs.last_co_occurrence);
        edgesPromoted++;
      }
    }
  }

  // Rotate backup before overwriting shared axon (ARCH-002)
  await copyFile(sharedPath, sharedPath + ".bak").catch(() => {});

  await sharedStore.save(sharedPath);

  return { agentId, promoted, edgesPromoted, skipped };
}
