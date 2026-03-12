import { describe, expect, test } from "bun:test";
import { resolveAlias, registerAliases, ALIASES } from "../src/synonyms";

describe("resolveAlias", () => {
  test("resolves 'ml' to 'machine learning'", () => {
    expect(resolveAlias("ml")).toBe("machine learning");
  });

  test("resolves 'ai' to 'artificial intelligence'", () => {
    expect(resolveAlias("ai")).toBe("artificial intelligence");
  });

  test("resolves 'nlp' to 'natural language processing'", () => {
    expect(resolveAlias("nlp")).toBe("natural language processing");
  });

  test("resolves 'llm' to 'large language model'", () => {
    expect(resolveAlias("llm")).toBe("large language model");
  });

  test("resolves 'rag' to 'retrieval augmented generation'", () => {
    expect(resolveAlias("rag")).toBe("retrieval augmented generation");
  });

  test("returns unchanged input for unknown alias 'typescript'", () => {
    expect(resolveAlias("typescript")).toBe("typescript");
  });

  test("is case-insensitive — 'ML' resolves to 'machine learning'", () => {
    expect(resolveAlias("ML")).toBe("machine learning");
  });

  test("handles empty string without crash", () => {
    expect(resolveAlias("")).toBe("");
  });

  test("is pure — same input always returns same output", () => {
    const first = resolveAlias("ai");
    const second = resolveAlias("ai");
    const third = resolveAlias("ai");
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});

describe("ALIASES dictionary", () => {
  test("exports ALIASES as a plain object", () => {
    expect(typeof ALIASES).toBe("object");
    expect(ALIASES).not.toBeNull();
  });

  test("contains all required abbreviation keys", () => {
    expect(ALIASES["ml"]).toBe("machine learning");
    expect(ALIASES["ai"]).toBe("artificial intelligence");
    expect(ALIASES["nlp"]).toBe("natural language processing");
    expect(ALIASES["llm"]).toBe("large language model");
    expect(ALIASES["rag"]).toBe("retrieval augmented generation");
  });
});

describe("registerAliases", () => {
  test("is callable without throwing", () => {
    expect(() => registerAliases()).not.toThrow();
  });

  test("is idempotent — calling twice does not throw", () => {
    expect(() => {
      registerAliases();
      registerAliases();
    }).not.toThrow();
  });
});
