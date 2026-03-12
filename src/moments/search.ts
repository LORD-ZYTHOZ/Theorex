// src/moments/search.ts — BM25 search over moment stories.
// Uses same wink-bm25-text-search CJS interop pattern as src/short-term/bm25.ts.
// Minimum 3-doc sentinel padding applied when moments.length < 3.

import { createRequire } from "node:module";
import type { MomentNode } from "./store";

const require = createRequire(import.meta.url);
const winkBm25: () => any = require("wink-bm25-text-search");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MomentSearchResult {
  readonly id: string;
  readonly story: string;
  readonly score: number;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Internal sentinel type for padding
// ---------------------------------------------------------------------------

interface SentinelMoment {
  readonly id: string;
  readonly story: string;
  readonly concept_ids: readonly number[];
  readonly code_refs: readonly [];
  readonly timestamp: string;
  readonly sentinel: true;
}

type IndexedMoment = MomentNode | SentinelMoment;

// ---------------------------------------------------------------------------
// buildMomentBm25Index
// ---------------------------------------------------------------------------

/**
 * Build a consolidated BM25 index over the given moments.
 *
 * Configuration:
 *   - fldWeights: { story: 3 } — boosts story field matches 3x
 *   - bm25Params: { k1: 1.2, b: 0.75 } — standard BM25 parameters
 *
 * Pads with sentinel docs when moments.length < 3 to satisfy wink's 3-doc minimum.
 * The returned engine is consolidated and ready for search.
 */
export function buildMomentBm25Index(moments: MomentNode[]): ReturnType<typeof winkBm25> {
  const engine = winkBm25();
  engine.defineConfig({
    fldWeights: { story: 3 },
    bm25Params: { k1: 1.2, b: 0.75 },
  });
  engine.definePrepTasks([
    (t: string) => t.toLowerCase().split(/\W+/).filter(Boolean),
  ]);

  // Build padded array — must have at least 3 docs for consolidate()
  const padded: IndexedMoment[] = [...moments];
  const PAD_TO = 3;
  while (padded.length < PAD_TO) {
    padded.push({
      id: "",
      story: "",
      concept_ids: [],
      code_refs: [],
      timestamp: "",
      sentinel: true,
    });
  }

  padded.forEach((moment, i) => {
    engine.addDoc({ story: moment.story }, i);
  });

  engine.consolidate();
  return engine;
}

// ---------------------------------------------------------------------------
// searchMoments
// ---------------------------------------------------------------------------

/**
 * Search over moment nodes using BM25 keyword matching on the story field.
 *
 * Returns [] when moments array is empty.
 * Filters out sentinel results (id === "").
 * Results are sorted descending by score.
 *
 * @param moments - array of MomentNode to search over
 * @param query - keyword query string
 * @param limit - maximum number of results to return (default: 10)
 */
export async function searchMoments(
  moments: MomentNode[],
  query: string,
  limit = 10
): Promise<MomentSearchResult[]> {
  if (moments.length === 0) {
    return [];
  }

  const engine = buildMomentBm25Index(moments);

  // wink returns [[uniqueId (integer index), score], ...] sorted by score desc
  const raw: Array<[number, number]> = engine.search(query, limit * 2) ?? [];

  const mapped: MomentSearchResult[] = raw
    .map(([uniqueId, score]) => {
      const moment = moments[uniqueId];
      if (!moment) return null; // sentinel index (>= moments.length)
      if (moment.id === "") return null; // sentinel with empty id
      return {
        id: moment.id,
        story: moment.story,
        score,
        timestamp: moment.timestamp,
      };
    })
    .filter((r): r is MomentSearchResult => r !== null);

  // Sort descending by score (wink already sorts, but filter may reorder)
  mapped.sort((a, b) => b.score - a.score);

  return mapped.slice(0, limit);
}
