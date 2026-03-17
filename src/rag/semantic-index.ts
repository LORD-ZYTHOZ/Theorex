// src/rag/semantic-index.ts
// Phase 4.5: Semantic memory retrieval via cosine similarity + hybrid BM25 fusion.
// Pure TypeScript — no native deps. Immutable throughout.
// Coexists with BM25 (wink-bm25-text-search); hybridSearch merges both result sets.

import { rename } from "node:fs/promises";
import { loadEmbeddingStore } from "./embedding-store";

export interface SemanticNode {
  readonly id: number;
  readonly embedding: readonly number[];
  readonly text: string;
  readonly timestamp: string;
}

export interface SemanticIndex {
  readonly nodes: readonly SemanticNode[];
  readonly dimension: number;
  readonly built_at: string;
}

export interface HybridSearchResult {
  readonly concept_id: number;
  readonly semantic_score: number;
  readonly bm25_rank?: number;
  readonly combined_score: number;
}

const DEFAULT_INDEX_PATH = "data/semantic-index.json";

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[]
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0; // zero-vector guard
  return dot / denom;
}

// ---------------------------------------------------------------------------
// Index mutations (immutable — always return new objects)
// ---------------------------------------------------------------------------

export function addToIndex(
  index: SemanticIndex,
  node: SemanticNode
): SemanticIndex {
  if (index.nodes.length > 0 && node.embedding.length !== index.dimension) {
    throw new Error(
      `Dimension mismatch: index expects ${index.dimension}, node has ${node.embedding.length}`
    );
  }
  const dimension = index.nodes.length === 0 ? node.embedding.length : index.dimension;
  return {
    nodes: [...index.nodes, node],
    dimension,
    built_at: index.built_at,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function searchIndex(
  index: SemanticIndex,
  queryEmbedding: readonly number[],
  topK: number
): readonly SemanticNode[] {
  if (index.nodes.length === 0) return [];

  const scored = index.nodes.map((node) => ({
    node,
    score: cosineSimilarity(queryEmbedding, node.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((s) => s.node);
}

// ---------------------------------------------------------------------------
// Build from embedding store
// ---------------------------------------------------------------------------

export async function buildIndexFromEmbeddingStore(
  embeddingStorePath?: string
): Promise<SemanticIndex> {
  const storePath = embeddingStorePath ?? "data/concept-embeddings.json";
  const empty: SemanticIndex = {
    nodes: [],
    dimension: 0,
    built_at: new Date().toISOString(),
  };

  let store: Record<string, number[]>;
  try {
    store = await loadEmbeddingStore(storePath);
  } catch {
    return empty;
  }

  const entries = Object.entries(store);
  if (entries.length === 0) return empty;

  const nodes: SemanticNode[] = entries.map(([idStr, embedding]) => ({
    id: Number(idStr),
    embedding,
    text: "",
    timestamp: new Date().toISOString(),
  }));

  const dimension = nodes[0]?.embedding.length ?? 0;

  return {
    nodes,
    dimension,
    built_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function saveIndex(
  index: SemanticIndex,
  path?: string
): Promise<void> {
  const dest = path ?? DEFAULT_INDEX_PATH;
  const tmp = dest + ".tmp";
  await Bun.write(tmp, JSON.stringify(index));
  await rename(tmp, dest);
}

export async function loadIndex(
  path?: string
): Promise<SemanticIndex | null> {
  const src = path ?? DEFAULT_INDEX_PATH;
  try {
    return (await Bun.file(src).json()) as SemanticIndex;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ENOENT")) {
      console.warn(`[semantic-index] Failed to load ${src}: ${msg}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hybrid search — merges pre-computed semantic results with BM25 rank list
// ---------------------------------------------------------------------------

export function hybridSearch(
  semanticNodes: readonly SemanticNode[],
  bm25ConceptIds: readonly number[],
  weights: { readonly semantic: number; readonly bm25: number } = {
    semantic: 0.6,
    bm25: 0.4,
  }
): readonly HybridSearchResult[] {
  // Map semantic nodes to scores (position = rank, score derived from similarity
  // is implicit in the ordering — we assign a rank-based score here too so both
  // channels are on the same 0-1 scale when the caller hasn't pre-scored them).
  const semanticScoreMap = new Map<number, number>();
  const totalSemantic = semanticNodes.length;
  semanticNodes.forEach((node, rank) => {
    // Convert rank to score: best rank (0) → 1.0, last → approaching 0
    const score = totalSemantic > 1 ? 1 - rank / totalSemantic : 1;
    semanticScoreMap.set(node.id, score);
  });

  const bm25ScoreMap = new Map<number, { rank: number; score: number }>();
  const totalBm25 = bm25ConceptIds.length;
  bm25ConceptIds.forEach((id, rank) => {
    const score = totalBm25 > 0 ? 1 - rank / totalBm25 : 0;
    bm25ScoreMap.set(id, { rank, score });
  });

  // Collect all unique concept IDs from both sets
  const allIds = new Set<number>([
    ...semanticScoreMap.keys(),
    ...bm25ScoreMap.keys(),
  ]);

  const results: HybridSearchResult[] = [];
  for (const id of allIds) {
    const semanticScore = semanticScoreMap.get(id) ?? 0;
    const bm25Entry = bm25ScoreMap.get(id);
    const bm25Score = bm25Entry?.score ?? 0;
    const combined =
      weights.semantic * semanticScore + weights.bm25 * bm25Score;

    results.push({
      concept_id: id,
      semantic_score: semanticScore,
      bm25_rank: bm25Entry?.rank,
      combined_score: combined,
    });
  }

  results.sort((a, b) => b.combined_score - a.combined_score);
  return results;
}
