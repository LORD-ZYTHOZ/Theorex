// tests/short-term/embedder.test.ts — TDD RED phase: all tests should FAIL until embedder.ts is implemented

import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { embedText, cosineSimilarity } from "../../src/short-term/embedder.ts";

// Store original fetch so we can restore it
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Test 1: embedText returns number[] on mocked 200 response
test("embedText returns number[] on 200 response", async () => {
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  ) as any;

  const result = await embedText("hello world");
  expect(result).toEqual([0.1, 0.2, 0.3]);
});

// Test 2: embedText returns null when fetch throws (ECONNREFUSED simulation)
test("embedText returns null when fetch throws", async () => {
  globalThis.fetch = mock(async () => {
    throw new Error("ECONNREFUSED");
  }) as any;

  const result = await embedText("hello world");
  expect(result).toBeNull();
});

// Test 3: embedText returns null on non-200 status (400)
test("embedText returns null on 400 status", async () => {
  globalThis.fetch = mock(async () =>
    new Response("Bad Request", { status: 400 })
  ) as any;

  const result = await embedText("hello world");
  expect(result).toBeNull();
});

// Test 4: embedText returns null after timeout
test("embedText returns null after timeout (50ms)", async () => {
  // Mock fetch that respects the AbortSignal — rejects when signal is aborted
  globalThis.fetch = mock(async (_url: string, opts?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = opts?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      // Never resolves on its own — will be aborted by the timeout
    });
  }) as any;

  const start = Date.now();
  const result = await embedText(
    "hello world",
    "http://localhost:1234",
    "nomic-embed-text-v1.5",
    50 // 50ms timeout for test
  );
  const elapsed = Date.now() - start;

  expect(result).toBeNull();
  // Should complete within ~500ms (50ms timeout + some buffer)
  expect(elapsed).toBeLessThan(500);
});

// Test 5: cosineSimilarity([1,0],[1,0]) === 1.0 (identical vectors)
test("cosineSimilarity returns 1.0 for identical vectors", () => {
  const result = cosineSimilarity([1, 0], [1, 0]);
  expect(result).toBeCloseTo(1.0, 10);
});

// Test 6: cosineSimilarity([1,0],[0,1]) === 0.0 (orthogonal vectors)
test("cosineSimilarity returns 0.0 for orthogonal vectors", () => {
  const result = cosineSimilarity([1, 0], [0, 1]);
  expect(result).toBeCloseTo(0.0, 10);
});

// Test 7: cosineSimilarity handles large vectors (2000-element) without stack overflow
test("cosineSimilarity handles 2000-element vectors without stack overflow", () => {
  const size = 2000;
  const a = Array.from({ length: size }, (_, i) => Math.sin(i));
  const b = Array.from({ length: size }, (_, i) => Math.cos(i));

  // Should not throw - uses reduce() not Math.hypot(...vec) spread
  expect(() => cosineSimilarity(a, b)).not.toThrow();
  const result = cosineSimilarity(a, b);
  expect(typeof result).toBe("number");
  expect(result).toBeGreaterThanOrEqual(-1);
  expect(result).toBeLessThanOrEqual(1);
});
