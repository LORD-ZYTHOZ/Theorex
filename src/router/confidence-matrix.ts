// confidence-matrix.ts — Phase 15.5 trace-driven routing.
// After 5+ samples per (query_type, model) cell, routing uses empirical data
// instead of heuristics. All functions are pure or perform explicit I/O.
// No mutations — every function returns new objects.

import { join } from "node:path";
import type { QueryType } from "./heuristic.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { QueryType };

export interface MatrixCell {
  readonly query_type: QueryType;
  readonly model_name: string;
  readonly success_rate: number;
  readonly avg_latency_ms: number;
  readonly avg_cost_tokens: number;
  readonly sample_count: number;
  readonly last_updated: string;
}

export interface ConfidenceMatrix {
  readonly version: number;
  readonly built_at: string;
  readonly cells: readonly MatrixCell[];
  readonly min_samples_threshold: number;
}

export interface DataDrivenDecision {
  readonly model_name: string;
  readonly query_type: QueryType;
  readonly confidence: number;
  readonly reasoning: string;
  readonly cell: MatrixCell;
}

// ---------------------------------------------------------------------------
// Internal trace shape (read from data/traces/*.json)
// ---------------------------------------------------------------------------

// The live TraceRecord from bus.ts stores query_type in tags[0], not as a
// standalone field. We accept both layouts so buildMatrix works with both
// legacy traces (if any) and live EventBus-assembled traces.
interface TraceRecord {
  model: string;
  query_type?: string;   // optional — set by legacy or injected below
  tags?: string[];       // live traces carry [query_type, model] here
  success: boolean;
  latency_ms: number;
  total_tokens: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_TRACES_DIR = "data/traces";
const MATRIX_FILENAME = "routing-matrix.json";
const MATRIX_VERSION = 1;
const DEFAULT_MIN_SAMPLES = 5;
const CONFIDENCE_SATURATION_SAMPLES = 20;

const VALID_QUERY_TYPES = new Set<string>([
  "code",
  "math",
  "retrieval",
  "synthesis",
  "general",
]);

function toQueryType(raw: string | undefined): QueryType {
  if (raw && VALID_QUERY_TYPES.has(raw)) return raw as QueryType;
  return "general";
}

/** Aggregate raw trace records into MatrixCell values. */
function aggregateCells(records: readonly TraceRecord[]): readonly MatrixCell[] {
  type Accumulator = {
    success_count: number;
    total_count: number;
    total_latency: number;
    total_tokens: number;
    last_updated: string;
  };

  const buckets = new Map<string, Accumulator>();

  for (const r of records) {
    const key = `${toQueryType(r.query_type)}::${r.model}`;
    const existing = buckets.get(key);
    const ts = new Date().toISOString();

    if (existing) {
      buckets.set(key, {
        success_count: existing.success_count + (r.success ? 1 : 0),
        total_count: existing.total_count + 1,
        total_latency: existing.total_latency + r.latency_ms,
        total_tokens: existing.total_tokens + r.total_tokens,
        last_updated: ts,
      });
    } else {
      buckets.set(key, {
        success_count: r.success ? 1 : 0,
        total_count: 1,
        total_latency: r.latency_ms,
        total_tokens: r.total_tokens,
        last_updated: ts,
      });
    }
  }

  const cells: MatrixCell[] = [];
  for (const [key, acc] of buckets) {
    const parts = key.split("::");
    const query_type_raw = parts[0] ?? "general";
    const model_name = parts[1] ?? "unknown";
    cells.push({
      query_type: toQueryType(query_type_raw),
      model_name,
      success_rate: acc.success_count / acc.total_count,
      avg_latency_ms: acc.total_latency / acc.total_count,
      avg_cost_tokens: acc.total_tokens / acc.total_count,
      sample_count: acc.total_count,
      last_updated: acc.last_updated,
    });
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read all JSON files from tracesDir, aggregate into a ConfidenceMatrix.
 * Returns an empty matrix (cells: []) if the directory is missing or empty.
 */
export async function buildMatrix(
  tracesDir: string = DEFAULT_TRACES_DIR,
): Promise<ConfidenceMatrix> {
  const emptyMatrix: ConfidenceMatrix = {
    version: MATRIX_VERSION,
    built_at: new Date().toISOString(),
    cells: [],
    min_samples_threshold: DEFAULT_MIN_SAMPLES,
  };

  let entries: string[];
  try {
    const glob = new Bun.Glob("*.json");
    const found: string[] = [];
    for await (const f of glob.scan({ cwd: tracesDir, onlyFiles: true })) {
      found.push(f);
    }
    entries = found;
  } catch {
    return emptyMatrix;
  }

  if (entries.length === 0) return emptyMatrix;

  const records: TraceRecord[] = [];
  for (const filename of entries) {
    const path = join(tracesDir, filename);
    try {
      const raw = await Bun.file(path).json();
      // Accept both a single record or an array of records per file.
      const batch: unknown[] = Array.isArray(raw) ? raw : [raw];
      for (const item of batch) {
        if (
          item !== null &&
          typeof item === "object" &&
          "model" in item &&
          "success" in item &&
          "latency_ms" in item &&
          "total_tokens" in item
        ) {
          const rec = item as TraceRecord;
          // Live EventBus traces store query_type in tags[0].
          // If the standalone field is missing, promote tags[0] into it.
          const resolved: TraceRecord =
            rec.query_type
              ? rec
              : { ...rec, query_type: rec.tags?.[0] };
          records.push(resolved);
        }
      }
    } catch {
      // Skip unparseable files — fail open.
      continue;
    }
  }

  if (records.length === 0) return emptyMatrix;

  return {
    version: MATRIX_VERSION,
    built_at: new Date().toISOString(),
    cells: aggregateCells(records),
    min_samples_threshold: DEFAULT_MIN_SAMPLES,
  };
}

/**
 * Atomically write a ConfidenceMatrix to data/routing-matrix.json.
 * Uses a temp file + rename to avoid partial writes.
 */
export async function saveMatrix(
  matrix: ConfidenceMatrix,
  dir: string = "data",
): Promise<void> {
  const target = join(dir, MATRIX_FILENAME);
  const tmp = `${target}.tmp`;
  const payload = JSON.stringify(matrix, null, 2);

  await Bun.write(tmp, payload);
  // Bun does not expose fs.rename directly; use node:fs for atomic rename.
  const { rename } = await import("node:fs/promises");
  await rename(tmp, target);
}

/**
 * Load a previously saved ConfidenceMatrix.
 * Returns null if the file is missing or unreadable.
 */
export async function loadMatrix(
  dir: string = "data",
): Promise<ConfidenceMatrix | null> {
  const path = join(dir, MATRIX_FILENAME);
  try {
    const raw = await Bun.file(path).json();
    if (
      raw !== null &&
      typeof raw === "object" &&
      Array.isArray(raw.cells)
    ) {
      return raw as ConfidenceMatrix;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compute the composite score for a single cell relative to its peer cells
 * (cells sharing the same query_type).
 *
 * Score = 0.6 * success_rate + 0.4 * (1 - normalized_latency)
 *
 * Normalized latency maps [min, max] latency among peers to [0, 1].
 * If all peers have identical latency the normalized value is 0 (best).
 */
export function compositeScore(
  cell: MatrixCell,
  allCells: readonly MatrixCell[],
): number {
  const peers = allCells.filter((c) => c.query_type === cell.query_type);

  const latencies = peers.map((c) => c.avg_latency_ms);
  const minLat = Math.min(...latencies);
  const maxLat = Math.max(...latencies);

  const range = maxLat - minLat;
  const normalizedLatency =
    range === 0 ? 0 : (cell.avg_latency_ms - minLat) / range;

  return 0.6 * cell.success_rate + 0.4 * (1 - normalizedLatency);
}

/**
 * Find the best model for a given queryType using empirical data.
 *
 * Returns null when:
 *  - No cells exist for this queryType.
 *  - The best cell has fewer samples than minSamples (falls back to heuristics).
 *
 * confidence = Math.min(sample_count / 20, 1.0)
 */
export function queryMatrix(
  matrix: ConfidenceMatrix,
  queryType: QueryType,
  minSamples: number = matrix.min_samples_threshold,
): DataDrivenDecision | null {
  const candidates = matrix.cells.filter((c) => c.query_type === queryType);

  if (candidates.length === 0) return null;

  const scored = candidates.map((cell) => ({
    cell,
    score: compositeScore(cell, matrix.cells),
  }));

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.cell.sample_count < minSamples) return null;

  const confidence = Math.min(
    best.cell.sample_count / CONFIDENCE_SATURATION_SAMPLES,
    1.0,
  );

  return {
    model_name: best.cell.model_name,
    query_type: queryType,
    confidence,
    reasoning:
      `data-driven: ${best.cell.sample_count} samples, ` +
      `success_rate=${best.cell.success_rate.toFixed(2)}, ` +
      `avg_latency=${best.cell.avg_latency_ms.toFixed(0)}ms, ` +
      `composite_score=${best.score.toFixed(3)}`,
    cell: best.cell,
  };
}
