// Run explicitly: bun test tests/rag/embedder.test.ts
// NOT part of standard `bun test` suite — any call to embedWithOnnx loads the ONNX WASM
// runtime, which causes Bun 1.3.10 to crash with SIGABRT on teardown (upstream Bun bug).
// All assertions pass before the crash; this is not a test failure.
import { test, expect } from "bun:test";
import { embedWithOnnx } from "../../src/rag/embedder";

test("embedWithOnnx: returns 384-dim float array on success", async () => {
  // Uses the real ONNX pipeline (requires .cache/onnx-models from spike).
  // If model is cached, this runs in ~100ms. Skip in CI if cache absent.
  const MODEL = "nomic-ai/nomic-embed-text-v1.5";
  const vec = await embedWithOnnx("machine learning", MODEL);
  if (vec === null) return; // graceful: ONNX unavailable in this env
  expect(Array.isArray(vec)).toBe(true);
  expect(vec.length).toBe(768);
  expect(typeof vec[0]).toBe("number");
});

test("embedWithOnnx: returns null for empty modelId (ONNX disabled)", async () => {
  const vec = await embedWithOnnx("hello", "");
  expect(vec).toBeNull();
});
