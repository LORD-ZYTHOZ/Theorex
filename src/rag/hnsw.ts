// src/rag/hnsw.ts — Phase 9.5: HNSW live index
// Pure TypeScript implementation of the Hierarchical Navigable Small World algorithm
// for approximate nearest-neighbor search over concept embeddings.
//
// Reference: Malkov & Yashunin, 2018 (https://arxiv.org/abs/1603.09320)
//
// INVARIANTS:
//   - buildHNSWIndex is pure (reads vectors, returns new index — no mutation)
//   - searchHNSW is pure (read-only access to index and vectors)
//   - serialize/deserialize are lossless round-trips (graph structure only; vectors live in embedding store)
//   - Never throws — callers handle errors

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HNSWNode {
  readonly level: number;
  /** neighbors[layer] = [id, ...] — connections at each layer */
  readonly neighbors: readonly (readonly string[])[];
}

export interface HNSWIndex {
  readonly nodes: Readonly<Record<string, HNSWNode>>;
  readonly entrypoint: string | null;
  readonly maxLevel: number;
  readonly M: number;
  readonly Mmax0: number;
  readonly efConstruction: number;
  readonly efSearch: number;
}

export interface HNSWResult {
  readonly id: string;
  readonly distance: number;
}

/** Serialized form is identical to HNSWIndex — plain JSON-safe object */
export type SerializedHNSW = {
  nodes: Record<string, { level: number; neighbors: string[][] }>;
  entrypoint: string | null;
  maxLevel: number;
  M: number;
  Mmax0: number;
  efConstruction: number;
  efSearch: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_M = 16;
const DEFAULT_EF_CONSTRUCTION = 200;
const DEFAULT_EF_SEARCH = 50;

export interface HNSWConfig {
  M?: number;
  efConstruction?: number;
  efSearch?: number;
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom < 1e-10 ? 1 : 1 - dot / denom;
}

// ---------------------------------------------------------------------------
// Level generation
// ---------------------------------------------------------------------------

function randomLevel(M: number): number {
  const ml = 1 / Math.log(M);
  return Math.floor(-Math.log(Math.random() + 1e-10) * ml);
}

// ---------------------------------------------------------------------------
// Mutable node (used during build only — never exposed externally)
// ---------------------------------------------------------------------------

interface BuildNode {
  id: string;
  level: number;
  neighbors: string[][];
}

// ---------------------------------------------------------------------------
// Core HNSW algorithm
// ---------------------------------------------------------------------------

/**
 * SEARCH-LAYER: greedy beam search at a single layer.
 * Returns up to `ef` nearest candidates sorted ascending by distance.
 */
function searchLayer(
  queryVec: number[],
  entrypoints: { id: string; dist: number }[],
  ef: number,
  layer: number,
  nodes: Record<string, BuildNode>,
  vectors: Map<string, number[]>,
): Array<{ id: string; dist: number }> {
  const visited = new Set<string>(entrypoints.map((e) => e.id));

  // candidates: ascending by distance (nearest first)
  const candidates: Array<{ id: string; dist: number }> = [...entrypoints].sort(
    (a, b) => a.dist - b.dist,
  );

  // W: nearest found, bounded to ef, sorted descending (furthest first for O(1) max peek)
  const W: Array<{ id: string; dist: number }> = [...entrypoints].sort(
    (a, b) => b.dist - a.dist,
  );

  while (candidates.length > 0) {
    const c = candidates.shift()!; // nearest candidate
    const fDist = W.length > 0 ? W[0].dist : Infinity; // furthest in W

    if (c.dist > fDist) break; // all remaining candidates are further than worst in W

    const node = nodes[c.id];
    if (!node) continue;
    const layerNeighbors = node.neighbors[layer] ?? [];

    for (const nId of layerNeighbors) {
      if (visited.has(nId)) continue;
      visited.add(nId);

      const nVec = vectors.get(nId);
      if (!nVec) continue;
      const nDist = cosineDistance(queryVec, nVec);
      const curFarthest = W.length > 0 ? W[0].dist : Infinity;

      if (nDist < curFarthest || W.length < ef) {
        // Insert into candidates (sorted ascending)
        const ci = candidates.findIndex((x) => x.dist > nDist);
        if (ci === -1) candidates.push({ id: nId, dist: nDist });
        else candidates.splice(ci, 0, { id: nId, dist: nDist });

        // Insert into W (sorted descending — furthest first)
        const wi = W.findIndex((x) => x.dist < nDist);
        if (wi === -1) W.push({ id: nId, dist: nDist });
        else W.splice(wi, 0, { id: nId, dist: nDist });

        if (W.length > ef) W.shift(); // remove furthest (front of desc-sorted array)
      }
    }
  }

  return W.sort((a, b) => a.dist - b.dist);
}

/**
 * SELECT-NEIGHBORS: simple heuristic — take the M nearest from candidates.
 */
function selectNeighbors(
  candidates: Array<{ id: string; dist: number }>,
  M: number,
): Array<{ id: string; dist: number }> {
  return [...candidates].sort((a, b) => a.dist - b.dist).slice(0, M);
}

/**
 * Prune a neighbor list to maxConnections by keeping nearest.
 */
function pruneConnections(
  nodeId: string,
  currentNeighbors: string[],
  maxConnections: number,
  nodes: Record<string, BuildNode>,
  vectors: Map<string, number[]>,
): string[] {
  if (currentNeighbors.length <= maxConnections) return currentNeighbors;
  const nodeVec = vectors.get(nodeId);
  if (!nodeVec) return currentNeighbors.slice(0, maxConnections);
  return currentNeighbors
    .map((nId) => ({
      id: nId,
      dist: (() => {
        const v = vectors.get(nId);
        return v ? cosineDistance(nodeVec, v) : Infinity;
      })(),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxConnections)
    .map((x) => x.id);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an HNSW index from a set of vectors.
 * Returns a new immutable HNSWIndex — does not mutate input.
 * Empty map → empty index (valid, search returns []).
 */
export function buildHNSWIndex(
  vectors: Map<string, number[]>,
  config: HNSWConfig = {},
): HNSWIndex {
  const M = config.M ?? DEFAULT_M;
  const Mmax0 = M * 2;
  const efConstruction = config.efConstruction ?? DEFAULT_EF_CONSTRUCTION;
  const efSearch = config.efSearch ?? DEFAULT_EF_SEARCH;

  const buildNodes: Record<string, BuildNode> = {};
  let entrypoint: string | null = null;
  let maxLevel = 0;

  for (const [id, vec] of vectors) {
    if (!vec || vec.length === 0) continue;

    const level = randomLevel(M);
    const node: BuildNode = {
      id,
      level,
      neighbors: Array.from({ length: level + 1 }, () => []),
    };
    buildNodes[id] = node;

    if (entrypoint === null) {
      // First node — becomes entrypoint
      entrypoint = id;
      maxLevel = level;
      continue;
    }

    const epVec = vectors.get(entrypoint)!;
    let eps: Array<{ id: string; dist: number }> = [
      { id: entrypoint, dist: cosineDistance(vec, epVec) },
    ];

    // Greedy descent from top layer down to level+1
    for (let lc = maxLevel; lc > level; lc--) {
      const W = searchLayer(vec, eps, 1, lc, buildNodes, vectors);
      eps = W.slice(0, 1);
    }

    // From min(maxLevel, level) down to 0: beam search + connect
    for (let lc = Math.min(maxLevel, level); lc >= 0; lc--) {
      const W = searchLayer(vec, eps, efConstruction, lc, buildNodes, vectors);
      const Mmax = lc === 0 ? Mmax0 : M;
      const neighbors = selectNeighbors(W, Mmax);

      // Connect new node to its neighbors at this layer
      node.neighbors[lc] = neighbors.map((n) => n.id);

      // Connect neighbors back to new node (bidirectional)
      for (const { id: nId } of neighbors) {
        const nNode = buildNodes[nId];
        if (!nNode) continue;
        if (!nNode.neighbors[lc]) nNode.neighbors[lc] = [];
        nNode.neighbors[lc].push(id);

        // Prune if over limit
        const limit = lc === 0 ? Mmax0 : M;
        if (nNode.neighbors[lc].length > limit) {
          nNode.neighbors[lc] = pruneConnections(nId, nNode.neighbors[lc], limit, buildNodes, vectors);
        }
      }

      eps = W;
    }

    // Update entrypoint if new node has higher level
    if (level > maxLevel) {
      maxLevel = level;
      entrypoint = id;
    }
  }

  // Freeze: convert mutable build nodes to readonly HNSWNode
  const frozenNodes: Record<string, HNSWNode> = {};
  for (const [id, n] of Object.entries(buildNodes)) {
    frozenNodes[id] = {
      level: n.level,
      neighbors: n.neighbors.map((layer) => Object.freeze([...layer])),
    };
  }

  return Object.freeze({
    nodes: Object.freeze(frozenNodes),
    entrypoint,
    maxLevel,
    M,
    Mmax0,
    efConstruction,
    efSearch,
  });
}

/**
 * Search the HNSW index for the k approximate nearest neighbors to queryVec.
 * Returns results sorted ascending by cosine distance.
 * Does not mutate the index or vectors.
 */
export function searchHNSW(
  index: HNSWIndex,
  vectors: Map<string, number[]>,
  queryVec: number[],
  k: number,
): readonly HNSWResult[] {
  if (!index.entrypoint || Object.keys(index.nodes).length === 0) return [];

  // Build mutable proxy nodes for searchLayer (read-only view)
  const proxyNodes: Record<string, BuildNode> = {};
  for (const [id, n] of Object.entries(index.nodes)) {
    proxyNodes[id] = {
      id,
      level: n.level,
      neighbors: n.neighbors.map((layer) => [...layer]),
    };
  }

  const epVec = vectors.get(index.entrypoint);
  if (!epVec) return [];

  let eps: Array<{ id: string; dist: number }> = [
    { id: index.entrypoint, dist: cosineDistance(queryVec, epVec) },
  ];

  // Greedy descent from top to layer 1
  for (let lc = index.maxLevel; lc > 0; lc--) {
    const W = searchLayer(queryVec, eps, 1, lc, proxyNodes, vectors);
    eps = W.slice(0, 1);
  }

  // Full beam search at layer 0
  const ef = Math.max(k, index.efSearch);
  const W = searchLayer(queryVec, eps, ef, 0, proxyNodes, vectors);

  return W.slice(0, k).map(({ id, dist }) => Object.freeze({ id, distance: dist }));
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an HNSWIndex to a plain JSON-safe object.
 * Vectors are NOT included — they live in the embedding store.
 */
export function serializeHNSW(index: HNSWIndex): SerializedHNSW {
  const nodes: Record<string, { level: number; neighbors: string[][] }> = {};
  for (const [id, n] of Object.entries(index.nodes)) {
    nodes[id] = {
      level: n.level,
      neighbors: n.neighbors.map((layer) => [...layer]),
    };
  }
  return {
    nodes,
    entrypoint: index.entrypoint,
    maxLevel: index.maxLevel,
    M: index.M,
    Mmax0: index.Mmax0,
    efConstruction: index.efConstruction,
    efSearch: index.efSearch,
  };
}

/**
 * Restore an HNSWIndex from a serialized snapshot.
 */
export function deserializeHNSW(data: SerializedHNSW): HNSWIndex {
  const frozenNodes: Record<string, HNSWNode> = {};
  for (const [id, n] of Object.entries(data.nodes)) {
    frozenNodes[id] = {
      level: n.level,
      neighbors: n.neighbors.map((layer) => Object.freeze([...layer])),
    };
  }
  return Object.freeze({
    nodes: Object.freeze(frozenNodes),
    entrypoint: data.entrypoint,
    maxLevel: data.maxLevel,
    M: data.M ?? 16,
    Mmax0: data.Mmax0 ?? 32,
    efConstruction: data.efConstruction ?? DEFAULT_EF_CONSTRUCTION,
    efSearch: data.efSearch ?? DEFAULT_EF_SEARCH,
  });
}
