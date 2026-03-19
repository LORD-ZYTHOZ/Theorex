// vaults/query.ts — Phase 23: Multi-Vault Shared Memory
// Read top concepts from a named vault, and merge multiple vaults into a unified view.

import { AxonStore } from "../axon/store";
import { compositeScore, classifyTier } from "../axon/scorer";
import type { AxonNodeAttrs } from "../axon/store";
import type { VaultConfig } from "./registry";
import type { Config } from "../config";

export interface VaultConcept {
  readonly concept_id: number;
  readonly surface_form: string;
  readonly relevance_tier: string;
  readonly importance_weight: number;
  readonly frequency_count: number;
  readonly agent_id: string;
  readonly score: number;
  readonly vault_name: string;
}

/**
 * Load a vault's axon and return the top N active concepts sorted by composite score.
 * Returns empty array if vault axon doesn't exist yet.
 */
export async function queryVault(
  vault: VaultConfig,
  config: Config,
  topN: number = 20,
  nowMs: number = Date.now(),
): Promise<readonly VaultConcept[]> {
  let store: AxonStore;
  try {
    store = await AxonStore.load(vault.path);
  } catch {
    return [];
  }

  if (store.graph.order === 0) return [];

  const concepts: VaultConcept[] = [];

  for (const key of store.graph.nodes()) {
    const attrs = store.graph.getNodeAttributes(key) as AxonNodeAttrs;
    if (attrs.relevance_tier === "SLEEPING") continue;

    const neighborStrengths = store.graph
      .neighbors(key)
      .map((nbr) => {
        const edgeKey = store.graph.edge(key, nbr);
        return edgeKey ? store.graph.getEdgeAttributes(edgeKey).strength : 0;
      });

    const score = compositeScore(
      attrs.last_seen,
      attrs.frequency_count,
      neighborStrengths,
      nowMs,
      config,
    );

    concepts.push({
      concept_id: attrs.concept_id,
      surface_form: attrs.surface_form,
      relevance_tier: classifyTier(score, config),
      importance_weight: attrs.importance_weight,
      frequency_count: attrs.frequency_count,
      agent_id: attrs.agent_id ?? "",
      score,
      vault_name: vault.name,
    });
  }

  concepts.sort((a, b) => b.score - a.score);
  return concepts.slice(0, topN);
}

/**
 * Merge multiple vaults into a unified ranked concept list.
 * Concepts appearing in multiple vaults are merged by:
 *   - taking the max score
 *   - concatenating agent_ids (deduped)
 *   - keeping the higher frequency_count
 */
export async function mergeVaults(
  vaults: readonly VaultConfig[],
  config: Config,
  topN: number = 30,
  nowMs: number = Date.now(),
): Promise<readonly VaultConcept[]> {
  const results = await Promise.allSettled(
    vaults.map((v) => queryVault(v, config, 100, nowMs)),
  );

  // Union by concept_id, keeping best score
  const byId = new Map<number, VaultConcept>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const concept of result.value) {
      const existing = byId.get(concept.concept_id);
      if (!existing || concept.score > existing.score) {
        const mergedAgentId = existing
          ? [...new Set([existing.agent_id, concept.agent_id].flatMap((s) => s.split(",").filter(Boolean)))].join(",")
          : concept.agent_id;
        byId.set(concept.concept_id, {
          ...concept,
          agent_id: mergedAgentId,
          frequency_count: Math.max(existing?.frequency_count ?? 0, concept.frequency_count),
          vault_name: existing
            ? `${existing.vault_name},${concept.vault_name}`
            : concept.vault_name,
        });
      }
    }
  }

  const merged = [...byId.values()];
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topN);
}
