// dissolution.ts — Seeded edge lifecycle management.
// Seeded edges that never receive co-occurrence confirmation dissolve within
// ragSeedDissolutionDays (default: 7) — faster than organic edge decay (14-day half-life).
//
// INVARIANTS:
//   - Only affects edges where seeded === true
//   - Co-occurrence-confirmed edges (co_occurrence_count > 0) are NEVER dissolved here
//   - Organic edges (seeded: false) are NEVER touched
//   - Follows Phase 1 Graphology safety pattern: collect keys BEFORE mutation

import type { AxonStore, AxonEdgeAttrs } from "../axon/store";
import type { Config } from "../config";

/**
 * Pure predicate. Returns true if the seeded edge should be dissolved now.
 * Exported for direct unit testing.
 */
export function shouldDissolveSeeded(
  edge: AxonEdgeAttrs,
  nowMs: number,
  seedDissolutionDays: number,
): boolean {
  // Only dissolve seeded edges with zero co-occurrence confirmation
  if (!edge.seeded || edge.co_occurrence_count > 0) return false;
  if (!edge.seed_created_at) return false; // safety: malformed edge

  const ageMs = nowMs - new Date(edge.seed_created_at).getTime();
  return ageMs > seedDissolutionDays * 86_400_000;
}

/**
 * Scan all edges in the graph and drop unreinforced seeded edges past the dissolution window.
 * Called from scanAxon after the existing edge decay pass.
 *
 * Phase 1 pattern: collect edge keys BEFORE mutation loop.
 */
export function dissolveSeededEdges(
  store: AxonStore,
  config: Config,
  nowMs: number,
): void {
  // Collect ALL edge keys before any mutation (graphology safety)
  const edgeKeys = store.graph.edges();

  for (const key of edgeKeys) {
    const attrs = store.graph.getEdgeAttributes(key);
    if (shouldDissolveSeeded(attrs, nowMs, config.ragSeedDissolutionDays)) {
      store.graph.dropEdge(key);
    }
  }
}
