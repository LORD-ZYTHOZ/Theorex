// src/rag/hnsw-store.ts — Phase 9.5: Persist and load HNSW index
// Writes graph structure to data/hnsw-index.json (vectors stay in embedding store).
//
// INVARIANTS:
//   - loadHNSWIndex returns null on missing/corrupt file (never throws)
//   - saveHNSWIndex is atomic (write to .tmp, then rename)
//   - Does not touch the embedding store

import { rename } from "node:fs/promises";
import {
  serializeHNSW,
  deserializeHNSW,
  buildHNSWIndex,
  type HNSWIndex,
  type HNSWConfig,
} from "./hnsw";

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load a previously saved HNSW index from disk.
 * Returns null if the file doesn't exist or is corrupt.
 */
export async function loadHNSWIndex(indexPath: string): Promise<HNSWIndex | null> {
  try {
    const text = await Bun.file(indexPath).text();
    const data = JSON.parse(text);
    return deserializeHNSW(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save an HNSW index to disk atomically (write → rename).
 * Vectors are NOT saved here — they live in the embedding store.
 */
export async function saveHNSWIndex(indexPath: string, index: HNSWIndex): Promise<void> {
  const tmp = indexPath + ".tmp";
  await Bun.write(tmp, JSON.stringify(serializeHNSW(index)));
  await rename(tmp, indexPath);
}

// ---------------------------------------------------------------------------
// Build + save
// ---------------------------------------------------------------------------

/**
 * Build a fresh HNSW index from the provided vectors and write it to disk.
 * Call this after embedding store changes (new concepts added, pruned, etc.).
 */
export async function buildAndSaveHNSWIndex(
  indexPath: string,
  vectors: Map<string, number[]>,
  config: HNSWConfig = {},
): Promise<HNSWIndex> {
  const index = buildHNSWIndex(vectors, config);
  await saveHNSWIndex(indexPath, index);
  return index;
}

// ---------------------------------------------------------------------------
// Load-or-build
// ---------------------------------------------------------------------------

/**
 * Load HNSW index from disk if present, otherwise build from vectors and save.
 * `staleIfOlderMs` (default 24h) — rebuild if the index file is older than this.
 */
export async function loadOrBuildHNSWIndex(
  indexPath: string,
  vectors: Map<string, number[]>,
  config: HNSWConfig = {},
  staleIfOlderMs = 24 * 60 * 60 * 1000,
): Promise<HNSWIndex> {
  // Check file freshness
  try {
    const stat = Bun.file(indexPath);
    const meta = await stat.stat?.() ?? null;
    if (meta) {
      const ageMs = Date.now() - meta.mtimeMs;
      if (ageMs < staleIfOlderMs) {
        const loaded = await loadHNSWIndex(indexPath);
        if (loaded) return loaded;
      }
    }
  } catch {
    // File doesn't exist or stat failed — fall through to build
  }

  return buildAndSaveHNSWIndex(indexPath, vectors, config);
}
