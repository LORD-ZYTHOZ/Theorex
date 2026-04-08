/**
 * encoder.test.ts — unit tests for AAAK encoder
 * Uses mocked fetch to avoid requiring a live Ollama instance.
 */

import { test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { compressToAaak } from "./encoder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_TEXT =
  "Secretarius manages Singularity strategy. Uses MiniMax primary model. " +
  "Session 2026-04-08 showed +2.3% on XAUUSD with London session filter active.";

const SAMPLE_AAAK =
  "SECT(minder,singularity) | MODEL: minimax.primary | SESSION:2026-04-08 XAUUSD+2.3%(london.filter) ★★★";

function makeOkResponse(responseText: string): Response {
  return new Response(JSON.stringify({ response: responseText }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeErrorResponse(status: number): Response {
  return new Response("error", { status });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("successful compression returns compressed string and ratio > 1", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    makeOkResponse(SAMPLE_AAAK),
  );

  const result = await compressToAaak(SAMPLE_TEXT);

  expect(result.compressed).toBe(SAMPLE_AAAK);
  expect(result.ratio).toBeGreaterThan(1);

  fetchSpy.mockRestore();
});

test("Ollama unreachable returns fallback { compressed: originalText, ratio: 1 }", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(
    new TypeError("fetch failed: ECONNREFUSED"),
  );

  const result = await compressToAaak(SAMPLE_TEXT);

  expect(result.compressed).toBe(SAMPLE_TEXT);
  expect(result.ratio).toBe(1);

  fetchSpy.mockRestore();
});

test("Ollama returns non-ok status falls back gracefully", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    makeErrorResponse(503),
  );

  const result = await compressToAaak(SAMPLE_TEXT);

  expect(result.compressed).toBe(SAMPLE_TEXT);
  expect(result.ratio).toBe(1);

  fetchSpy.mockRestore();
});

test("Ollama returns empty response falls back gracefully", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    makeOkResponse(""),
  );

  const result = await compressToAaak(SAMPLE_TEXT);

  expect(result.compressed).toBe(SAMPLE_TEXT);
  expect(result.ratio).toBe(1);

  fetchSpy.mockRestore();
});

test("ratio is calculated correctly", async () => {
  // 4-word input → 2-word compressed → ratio = Math.round(4/2) = 2
  const input = "word one two three";
  const compressed = "aaak one";

  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    makeOkResponse(compressed),
  );

  const result = await compressToAaak(input);

  const expectedRatio = Math.round(
    input.split(" ").length / compressed.split(" ").length,
  );
  expect(result.ratio).toBe(expectedRatio);

  fetchSpy.mockRestore();
});

test("custom ollamaUrl is used in the fetch call", async () => {
  const customUrl = "http://custom-host:9999";
  let capturedUrl = "";

  const fetchSpy = spyOn(globalThis, "fetch").mockImplementationOnce(
    async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return makeOkResponse(SAMPLE_AAAK);
    },
  );

  await compressToAaak(SAMPLE_TEXT, { ollamaUrl: customUrl });

  expect(capturedUrl).toStartWith(customUrl);

  fetchSpy.mockRestore();
});
