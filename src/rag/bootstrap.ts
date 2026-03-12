// src/rag/bootstrap.ts
// KNN seeding: embeds a new concept, finds nearest neighbours in the embedding store,
// and creates seeded edges in the AxonStore.
//
// INVARIANTS:
//   - REUSES cosineSimilarity from src/short-term/embedder.ts — do NOT re-implement
//   - Never seeds to LESS-tier nodes (graph pollution)
//   - Guards every mergeEdge with store.graph.hasNode() — abort if target absent
//   - Non-blocking: callers use void seedEdges(...) or setImmediate
//   - Edge weight scale: 0.1 + (similarity - minSimilarity) * 0.2, clamped to [0.1, 0.2]

import { cosineSimilarity, embedText } from "../short-term/embedder";
import { loadEmbeddingStore, saveEmbedding } from "./embedding-store";
import { embedWithOnnx } from "./embedder";
import type { AxonStore } from "../axon/store";
import type { Config } from "../config";

export interface SeedResult {
  targetConceptId: number;
  similarity: number;
  edgeWeight: number; // always 0.1–0.2
}

/**
 * Pure KNN scan. No I/O. Deterministic given same inputs.
 * Returns top-k results above minSimilarity, excluding excludeConceptId.
 */
export async function findKNN(
  newVector: number[],
  embeddingStore: Record<string, number[]>,
  excludeConceptId: number,
  k = 5,
  minSimilarity = 0.4
): Promise<SeedResult[]> {
  const scored = Object.entries(embeddingStore)
    .filter(([id]) => Number(id) !== excludeConceptId)
    .map(([id, vec]) => ({
      targetConceptId: Number(id),
      similarity: cosineSimilarity(newVector, vec),
    }))
    .filter(({ similarity }) => similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  return scored.map(({ targetConceptId, similarity }) => ({
    targetConceptId,
    similarity,
    // Scale 0.1–0.2: clamp to avoid floating point outside range
    edgeWeight: Math.min(0.2, Math.max(0.1, 0.1 + (similarity - minSimilarity) * 0.2)),
  }));
}

/**
 * High-level entry point: embed concept label, persist embedding, seed edges.
 * Non-blocking design: call as `void seedEdges(...)` from concept upsert.
 *
 * Fallback chain for embedding:
 *   1. LM Studio (embedText from short-term)
 *   2. @huggingface/transformers ONNX (embedWithOnnx)
 *   3. null → skip seeding silently (graceful BM25-only mode)
 */
export async function seedEdges(
  store: AxonStore,
  conceptId: number,
  label: string,
  embeddingStorePath: string,
  config: Pick<Config, "ragBootstrapK" | "ragBootstrapMinSimilarity" | "lmStudioUrl" | "lmStudioEmbedModel" | "lmStudioTimeoutMs" | "ragOnnxModel">
): Promise<void> {
  // Tier 1: LM Studio
  let vector = await embedText(label, config.lmStudioUrl, config.lmStudioEmbedModel, config.lmStudioTimeoutMs);
  // Tier 2: ONNX fallback (skipped if ragOnnxModel is empty)
  if (vector === null) {
    vector = await embedWithOnnx(label, config.ragOnnxModel);
  }
  // Tier 3: BM25-only — skip seeding silently
  if (vector === null) return;

  // Persist embedding for future KNN queries
  await saveEmbedding(embeddingStorePath, conceptId, vector);

  // Load all stored embeddings and find nearest neighbours
  const embeddingStore = await loadEmbeddingStore(embeddingStorePath);
  const results = await findKNN(
    vector,
    embeddingStore,
    conceptId,
    config.ragBootstrapK,
    config.ragBootstrapMinSimilarity
  );

  const now = new Date().toISOString();
  for (const result of results) {
    const targetKey = String(result.targetConceptId);

    // Guard: target node must still exist in graph (may have been pruned)
    if (!store.graph.hasNode(targetKey)) continue;

    // Guard: do not seed to LESS-tier nodes (graph pollution)
    const targetAttrs = store.graph.getNodeAttributes(targetKey);
    if (targetAttrs.relevance_tier === "LESS") continue;

    // Seed the edge only if no organic edge already exists — preserve organic edges
    const edgeKey = store.graph.edge(String(conceptId), targetKey);
    if (edgeKey === undefined) {
      // New seeded edge
      store.graph.mergeEdge(String(conceptId), targetKey, {
        strength: result.edgeWeight,
        co_occurrence_count: 0,
        last_co_occurrence: now,
        seeded: true,
        seed_created_at: now,
      });
    }
    // If organic edge already exists, do not downgrade to seeded — leave it
  }
}
