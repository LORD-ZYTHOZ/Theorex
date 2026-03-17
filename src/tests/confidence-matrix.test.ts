// tests/confidence-matrix.test.ts — Phase 15.5 trace-driven routing matrix tests.
// Covers: buildMatrix with empty/missing dir, queryMatrix on empty matrix,
// compositeScore ranking logic.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildMatrix,
  queryMatrix,
  compositeScore,
  saveMatrix,
  loadMatrix,
  type MatrixCell,
  type ConfidenceMatrix,
} from "../router/confidence-matrix";

const TMP = join(tmpdir(), "theorex-confidence-matrix-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// buildMatrix — empty / missing directory
// ---------------------------------------------------------------------------

describe("buildMatrix()", () => {
  test("missing tracesDir returns empty matrix without crashing", async () => {
    const matrix = await buildMatrix(join(TMP, "does-not-exist"));
    expect(matrix.cells).toEqual([]);
    expect(Array.isArray(matrix.cells)).toBe(true);
    expect(matrix.version).toBeGreaterThan(0);
    expect(typeof matrix.built_at).toBe("string");
    expect(new Date(matrix.built_at).getFullYear()).toBeGreaterThan(2020);
  });

  test("empty tracesDir returns empty matrix without crashing", async () => {
    const emptyDir = join(TMP, "empty-traces");
    await mkdir(emptyDir, { recursive: true });
    const matrix = await buildMatrix(emptyDir);
    expect(matrix.cells).toEqual([]);
    expect(matrix.min_samples_threshold).toBeGreaterThan(0);
  });

  test("tracesDir with valid trace files aggregates into cells", async () => {
    const tracesDir = join(TMP, "valid-traces");
    await mkdir(tracesDir, { recursive: true });

    // Write two trace files
    const trace1 = {
      id: crypto.randomUUID(),
      model: "qwen3-32b",
      query_type: "code",
      success: true,
      latency_ms: 500,
      total_tokens: 400,
    };
    const trace2 = {
      id: crypto.randomUUID(),
      model: "qwen3-32b",
      query_type: "code",
      success: false,
      latency_ms: 1000,
      total_tokens: 300,
    };

    await Bun.write(join(tracesDir, `${trace1.id}.json`), JSON.stringify(trace1));
    await Bun.write(join(tracesDir, `${trace2.id}.json`), JSON.stringify(trace2));

    const matrix = await buildMatrix(tracesDir);
    expect(matrix.cells.length).toBeGreaterThan(0);

    const cell = matrix.cells.find(
      (c) => c.model_name === "qwen3-32b" && c.query_type === "code"
    );
    expect(cell).toBeDefined();
    expect(cell?.sample_count).toBe(2);
    expect(cell?.success_rate).toBeCloseTo(0.5, 2);
    expect(cell?.avg_latency_ms).toBeCloseTo(750, 0);
  });

  test("tracesDir with malformed files skips them gracefully", async () => {
    const tracesDir = join(TMP, "malformed-traces");
    await mkdir(tracesDir, { recursive: true });

    await Bun.write(join(tracesDir, "bad.json"), "NOT VALID JSON {{{");
    const goodTrace = {
      id: crypto.randomUUID(),
      model: "ministral-3b",
      query_type: "general",
      success: true,
      latency_ms: 200,
      total_tokens: 100,
    };
    await Bun.write(join(tracesDir, `${goodTrace.id}.json`), JSON.stringify(goodTrace));

    const matrix = await buildMatrix(tracesDir);
    // Good trace was processed, bad trace was skipped
    const cell = matrix.cells.find((c) => c.model_name === "ministral-3b");
    expect(cell).toBeDefined();
    expect(cell?.sample_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// queryMatrix — empty matrix
// ---------------------------------------------------------------------------

describe("queryMatrix()", () => {
  test("queryMatrix on empty matrix returns null", () => {
    const emptyMatrix: ConfidenceMatrix = {
      version: 1,
      built_at: new Date().toISOString(),
      cells: [],
      min_samples_threshold: 5,
    };
    const result = queryMatrix(emptyMatrix, "code");
    expect(result).toBeNull();
  });

  test("queryMatrix returns null when no cells match the query_type", () => {
    const matrix: ConfidenceMatrix = {
      version: 1,
      built_at: new Date().toISOString(),
      cells: [
        {
          query_type: "math",
          model_name: "qwen3-32b",
          success_rate: 0.9,
          avg_latency_ms: 400,
          avg_cost_tokens: 300,
          sample_count: 10,
          last_updated: new Date().toISOString(),
        },
      ],
      min_samples_threshold: 5,
    };
    const result = queryMatrix(matrix, "code");
    expect(result).toBeNull();
  });

  test("queryMatrix returns null when best cell has fewer samples than threshold", () => {
    const matrix: ConfidenceMatrix = {
      version: 1,
      built_at: new Date().toISOString(),
      cells: [
        {
          query_type: "code",
          model_name: "qwen3-32b",
          success_rate: 0.9,
          avg_latency_ms: 300,
          avg_cost_tokens: 200,
          sample_count: 3, // below default threshold of 5
          last_updated: new Date().toISOString(),
        },
      ],
      min_samples_threshold: 5,
    };
    const result = queryMatrix(matrix, "code");
    expect(result).toBeNull();
  });

  test("queryMatrix returns DataDrivenDecision when samples >= threshold", () => {
    const matrix: ConfidenceMatrix = {
      version: 1,
      built_at: new Date().toISOString(),
      cells: [
        {
          query_type: "code",
          model_name: "qwen3-32b",
          success_rate: 0.9,
          avg_latency_ms: 300,
          avg_cost_tokens: 200,
          sample_count: 10,
          last_updated: new Date().toISOString(),
        },
      ],
      min_samples_threshold: 5,
    };
    const result = queryMatrix(matrix, "code");
    expect(result).not.toBeNull();
    expect(result?.model_name).toBe("qwen3-32b");
    expect(result?.query_type).toBe("code");
    expect(result?.confidence).toBeGreaterThan(0);
    expect(typeof result?.reasoning).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// compositeScore — ranking logic
// ---------------------------------------------------------------------------

describe("compositeScore()", () => {
  test("cell with success_rate=1.0 and avg_latency=100ms vs success_rate=0.5 and avg_latency=50ms", () => {
    // The formula is: score = 0.6 * success_rate + 0.4 * (1 - normalizedLatency)
    // highSuccess: normalizedLatency = (100-50)/50 = 1.0 → score = 0.6*1.0 + 0.4*0.0 = 0.60
    // lowSuccess:  normalizedLatency = (50-50)/50  = 0.0 → score = 0.6*0.5 + 0.4*1.0 = 0.70
    // The latency penalty at equal-distance extremes means lowSuccess wins on latency.
    const highSuccess: MatrixCell = {
      query_type: "code",
      model_name: "qwen3-32b",
      success_rate: 1.0,
      avg_latency_ms: 100,
      avg_cost_tokens: 300,
      sample_count: 10,
      last_updated: new Date().toISOString(),
    };
    const lowSuccess: MatrixCell = {
      query_type: "code",
      model_name: "ministral-3b",
      success_rate: 0.5,
      avg_latency_ms: 50,
      avg_cost_tokens: 100,
      sample_count: 10,
      last_updated: new Date().toISOString(),
    };
    const allCells = [highSuccess, lowSuccess];

    const scoreHigh = compositeScore(highSuccess, allCells);
    const scoreLow = compositeScore(lowSuccess, allCells);

    expect(scoreHigh).toBeCloseTo(0.6, 3);
    expect(scoreLow).toBeCloseTo(0.7, 3);
    // Lower latency compensates for lower success_rate in this config
    expect(scoreLow).toBeGreaterThan(scoreHigh);
  });

  test("when two cells have identical latency, higher success_rate scores higher", () => {
    const good: MatrixCell = {
      query_type: "general",
      model_name: "qwen3-32b",
      success_rate: 0.9,
      avg_latency_ms: 200,
      avg_cost_tokens: 300,
      sample_count: 10,
      last_updated: new Date().toISOString(),
    };
    const bad: MatrixCell = {
      query_type: "general",
      model_name: "ministral-3b",
      success_rate: 0.3,
      avg_latency_ms: 200,
      avg_cost_tokens: 100,
      sample_count: 10,
      last_updated: new Date().toISOString(),
    };
    const allCells = [good, bad];

    const scoreGood = compositeScore(good, allCells);
    const scoreBad = compositeScore(bad, allCells);

    expect(scoreGood).toBeGreaterThan(scoreBad);
  });

  test("single cell in its query_type has normalized latency 0 → score = 0.6 * success_rate + 0.4", () => {
    const cell: MatrixCell = {
      query_type: "math",
      model_name: "qwen3-32b",
      success_rate: 0.8,
      avg_latency_ms: 500,
      avg_cost_tokens: 400,
      sample_count: 6,
      last_updated: new Date().toISOString(),
    };
    const score = compositeScore(cell, [cell]);
    // normalizedLatency = 0 (only peer), so score = 0.6 * 0.8 + 0.4 * 1 = 0.88
    expect(score).toBeCloseTo(0.88, 3);
  });

  test("score is in range [0, 1]", () => {
    const cellA: MatrixCell = {
      query_type: "retrieval",
      model_name: "qwen3-32b",
      success_rate: 0.0,
      avg_latency_ms: 1000,
      avg_cost_tokens: 500,
      sample_count: 5,
      last_updated: new Date().toISOString(),
    };
    const cellB: MatrixCell = {
      query_type: "retrieval",
      model_name: "ministral-3b",
      success_rate: 1.0,
      avg_latency_ms: 100,
      avg_cost_tokens: 100,
      sample_count: 5,
      last_updated: new Date().toISOString(),
    };
    const allCells = [cellA, cellB];

    const scoreA = compositeScore(cellA, allCells);
    const scoreB = compositeScore(cellB, allCells);

    expect(scoreA).toBeGreaterThanOrEqual(0);
    expect(scoreA).toBeLessThanOrEqual(1);
    expect(scoreB).toBeGreaterThanOrEqual(0);
    expect(scoreB).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// saveMatrix / loadMatrix round-trip
// ---------------------------------------------------------------------------

describe("saveMatrix / loadMatrix", () => {
  test("saved matrix can be loaded back unchanged", async () => {
    const dir = join(TMP, "matrix-rw");
    await mkdir(dir, { recursive: true });

    const matrix: ConfidenceMatrix = {
      version: 1,
      built_at: new Date().toISOString(),
      cells: [
        {
          query_type: "code",
          model_name: "qwen3-32b",
          success_rate: 0.9,
          avg_latency_ms: 350,
          avg_cost_tokens: 300,
          sample_count: 7,
          last_updated: new Date().toISOString(),
        },
      ],
      min_samples_threshold: 5,
    };

    await saveMatrix(matrix, dir);
    const loaded = await loadMatrix(dir);
    expect(loaded).not.toBeNull();
    expect(loaded?.cells.length).toBe(1);
    expect(loaded?.cells[0]!.model_name).toBe("qwen3-32b");
    expect(loaded?.cells[0]!.success_rate).toBeCloseTo(0.9, 3);
  });

  test("loadMatrix returns null for a missing directory", async () => {
    const result = await loadMatrix(join(TMP, "no-such-dir"));
    expect(result).toBeNull();
  });
});
