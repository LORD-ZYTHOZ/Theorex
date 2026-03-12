import { describe, expect, test } from "bun:test";
import { assignIds } from "../src/identify";
import type { NormalizedConcept } from "../src/types";

function makeConcept(canonicalForm: string): NormalizedConcept {
  return {
    surfaceForm: canonicalForm,
    canonicalForm,
    tags: ["Noun"],
    isMultiWord: canonicalForm.includes(" "),
  };
}

describe("assignIds", () => {
  test("returns empty array for empty input", () => {
    expect(assignIds([])).toEqual([]);
  });

  test("adds a conceptId > 0 to each concept", () => {
    const result = assignIds([makeConcept("typescript")]);
    expect(result.length).toBe(1);
    expect(result[0].conceptId).toBeGreaterThan(0);
  });

  test("is deterministic — same canonicalForm produces same conceptId across calls", () => {
    const input = [makeConcept("typescript")];
    const id1 = assignIds(input)[0].conceptId;
    const id2 = assignIds(input)[0].conceptId;
    const id3 = assignIds(input)[0].conceptId;
    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  test("two different canonicalForms produce different conceptIds", () => {
    const results = assignIds([makeConcept("typescript"), makeConcept("javascript")]);
    expect(results[0].conceptId).not.toBe(results[1].conceptId);
  });

  test("alias collapse — 'ml' and 'machine learning' produce the same conceptId", () => {
    const mlResult = assignIds([makeConcept("ml")])[0].conceptId;
    const expandedResult = assignIds([makeConcept("machine learning")])[0].conceptId;
    expect(mlResult).toBe(expandedResult);
  });

  test("spreads all input fields into output (immutable output)", () => {
    const input = makeConcept("typescript");
    const result = assignIds([input])[0];
    expect(result.surfaceForm).toBe(input.surfaceForm);
    expect(result.canonicalForm).toBe(input.canonicalForm);
    expect(result.tags).toBe(input.tags);
    expect(result.isMultiWord).toBe(input.isMultiWord);
  });

  test("does not mutate input concepts", () => {
    const input = makeConcept("typescript");
    const inputCopy = { ...input };
    assignIds([input]);
    expect(input).toEqual(inputCopy);
    expect("conceptId" in input).toBe(false);
  });

  test("all conceptIds are finite safe integers", () => {
    const concepts = ["typescript", "machine learning", "ai", "graph database"]
      .map(makeConcept);
    const results = assignIds(concepts);
    for (const r of results) {
      expect(Number.isFinite(r.conceptId)).toBe(true);
      expect(r.conceptId <= Number.MAX_SAFE_INTEGER).toBe(true);
    }
  });

  test("handles multi-concept arrays correctly", () => {
    const concepts = ["typescript", "javascript", "python"].map(makeConcept);
    const results = assignIds(concepts);
    expect(results.length).toBe(3);
    // All IDs distinct
    const ids = new Set(results.map((r) => r.conceptId));
    expect(ids.size).toBe(3);
  });
});
