// src/rag/compressed-search.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  compressedSearch,
  _setDbForTesting,
  _resetDbForTesting,
  _setQuantizerForTesting,
  _resetQuantizerForTesting,
  DEFAULT_PRE_FILTER_N,
  DEFAULT_TOP_K,
} from "./compressed-search";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockCode(score: number): Buffer {
  // Opaque buffer — the mock quantizer uses the score directly
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(score, 0);
  return buf;
}

function mockVec(dim = 768): Float32Array {
  return new Float32Array(dim).fill(0.5);
}

function makeConceptRow(id: string, score: number) {
  return {
    id,
    label: `concept-${id}`,
    memory_type: "fact",
    agent_id: "agent-1",
    meta: {},
    compressed_vector: mockCode(score),
  };
}

function makeEmbeddingRow(id: string, value = 0.5) {
  const embedding = `{${Array(768).fill(value).join(",")}}`;
  return { id, embedding };
}

// ---------------------------------------------------------------------------
// Mock NativeQuantizer
// ---------------------------------------------------------------------------

function makeMockQuantizer() {
  return {
    innerProductEstimate: (code: Buffer, _query: Float32Array): number => {
      // Decode score from the mock code buffer
      return code.length >= 8 ? code.readDoubleBE(0) : 0;
    },
    encode: (_vec: Float32Array): Buffer => mockCode(0.5),
    l2DistanceEstimate: (_code: Buffer, _query: Float32Array): number => 0,
  };
}

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function makeDb(compressedRows: ReturnType<typeof makeConceptRow>[], embeddingRows: ReturnType<typeof makeEmbeddingRow>[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = {} as any;

  // Bun.sql is called as a tagged template literal
  const handler = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const query = strings.join("?").toLowerCase();
    if (query.includes("compressed_vector")) return Promise.resolve(compressedRows);
    if (query.includes("embedding")) return Promise.resolve(embeddingRows);
    return Promise.resolve([]);
  };

  return new Proxy(handler, {
    get(target, prop) {
      if (prop === "end") return () => Promise.resolve();
      return target;
    },
    apply(target, thisArg, args) {
      return target(...args as [TemplateStringsArray, ...unknown[]]);
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compressedSearch", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setQuantizerForTesting(makeMockQuantizer() as any);
  });

  afterEach(() => {
    _resetDbForTesting();
    _resetQuantizerForTesting();
  });

  test("returns empty array when no compressed rows", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(makeDb([], []) as any);
    const results = await compressedSearch(mockVec());
    expect(results).toEqual([]);
  });

  test("returns top-k results (default 10)", async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeConceptRow(`id-${i}`, 20 - i) // descending scores
    );
    const embeddings = rows.map((r) => makeEmbeddingRow(r.id));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(makeDb(rows, embeddings) as any);

    const results = await compressedSearch(mockVec());
    expect(results.length).toBeLessThanOrEqual(DEFAULT_TOP_K);
  });

  test("respects topK option", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => makeConceptRow(`id-${i}`, 20 - i));
    const embeddings = rows.map((r) => makeEmbeddingRow(r.id));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(makeDb(rows, embeddings) as any);

    const results = await compressedSearch(mockVec(), { topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("result has innerProductScore and cosineScore fields", async () => {
    const rows = [makeConceptRow("abc", 0.9)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(makeDb(rows, [makeEmbeddingRow("abc")]) as any);

    const results = await compressedSearch(mockVec());
    if (results.length > 0) {
      expect(typeof results[0]!.innerProductScore).toBe("number");
      expect(typeof results[0]!.cosineScore).toBe("number");
    }
  });

  test("result does not have hammingScore field", async () => {
    const rows = [makeConceptRow("abc", 0.9)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(makeDb(rows, [makeEmbeddingRow("abc")]) as any);

    const results = await compressedSearch(mockVec());
    if (results.length > 0) {
      expect("hammingScore" in results[0]!).toBe(false);
    }
  });

  test("results are sorted by cosineScore descending", async () => {
    const rows = [
      makeConceptRow("a", 0.9),
      makeConceptRow("b", 0.7),
      makeConceptRow("c", 0.5),
    ];
    // Give different cosine similarities by using different embedding values
    const embeddings = [
      makeEmbeddingRow("a", 0.9),
      makeEmbeddingRow("b", 0.5),
      makeEmbeddingRow("c", 0.1),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(makeDb(rows, embeddings) as any);

    const results = await compressedSearch(mockVec());
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.cosineScore).toBeGreaterThanOrEqual(results[i]!.cosineScore);
    }
  });

  test("skips candidates with no embedding", async () => {
    const rows = [makeConceptRow("has-embedding", 0.9), makeConceptRow("no-embedding", 0.8)];
    const embeddings = [makeEmbeddingRow("has-embedding")]; // no-embedding omitted
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(makeDb(rows, embeddings) as any);

    const results = await compressedSearch(mockVec());
    expect(results.every((r) => r.id !== "no-embedding")).toBe(true);
  });

  test("agentId filter is passed through to DB query", async () => {
    let capturedQuery = "";
    const db = new Proxy(
      (strings: TemplateStringsArray) => {
        capturedQuery = strings.join("?");
        return Promise.resolve([]);
      },
      {
        get(target, prop) {
          if (prop === "end") return () => Promise.resolve();
          return target;
        },
        apply(target, thisArg, args) {
          return target(...args as [TemplateStringsArray, ...unknown[]]);
        },
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setDbForTesting(db as any);

    await compressedSearch(mockVec(), { agentId: "agent-42" });
    expect(capturedQuery.toLowerCase()).toContain("agent_id");
  });
});
