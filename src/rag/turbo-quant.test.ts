// src/rag/turbo-quant.test.ts
import { test, expect, describe } from "bun:test";
import {
  buildProjectionMatrix,
  project,
  quantize,
  compress,
  hammingDistance,
  FULL_DIM,
  PROJ_DIM,
} from "./turbo-quant.ts";

// Helper: create a Float32Array filled with a constant value
function filledVec(dim: number, value: number): Float32Array {
  return new Float32Array(dim).fill(value);
}

// Helper: create a random-ish float32 vector from a seed (deterministic)
function seededVec(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v[i] = (s / 0xffffffff) * 2 - 1;
  }
  return v;
}

describe("buildProjectionMatrix", () => {
  test("returns Float32Array of size PROJ_DIM * FULL_DIM", () => {
    const matrix = buildProjectionMatrix(42);
    expect(matrix).toBeInstanceOf(Float32Array);
    expect(matrix.length).toBe(PROJ_DIM * FULL_DIM);
  });

  test("same seed produces identical matrix (determinism)", () => {
    const m1 = buildProjectionMatrix(42);
    const m2 = buildProjectionMatrix(42);
    expect(m1.length).toBe(m2.length);
    for (let i = 0; i < m1.length; i++) {
      expect(m1[i]).toBe(m2[i]);
    }
  });

  test("different seeds produce different matrices", () => {
    const m1 = buildProjectionMatrix(42);
    const m2 = buildProjectionMatrix(99);
    let diffs = 0;
    for (let i = 0; i < m1.length; i++) {
      if (m1[i] !== m2[i]) diffs++;
    }
    // Virtually all entries should differ
    expect(diffs).toBeGreaterThan(PROJ_DIM * FULL_DIM * 0.99);
  });
});

describe("project", () => {
  test("output has PROJ_DIM elements", () => {
    const matrix = buildProjectionMatrix(42);
    const vec = filledVec(FULL_DIM, 1.0);
    const out = project(vec, matrix);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(PROJ_DIM);
  });

  test("zero vector projects to zero vector", () => {
    const matrix = buildProjectionMatrix(42);
    const vec = filledVec(FULL_DIM, 0.0);
    const out = project(vec, matrix);
    for (const v of out) {
      expect(v).toBe(0);
    }
  });
});

describe("quantize", () => {
  test("output is exactly 32 bytes", () => {
    const projected = filledVec(PROJ_DIM, 1.0);
    const bytes = quantize(projected);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  test("all-positive projected yields all 0xFF bytes", () => {
    const projected = filledVec(PROJ_DIM, 1.0);
    const bytes = quantize(projected);
    for (const b of bytes) {
      expect(b).toBe(0xff);
    }
  });

  test("all-negative projected yields all 0x00 bytes", () => {
    const projected = filledVec(PROJ_DIM, -1.0);
    const bytes = quantize(projected);
    for (const b of bytes) {
      expect(b).toBe(0x00);
    }
  });
});

describe("compress", () => {
  test("output is exactly 32 bytes", () => {
    const matrix = buildProjectionMatrix(42);
    const vec = seededVec(FULL_DIM, 123);
    const code = compress(vec, matrix);
    expect(code).toBeInstanceOf(Uint8Array);
    expect(code.length).toBe(32);
  });

  test("same input always yields same code", () => {
    const matrix = buildProjectionMatrix(42);
    const vec = seededVec(FULL_DIM, 456);
    const c1 = compress(vec, matrix);
    const c2 = compress(vec, matrix);
    for (let i = 0; i < c1.length; i++) {
      expect(c1[i]).toBe(c2[i]);
    }
  });
});

describe("hammingDistance", () => {
  test("hammingDistance(a, a) === 0", () => {
    const matrix = buildProjectionMatrix(42);
    const vec = seededVec(FULL_DIM, 789);
    const code = compress(vec, matrix);
    expect(hammingDistance(code, code)).toBe(0);
  });

  test("hammingDistance(a, b) <= 256", () => {
    const matrix = buildProjectionMatrix(42);
    const a = compress(seededVec(FULL_DIM, 1), matrix);
    const b = compress(seededVec(FULL_DIM, 2), matrix);
    expect(hammingDistance(a, b)).toBeGreaterThanOrEqual(0);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(256);
  });

  test("hammingDistance is symmetric", () => {
    const matrix = buildProjectionMatrix(42);
    const a = compress(seededVec(FULL_DIM, 10), matrix);
    const b = compress(seededVec(FULL_DIM, 20), matrix);
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  test("similar vectors have lower Hamming distance than dissimilar ones", () => {
    const matrix = buildProjectionMatrix(42);

    // Similar pair: nearly identical vectors (small perturbation)
    const base = seededVec(FULL_DIM, 999);
    const similar = new Float32Array(base);
    // Perturb very slightly
    for (let i = 0; i < 10; i++) {
      similar[i] = (similar[i] ?? 0) + 0.001;
    }

    // Dissimilar pair: orthogonal-ish vectors (first half positive, second half negative vs reversed)
    const dissimilarA = new Float32Array(FULL_DIM);
    const dissimilarB = new Float32Array(FULL_DIM);
    for (let i = 0; i < FULL_DIM; i++) {
      dissimilarA[i] = i < FULL_DIM / 2 ? 1.0 : -1.0;
      dissimilarB[i] = i < FULL_DIM / 2 ? -1.0 : 1.0;
    }

    const codeBase = compress(base, matrix);
    const codeSimilar = compress(similar, matrix);
    const codeDisA = compress(dissimilarA, matrix);
    const codeDisB = compress(dissimilarB, matrix);

    const distSimilar = hammingDistance(codeBase, codeSimilar);
    const distDissimilar = hammingDistance(codeDisA, codeDisB);

    expect(distSimilar).toBeLessThan(distDissimilar);
  });
});
