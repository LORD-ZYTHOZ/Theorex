// src/short-term/bm25.ts — BM25 keyword search over short-term entries.
// Uses wink-bm25-text-search (CJS package loaded via createRequire).
// surface_form field weight = 3 (boosts exact surface_form matches in ranking).

import { createRequire } from "node:module";
import type { ShortTermEntry } from "./store.ts";

const require = createRequire(import.meta.url);
const bm25: () => any = require("wink-bm25-text-search");

export interface BM25SearchResult {
  readonly id: string;
  readonly score: number;
}

/**
 * Build a consolidated BM25 index over the given short-term entries.
 *
 * Configuration:
 *   - fldWeights: { surface_form: 3 } — boosts surface_form matches 3x
 *   - ovFldNames: ["id"] — id is the unique identifier stored as an out-of-vocabulary field
 *
 * The returned engine is consolidated and ready for search.
 * The entry position (integer index) is used as the uniqueId for addDoc so
 * bm25Search can map results back to the original entry id.
 */
export function buildBm25Index(entries: ShortTermEntry[]): ReturnType<typeof bm25> {
  const engine = bm25();
  engine.defineConfig({
    fldWeights: { surface_form: 3 },
    ovFldNames: ["id"],
  });
  engine.definePrepTasks([
    (t: string) => t.toLowerCase().split(/\W+/).filter(Boolean),
  ]);
  entries.forEach((entry, i) => {
    engine.addDoc({ surface_form: entry.surface_form, id: entry.id }, i);
  });
  // wink-bm25-text-search requires at least 3 docs to consolidate.
  // Pad with empty sentinel docs when corpus is smaller; sentinels use
  // indices >= entries.length so they never collide with real id lookups.
  const PAD_TO = 3;
  for (let p = entries.length; p < PAD_TO; p++) {
    engine.addDoc({ surface_form: "", id: `__sentinel_${p}__` }, p);
  }
  engine.consolidate();
  return engine;
}

/**
 * Search a consolidated BM25 engine for entries matching query.
 *
 * Returns BM25SearchResult[] sorted by descending score.
 * The uniqueId from wink (integer index) is mapped back to entries[uniqueId].id.
 *
 * @param engine - consolidated BM25 engine from buildBm25Index
 * @param entries - the same entries array passed to buildBm25Index (for id mapping)
 * @param query - keyword query string
 * @param limit - maximum number of results to return (default: 10)
 */
export function bm25Search(
  engine: ReturnType<typeof bm25>,
  entries: ShortTermEntry[],
  query: string,
  limit = 10
): BM25SearchResult[] {
  // wink returns [[uniqueId (integer index), score], ...] sorted by score desc
  const raw: Array<[number, number]> = engine.search(query, limit) ?? [];
  return raw.map(([uniqueId, score]) => ({
    id: entries[uniqueId]?.id ?? String(uniqueId),
    score,
  }));
}
