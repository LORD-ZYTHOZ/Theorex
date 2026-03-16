// compress.ts — Archive a live axon node to cold storage and return a stub (Phase 9).
//
// INVARIANTS:
//   - Does NOT mutate the graph — caller must setNodeAttribute() with the returned stub
//   - archive_id format: "{nodeKey}_{timestamp_ms}" — unique per compression event
//   - Returning a stub with relevance_tier: "SLEEPING" signals the node is archived

import type { AxonNodeAttrs } from "./store";
import type { ColdStore } from "./cold";

/**
 * Archive full node attrs to cold storage and return a lightweight stub.
 * Caller is responsible for writing the stub back to the graph.
 */
export function compressNode(
  nodeKey: string,
  attrs: AxonNodeAttrs,
  cold: ColdStore,
  nowMs: number = Date.now(),
): AxonNodeAttrs {
  const archiveId = `${nodeKey}_${nowMs}`;
  cold.archive(archiveId, attrs);

  return {
    ...attrs,
    relevance_tier: "SLEEPING",
    archive_id: archiveId,
    importance_weight: 0,
  };
}
