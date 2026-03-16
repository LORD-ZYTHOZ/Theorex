// decompress.ts — Wake a SLEEPING node from cold storage (Phase 9).
//
// INVARIANTS:
//   - Deletes from cold storage after successful restore (no duplicates)
//   - If archive is missing (data loss), falls back to LESS tier gracefully
//   - Caller must write the returned attrs back to the graph via setNodeAttributes

import type { AxonNodeAttrs } from "./store";
import type { ColdStore } from "./cold";

/**
 * Restore a SLEEPING node's full attrs from cold storage.
 * Removes the archive entry on success.
 * Falls back to LESS tier if archive is missing.
 */
export function decompressNode(
  stub: AxonNodeAttrs,
  cold: ColdStore,
): AxonNodeAttrs {
  if (stub.relevance_tier !== "SLEEPING" || !stub.archive_id) {
    return stub;
  }

  const archived = cold.restore(stub.archive_id);

  if (!archived) {
    // Archive missing — surface as LESS tier, clear stub fields
    return { ...stub, relevance_tier: "LESS", archive_id: "" };
  }

  cold.delete(stub.archive_id);
  return archived as AxonNodeAttrs;
}
