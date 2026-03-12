// prune.ts — Archive LESS-tier nodes past the prune threshold and drop them from the graph.
// Called by the `theorex prune` CLI command.
//
// INVARIANTS:
//   - Archive is written BEFORE any node is dropped — data is never silently lost (LTM-05)
//   - archiveDir is created recursively if missing (mkdir -p)
//   - Writes axon.json atomically via store.save()

import { AxonStore } from "./store";
import type { AxonNodeAttrs } from "./store";
import type { Config } from "../config";
import { mkdir } from "node:fs/promises";
import { deleteEmbedding } from "../rag/embedding-store";
import { appendAuditEvent } from "../audit/logger";

// ---------------------------------------------------------------------------
// Archive record shape
// ---------------------------------------------------------------------------

interface ArchiveRecord {
  archived_at: string;
  concept_id: number;
  surface_form: string;
  importance_weight: number;
  last_seen: string;
  frequency_count: number;
  source_weight: number;
  relevance_tier: "LESS";
  sentiment_tier: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
}

// ---------------------------------------------------------------------------
// pruneAxon
// ---------------------------------------------------------------------------

/**
 * Identify LESS-tier nodes past config.pruneThresholdDays.
 * Write them to archiveDir/pruned-{timestamp}.jsonl BEFORE dropping from graph.
 * Then drop each node and save axon.json atomically.
 */
export async function pruneAxon(
  axonPath: string,
  archiveDir: string,
  config: Config,
  nowMs: number = Date.now(),
): Promise<void> {
  const store = await AxonStore.load(axonPath);

  if (store.graph.order === 0) {
    return;
  }

  const thresholdMs = config.pruneThresholdDays * 86_400_000;

  // Identify nodes eligible for pruning
  const candidates: Array<{ key: string; attrs: AxonNodeAttrs }> = [];

  store.graph.forEachNode((key, attrs) => {
    if (attrs.relevance_tier !== "LESS") return;
    const ageMs = nowMs - new Date(attrs.last_seen).getTime();
    if (ageMs > thresholdMs) {
      candidates.push({ key, attrs });
    }
  });

  // Nothing to prune
  if (candidates.length === 0) {
    return;
  }

  // Build JSONL archive content
  const archivedAt = new Date(nowMs).toISOString();
  const lines = candidates.map(({ attrs }) => {
    const record: ArchiveRecord = {
      archived_at: archivedAt,
      concept_id: attrs.concept_id,
      surface_form: attrs.surface_form,
      importance_weight: attrs.importance_weight,
      last_seen: attrs.last_seen,
      frequency_count: attrs.frequency_count,
      source_weight: attrs.source_weight,
      relevance_tier: "LESS",
      sentiment_tier: attrs.sentiment_tier,
    };
    return JSON.stringify(record);
  });

  const archiveContent = lines.join("\n") + "\n";
  const archivePath = `${archiveDir}/pruned-${nowMs}.jsonl`;

  // Ensure archive directory exists (mkdir -p)
  await mkdir(archiveDir, { recursive: true });

  // Write archive BEFORE modifying graph — invariant: never silently lose data
  await Bun.write(archivePath, archiveContent);

  // Only after successful write: drop nodes from graph and clean embedding store
  for (const { key, attrs } of candidates) {
    store.graph.dropNode(key);
    void appendAuditEvent({
      type: "prune",
      timestamp: new Date(nowMs).toISOString(),
      source: "prune",
      concept_id: attrs.concept_id,
      surface_form: attrs.surface_form,
    }, config.eventsPath ?? "data/events.jsonl").catch(() => {});
    // Phase 4: clean embedding store so it doesn't grow without bound (RAG-03)
    await deleteEmbedding(config.ragEmbeddingStorePath, attrs.concept_id);
  }

  // Atomic write of updated graph
  await store.save(axonPath);

  console.log(`[pruneAxon] Pruned ${candidates.length} node(s) → ${archivePath}`);
}
