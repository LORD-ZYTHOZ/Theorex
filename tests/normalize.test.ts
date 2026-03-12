import { describe, expect, test } from "bun:test";
import { normalizeConcepts } from "../src/normalize.ts";
import type { RawConcept, NormalizedConcept } from "../src/types.ts";

// Helper: create a minimal RawConcept for testing
function raw(surfaceForm: string, tags: string[] = [], isMultiWord?: boolean): RawConcept {
  return {
    surfaceForm,
    tags,
    isMultiWord: isMultiWord ?? surfaceForm.includes(" "),
  };
}

describe("normalizeConcepts", () => {
  // ---------------------------------------------------------------------------
  // Plural → singular normalization
  // ---------------------------------------------------------------------------

  test("normalizes plural to singular — developers → developer", () => {
    const result = normalizeConcepts([raw("developers")]);
    expect(result.length).toBe(1);
    expect(result[0]!.canonicalForm).toBe("developer");
  });

  test("normalizes plural to singular — dogs → dog", () => {
    const result = normalizeConcepts([raw("dogs")]);
    expect(result.length).toBe(1);
    expect(result[0]!.canonicalForm).toBe("dog");
  });

  // ---------------------------------------------------------------------------
  // Gerund → base form
  // ---------------------------------------------------------------------------

  test("normalizes gerund to base form — running → run", () => {
    const result = normalizeConcepts([raw("running")]);
    expect(result.length).toBe(1);
    expect(result[0]!.canonicalForm).toBe("run");
  });

  // ---------------------------------------------------------------------------
  // Case normalization — always lowercase
  // ---------------------------------------------------------------------------

  test("lowercases proper noun — TypeScript → typescript", () => {
    const result = normalizeConcepts([raw("TypeScript")]);
    expect(result.length).toBe(1);
    expect(result[0]!.canonicalForm).toBe("typescript");
  });

  test("lowercases mixed case — JavaScript → javascript", () => {
    const result = normalizeConcepts([raw("JavaScript")]);
    expect(result.length).toBe(1);
    expect(result[0]!.canonicalForm).toBe("javascript");
  });

  // ---------------------------------------------------------------------------
  // Empty surfaceForm fallback — must not crash
  // ---------------------------------------------------------------------------

  test("empty surfaceForm falls back to empty string (no crash)", () => {
    const result = normalizeConcepts([raw("")]);
    expect(result.length).toBe(1);
    expect(result[0]!.canonicalForm).toBe("");
  });

  // ---------------------------------------------------------------------------
  // Multi-word handling
  // ---------------------------------------------------------------------------

  test("handles multi-word concepts without crashing", () => {
    const result = normalizeConcepts([raw("New York", ["Place"], true)]);
    expect(result.length).toBe(1);
    expect(typeof result[0]!.canonicalForm).toBe("string");
    expect(result[0]!.canonicalForm.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Purity — same input produces identical output
  // ---------------------------------------------------------------------------

  test("pure function — same input produces identical canonical forms", () => {
    const concepts = [raw("developers"), raw("TypeScript"), raw("running")];
    const first = normalizeConcepts(concepts);
    const second = normalizeConcepts(concepts);

    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(first[i]!.canonicalForm).toBe(second[i]!.canonicalForm);
    }
  });

  // ---------------------------------------------------------------------------
  // Immutability — input RawConcept fields preserved, only canonicalForm added
  // ---------------------------------------------------------------------------

  test("preserves original surfaceForm on output NormalizedConcept", () => {
    const input = raw("developers", ["Noun", "Plural"]);
    const result = normalizeConcepts([input]);
    expect(result[0]!.surfaceForm).toBe("developers");
  });

  test("preserves original tags on output NormalizedConcept", () => {
    const input = raw("developers", ["Noun", "Plural"]);
    const result = normalizeConcepts([input]);
    expect(result[0]!.tags).toEqual(["Noun", "Plural"]);
  });

  test("preserves isMultiWord on output NormalizedConcept", () => {
    const input = raw("New York", ["Place"], true);
    const result = normalizeConcepts([input]);
    expect(result[0]!.isMultiWord).toBe(true);
  });

  test("does not mutate input RawConcept", () => {
    const input = raw("developers", ["Noun"]);
    const before = { ...input };
    normalizeConcepts([input]);
    expect(input.surfaceForm).toBe(before.surfaceForm);
    expect(input.tags).toEqual(before.tags);
    expect(input.isMultiWord).toBe(before.isMultiWord);
  });

  // ---------------------------------------------------------------------------
  // Return type check
  // ---------------------------------------------------------------------------

  test("result is assignable to readonly NormalizedConcept[]", () => {
    const result: readonly NormalizedConcept[] = normalizeConcepts([
      raw("TypeScript"),
    ]);
    expect(result).toBeArray();
  });

  // ---------------------------------------------------------------------------
  // Empty input
  // ---------------------------------------------------------------------------

  test("returns empty array for empty input", () => {
    const result = normalizeConcepts([]);
    expect(result).toBeArray();
    expect(result.length).toBe(0);
  });
});
