/**
 * compressed-search.ts — Two-stage retrieval using TurboQuant native compression.
 *
 * Stage 1 (fast): innerProductEstimate pre-filter on TurboCode compressed vectors.
 * Stage 2 (accurate): Cosine similarity rerank on full 768d embeddings for top candidates.
 */

const { NativeQuantizer: NativeQuantizerClass } = require("../../../packages/turbo-quant-native/index.js");

// ---------------------------------------------------------------------------
// Singleton quantizer (one per Bun worker — stateless compute engine)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativeQuantizerType = any;

let _quantizer: NativeQuantizerType | null = null;

function getQuantizer(): NativeQuantizerType {
  if (!_quantizer) {
    _quantizer = new NativeQuantizerClass(
      768,  // nomic-embed-text output dimension
      8,    // bits: 8 = recommended for semantic search recall@10
      192,  // projections: dim/4 = 192
      42n,  // seed: must match the seed used in backfill
    );
  }
  return _quantizer;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressedSearchResult {
  readonly id: string;
  readonly label: string;
  readonly memory_type: string;
  readonly agent_id: string;
  readonly meta: Record<string, unknown>;
  readonly innerProductScore: number;  // Stage 1 score (higher = more similar)
  readonly cosineScore: number;        // Stage 2 score (higher = more similar)
}

export const DEFAULT_PRE_FILTER_N = 200;
export const DEFAULT_TOP_K = 10;

export interface CompressedSearchOptions {
  readonly agentId?: string;
  readonly preFilterN?: number;
  readonly topK?: number;
}

// ---------------------------------------------------------------------------
// DB connection (module-level singleton)
// ---------------------------------------------------------------------------

let _sql: ReturnType<typeof Bun.sql> | null = null;

function getDb(): ReturnType<typeof Bun.sql> {
  if (!_sql) {
    _sql = new Bun.SQL({
      host: process.env.THEOREX_PG_HOST || "100.95.91.32",
      port: Number(process.env.THEOREX_PG_PORT || 5432),
      user: process.env.THEOREX_PG_USER || "claw",
      database: process.env.THEOREX_PG_DB || "theorex",
      max: 5,
    });
  }
  return _sql;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function parseVec(raw: unknown): Float32Array {
  if (typeof raw !== "string") throw new Error(`expected string for embedding, got ${typeof raw}`);
  return new Float32Array(raw.slice(1, -1).split(",").map(Number));
}

function parseCode(raw: unknown): Buffer {
  if (raw instanceof Buffer) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  throw new Error(`unexpected type for compressed_vector: ${typeof raw}`);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface CompressedRow {
  readonly id: string;
  readonly label: string;
  readonly memory_type: string;
  readonly agent_id: string;
  readonly meta: Record<string, unknown>;
  readonly compressed_vector: unknown;
}

interface FullEmbeddingRow {
  readonly id: string;
  readonly embedding: unknown;
}

interface ScoredCandidate {
  readonly id: string;
  readonly label: string;
  readonly memory_type: string;
  readonly agent_id: string;
  readonly meta: Record<string, unknown>;
  readonly innerProductScore: number;
}

// ---------------------------------------------------------------------------
// Stage 1: innerProductEstimate pre-filter
// ---------------------------------------------------------------------------

async function innerProductPreFilter(
  queryVec: Float32Array,
  agentId: string | undefined,
  preFilterN: number,
): Promise<ScoredCandidate[]> {
  const sql = getDb();
  const quantizer = getQuantizer();

  const rows: CompressedRow[] = agentId
    ? await sql`
        SELECT id, label, memory_type, agent_id, meta, compressed_vector
        FROM concepts
        WHERE compressed_vector IS NOT NULL
          AND agent_id = ${agentId}
        ORDER BY created_at DESC
        LIMIT 5000
      `
    : await sql`
        SELECT id, label, memory_type, agent_id, meta, compressed_vector
        FROM concepts
        WHERE compressed_vector IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5000
      `;

  const scored = rows.map((row) => {
    const code = parseCode(row.compressed_vector);
    return {
      id: row.id,
      label: row.label,
      memory_type: row.memory_type,
      agent_id: row.agent_id,
      meta: row.meta,
      innerProductScore: quantizer.innerProductEstimate(code, queryVec),
    };
  });

  // Higher inner product = more similar — sort descending
  return scored
    .slice()
    .sort((a: ScoredCandidate, b: ScoredCandidate) => b.innerProductScore - a.innerProductScore)
    .slice(0, preFilterN);
}

// ---------------------------------------------------------------------------
// Stage 2: Cosine rerank (unchanged from legacy)
// ---------------------------------------------------------------------------

async function cosineRerank(
  candidates: ScoredCandidate[],
  queryVec: Float32Array,
  topK: number,
): Promise<CompressedSearchResult[]> {
  if (candidates.length === 0) return [];

  const sql = getDb();
  const candidateIds = candidates.map((c) => c.id);
  const pgArray = `{${candidateIds.join(",")}}`;

  const fullRows: FullEmbeddingRow[] = await sql`
    SELECT id, embedding FROM concepts WHERE id = ANY(${pgArray}::uuid[])
  `;

  const embeddingMap = new Map<string, Float32Array>();
  for (const row of fullRows) {
    if (row.embedding !== null) {
      try {
        embeddingMap.set(row.id, parseVec(row.embedding));
      } catch (err) {
        console.error(`[compressed-search] failed to parse embedding for id=${row.id}:`, err);
      }
    }
  }

  const withCosine = candidates
    .filter((c) => embeddingMap.has(c.id))
    .map((c) => ({
      ...c,
      cosineScore: cosine(queryVec, embeddingMap.get(c.id)!),
    }));

  return withCosine
    .slice()
    .sort((a, b) => b.cosineScore - a.cosineScore)
    .slice(0, topK);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Two-stage compressed search.
 * @param queryVec - 768d query embedding (Float32Array)
 * @param options
 */
export async function compressedSearch(
  queryVec: Float32Array,
  options?: CompressedSearchOptions,
): Promise<CompressedSearchResult[]> {
  const agentId = options?.agentId;
  const preFilterN = options?.preFilterN ?? DEFAULT_PRE_FILTER_N;
  const topK = options?.topK ?? DEFAULT_TOP_K;

  const candidates = await innerProductPreFilter(queryVec, agentId, preFilterN);
  return cosineRerank(candidates, queryVec, topK);
}

// ---------------------------------------------------------------------------
// Test injection hooks (only use in tests)
// ---------------------------------------------------------------------------

export function _setDbForTesting(db: ReturnType<typeof Bun.sql>): void {
  _sql = db;
}

export function _resetDbForTesting(): void {
  _sql = null;
}

export function _setQuantizerForTesting(q: NativeQuantizerType): void {
  _quantizer = q;
}

export function _resetQuantizerForTesting(): void {
  _quantizer = null;
}
