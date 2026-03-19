// vaults/promote.ts — Phase 23: Multi-Vault Shared Memory
// Promote concepts from an agent's private axon into a named vault.
//
// Reuses the same promotion logic as family/promote.ts but:
//   1. Targets a specific vault path (not the global shared-axon)
//   2. Applies the vault's domain filter before promoting
//   3. Enforces vault membership (agent must be in vault.members)

import { mkdir, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AxonStore } from "../axon/store";
import { compositeScore } from "../axon/scorer";
import { agentAxonPath } from "../family/paths";
import { canWrite, passesDomainFilter } from "./registry";
import type { VaultConfig } from "./registry";
import type { Config } from "../config";
import type { NodeType } from "../types";

export interface VaultPromoteResult {
  readonly agentId: string;
  readonly vaultName: string;
  readonly promoted: number;
  readonly edgesPromoted: number;
  readonly skipped: number;       // below threshold
  readonly filtered: number;      // blocked by domain filter
  readonly denied: boolean;       // agent not a vault member
}

/**
 * Promote qualifying concepts from an agent's private axon into a named vault.
 *
 * Promotion requires ALL of:
 *   - agent is in vault.members
 *   - composite_score >= config.promotionThreshold (or forceIds supplied)
 *   - surface_form passes vault domain filter (or vault.domains is empty)
 */
export async function promoteToVault(
  agentId: string,
  vault: VaultConfig,
  config: Config,
  nowMs: number = Date.now(),
  forceIds?: ReadonlySet<number>,
): Promise<VaultPromoteResult> {
  const denied = !canWrite(agentId, vault);
  if (denied) {
    return {
      agentId,
      vaultName: vault.name,
      promoted: 0,
      edgesPromoted: 0,
      skipped: 0,
      filtered: 0,
      denied: true,
    };
  }

  const privatePath = agentAxonPath(agentId, config.agentAxonDir);
  const vaultPath = vault.path;

  const privateStore = await AxonStore.load(privatePath);
  privateStore.openCold(config.coldStorePath);
  await mkdir(dirname(vaultPath), { recursive: true });
  const vaultStore = await AxonStore.load(vaultPath);

  const threshold = config.promotionThreshold;
  let promoted = 0;
  let skipped = 0;
  let filtered = 0;
  const promotedIds = new Set<number>();

  for (const key of privateStore.graph.nodes()) {
    privateStore.wakeNode(key);

    const attrs = privateStore.graph.getNodeAttributes(key);

    // Domain filter — skip if surface_form doesn't match vault domains
    if (!passesDomainFilter(attrs.surface_form, vault)) {
      filtered++;
      continue;
    }

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

    // Conflict resolution: higher source_weight wins, but merge frequency
    const sharedKey = String(attrs.concept_id);
    if (vaultStore.graph.hasNode(sharedKey)) {
      const existing = vaultStore.graph.getNodeAttributes(sharedKey);
      if (existing.source_weight > attrs.source_weight) {
        const merged_freq = existing.frequency_count + attrs.frequency_count;
        const merged_last = existing.last_seen > attrs.last_seen ? existing.last_seen : attrs.last_seen;
        vaultStore.graph.setNodeAttribute(sharedKey, "frequency_count", merged_freq);
        vaultStore.graph.setNodeAttribute(sharedKey, "last_seen", merged_last);
        skipped++;
        continue;
      }
    }

    vaultStore.mergeNode(
      {
        concept_id: attrs.concept_id,
        surface_form: attrs.surface_form,
        importance_score: attrs.importance_weight,
        frequency_count: attrs.frequency_count,
        composite_score: score,
        source_weight: attrs.source_weight,
        node_type: (attrs.node_type || "concept") as NodeType,
        timestamp: attrs.last_seen,
      },
      agentId,
      attrs.observation_type || "",
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
      const privateEdge = privateStore.graph.edge(String(idA), String(idB));
      if (privateEdge !== undefined) {
        const edgeAttrs = privateStore.graph.getEdgeAttributes(privateEdge);
        vaultStore.mergeEdge(idA, idB, edgeAttrs.last_co_occurrence);
        edgesPromoted++;
      }
    }
  }

  // Backup then save
  await copyFile(vaultPath, vaultPath + ".bak").catch(() => {});
  await vaultStore.save(vaultPath);
  if (privateStore.cold) privateStore.cold.close();

  return {
    agentId,
    vaultName: vault.name,
    promoted,
    edgesPromoted,
    skipped,
    filtered,
    denied: false,
  };
}
