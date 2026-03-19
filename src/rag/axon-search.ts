// src/rag/axon-search.ts — Phase 4.5: Semantic search over long-term axon concepts.
// Provides text-match and cosine-similarity search over AxonNodeAttrs,
// with hybrid merge combining both result sets.
//
// INVARIANTS:
//   - All functions are pure (no I/O) — callers load nodes and embedding store
//   - Never throws — returns empty array on failure
//   - Immutable throughout — no mutation of input arrays or objects

import { cosineSimilarity } from "../short-term/embedder";
import type { AxonNodeAttrs } from "../axon/store";
import { searchHNSW, type HNSWIndex } from "./hnsw";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AxonSearchResult {
  readonly concept_id: number;
  readonly surface_form: string;
  readonly score: number;
  readonly source: "text" | "semantic" | "merged";
}

// ---------------------------------------------------------------------------
// Text match — substring search on surface_form, ranked by importance_weight
// ---------------------------------------------------------------------------

/**
 * Text-match search over axon concept nodes.
 * Matches any concept whose surface_form contains the query (case-insensitive).
 * Ranked by importance_weight × term coverage (longer match → higher score).
 */
export function textMatchAxon(
  query: string,
  nodes: readonly AxonNodeAttrs[],
  topK: number,
): readonly AxonSearchResult[] {
  if (nodes.length === 0 || !query.trim()) return [];

  const qLower = query.toLowerCase();
  const terms = qLower.split(/\s+/).filter(Boolean);

  const scored: { node: AxonNodeAttrs; score: number }[] = [];

  for (const node of nodes) {
    const form = node.surface_form.toLowerCase();
    // Count how many query terms appear in the surface_form
    const matchCount = terms.filter((t) => form.includes(t)).length;
    if (matchCount === 0) continue;

    // Score = term coverage * importance_weight
    const coverage = matchCount / terms.length;
    const score = coverage * (node.importance_weight ?? 0.5);
    scored.push({ node, score });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(({ node, score }) => ({
    concept_id: node.concept_id,
    surface_form: node.surface_form,
    score,
    source: "text" as const,
  }));
}

// ---------------------------------------------------------------------------
// Semantic search — cosine similarity against embedding store
// ---------------------------------------------------------------------------

/**
 * Semantic search over axon concept nodes using pre-computed embeddings.
 * Nodes without entries in the embedding store are silently excluded.
 * Returns top-k results sorted by cosine similarity descending.
 */
export function semanticSearchAxon(
  queryEmbedding: readonly number[],
  nodes: readonly AxonNodeAttrs[],
  embeddingStore: Readonly<Record<string, number[]>>,
  topK: number,
): readonly AxonSearchResult[] {
  if (nodes.length === 0 || Object.keys(embeddingStore).length === 0) return [];

  const scored: { node: AxonNodeAttrs; score: number }[] = [];

  for (const node of nodes) {
    const vec = embeddingStore[String(node.concept_id)];
    if (!vec) continue; // no embedding for this node — skip

    const sim = cosineSimilarity(queryEmbedding as number[], vec);
    scored.push({ node, score: sim });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(({ node, score }) => ({
    concept_id: node.concept_id,
    surface_form: node.surface_form,
    score: Math.max(0, Math.min(1, score)), // clamp to [0, 1]
    source: "semantic" as const,
  }));
}

// ---------------------------------------------------------------------------
// Merge — deduplicate text + semantic results, take max score per concept
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HNSW semantic search — Phase 9.5: O(log n) approximate nearest neighbor
// Drop-in replacement for semanticSearchAxon using a pre-built HNSW index.
// Falls back to linear scan if index is empty or has no entry point.
// ---------------------------------------------------------------------------

/**
 * Semantic search over axon concept nodes using a live HNSW index.
 * Significantly faster than semanticSearchAxon at scale (100k+ nodes).
 * Falls back to linear cosine scan if the index is empty.
 */
export function semanticSearchAxonHNSW(
  queryEmbedding: readonly number[],
  nodes: readonly AxonNodeAttrs[],
  vectors: Map<string, number[]>,
  hnswIndex: HNSWIndex,
  topK: number,
): readonly AxonSearchResult[] {
  if (nodes.length === 0 || vectors.size === 0) return [];

  // Fall back to linear scan if HNSW index has no nodes
  if (!hnswIndex.entrypoint) {
    const embStore = Object.fromEntries(vectors);
    return semanticSearchAxon(queryEmbedding, nodes, embStore, topK);
  }

  const hnswResults = searchHNSW(hnswIndex, vectors, queryEmbedding as number[], topK);

  // Build a lookup from concept_id → node for score enrichment
  const nodeById = new Map<number, AxonNodeAttrs>();
  for (const n of nodes) nodeById.set(n.concept_id, n);

  const results: AxonSearchResult[] = [];
  for (const { id, distance } of hnswResults) {
    const conceptId = Number(id);
    if (!nodeById.has(conceptId)) continue;
    const node = nodeById.get(conceptId)!;
    results.push({
      concept_id: conceptId,
      surface_form: node.surface_form,
      score: Math.max(0, Math.min(1, 1 - distance)), // convert distance → similarity
      source: "semantic" as const,
    });
  }

  return results;
}

/**
 * Merge text and semantic results, deduplicating by concept_id.
 * For duplicate concept_ids, keeps the maximum score.
 * Returns results sorted by score descending, capped at topK.
 */
export function mergeAxonResults(
  textResults: readonly AxonSearchResult[],
  semanticResults: readonly AxonSearchResult[],
  topK: number,
): readonly AxonSearchResult[] {
  const byId = new Map<number, AxonSearchResult>();

  for (const r of [...textResults, ...semanticResults]) {
    const existing = byId.get(r.concept_id);
    if (!existing || r.score > existing.score) {
      byId.set(r.concept_id, { ...r, source: "merged" });
    }
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topK);
}
