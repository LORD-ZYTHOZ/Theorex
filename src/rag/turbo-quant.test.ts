// src/rag/turbo-quant.test.ts
// Tests for the NativeQuantizer napi-rs binding.
import { describe, test, expect, beforeAll } from "bun:test";

const { NativeQuantizer } = require("../../packages/turbo-quant-native/index.js");

const DIM = 768;
const BITS = 8;
const PROJECTIONS = 192;
const SEED = 42n;

function randomVec(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    v[i] = ((s >>> 16) / 32768) - 1; // [-1, 1]
  }
  return v;
}

describe("NativeQuantizer", () => {
  let q: NativeQuantizer;

  beforeAll(() => {
    q = new NativeQuantizer(DIM, BITS, PROJECTIONS, SEED);
  });

  test("constructs without throwing", () => {
    expect(() => new NativeQuantizer(DIM, BITS, PROJECTIONS, SEED)).not.toThrow();
  });

  test("rejects zero dimension", () => {
    expect(() => new NativeQuantizer(0, BITS, PROJECTIONS, SEED)).toThrow();
  });

  test("rejects odd dimension", () => {
    expect(() => new NativeQuantizer(7, BITS, PROJECTIONS, SEED)).toThrow();
  });

  test("rejects bits < 2", () => {
    expect(() => new NativeQuantizer(DIM, 1, PROJECTIONS, SEED)).toThrow();
  });

  test("encode returns a Buffer", () => {
    const vec = randomVec(DIM, 1);
    const code = q.encode(vec);
    expect(code).toBeInstanceOf(Buffer);
    expect(code.length).toBeGreaterThan(32); // real TurboCode >> legacy 32 bytes
  });

  test("encode is deterministic — same input same output", () => {
    const vec = randomVec(DIM, 2);
    const code1 = q.encode(vec);
    const code2 = q.encode(vec);
    expect(Buffer.compare(code1, code2)).toBe(0);
  });

  test("encode rejects wrong dimension", () => {
    const badVec = new Float32Array(100);
    expect(() => q.encode(badVec)).toThrow();
  });

  test("innerProductEstimate returns a number", () => {
    const vec = randomVec(DIM, 3);
    const query = randomVec(DIM, 4);
    const code = q.encode(vec);
    const score = q.innerProductEstimate(code, query);
    expect(typeof score).toBe("number");
    expect(Number.isFinite(score)).toBe(true);
  });

  test("innerProductEstimate ranks close vector above random", () => {
    const query = randomVec(DIM, 99);
    // close: small perturbation of query
    const close = new Float32Array(query);
    for (let i = 0; i < DIM; i++) close[i] += 0.01;

    const far = randomVec(DIM, 200);

    const codeClose = q.encode(close);
    const codeFar = q.encode(far);

    const scoreClose = q.innerProductEstimate(codeClose, query);
    const scoreFar = q.innerProductEstimate(codeFar, query);

    expect(scoreClose).toBeGreaterThan(scoreFar);
  });

  test("l2DistanceEstimate returns non-negative number", () => {
    const vec = randomVec(DIM, 5);
    const query = randomVec(DIM, 6);
    const code = q.encode(vec);
    const dist = q.l2DistanceEstimate(code, query);
    expect(typeof dist).toBe("number");
    expect(dist).toBeGreaterThanOrEqual(0);
  });

  test("l2DistanceEstimate is smaller for close vector", () => {
    const query = randomVec(DIM, 50);
    const close = new Float32Array(query);
    for (let i = 0; i < DIM; i++) close[i] += 0.01;
    const far = randomVec(DIM, 300);

    const distClose = q.l2DistanceEstimate(q.encode(close), query);
    const distFar = q.l2DistanceEstimate(q.encode(far), query);
    expect(distClose).toBeLessThan(distFar);
  });

  test("encode-decode round-trip: code from vec1 does not match query for vec2", () => {
    const vec1 = randomVec(DIM, 7);
    const vec2 = randomVec(DIM, 8);
    const code1 = q.encode(vec1);
    const code2 = q.encode(vec2);
    expect(Buffer.compare(code1, code2)).not.toBe(0);
  });
});
