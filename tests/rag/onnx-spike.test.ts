import { test, expect } from "bun:test";

// Run explicitly: bun test --test-name-pattern "ONNX spike" tests/rag/onnx-spike.test.ts
// NOT part of standard bun test suite (downloads 22MB model on first run).
test("ONNX spike: @huggingface/transformers loads and embeds in Bun", async () => {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = "./.cache/onnx-models";
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "cpu" });
  const out = await extractor(["hello world"], { pooling: "mean", normalize: true });
  const vec = (out.tolist()[0]) as number[];
  expect(vec).toHaveLength(384);
  expect(typeof vec[0]).toBe("number");
  expect(Math.abs(vec[0])).toBeLessThan(1.1); // normalized values
}, 60_000);
