import { describe, expect, test } from "bun:test";
import { amplifyFrequency } from "../src/amplify";
import type { GatedConcept } from "../src/types";

function makeGatedConcept(
  canonicalForm: string,
  tags: string[] = ["ProperNoun"],
  isMultiWord = false,
): GatedConcept {
  return {
    surfaceForm: canonicalForm,
    canonicalForm,
    tags,
    isMultiWord,
    conceptId: 99999,
    gatePass: true,
    importanceScore: 1.0,
  };
}

describe("amplifyFrequency", () => {
  test("empty array returns empty array", () => {
    expect(amplifyFrequency([], "some text")).toEqual([]);
  });

  test("counts occurrences of canonicalForm in originalText (case-insensitive)", () => {
    const gated = [makeGatedConcept("typescript")];
    const text = "TypeScript is great. TypeScript scales.";
    const result = amplifyFrequency(gated, text);
    expect(result[0].frequencyCount).toBe(2);
  });

  test("frequencyAmplifier = 1 + ln(2) ≈ 1.693 for frequencyCount=2", () => {
    const gated = [makeGatedConcept("typescript")];
    const text = "TypeScript is great. TypeScript scales.";
    const result = amplifyFrequency(gated, text);
    const expected = 1 + Math.log(2);
    expect(result[0].frequencyAmplifier).toBeCloseTo(expected, 10);
  });

  test("f(1) = 1 + ln(1) = 1.0 exactly", () => {
    const gated = [makeGatedConcept("typescript")];
    const text = "TypeScript appears once.";
    const result = amplifyFrequency(gated, text);
    expect(result[0].frequencyCount).toBe(1);
    expect(result[0].frequencyAmplifier).toBeCloseTo(1.0, 10);
  });

  test("f(10) = 1 + ln(10) ≈ 3.302", () => {
    const gated = [makeGatedConcept("typescript")];
    // 10 occurrences
    const text = "TypeScript ".repeat(10).trim();
    const result = amplifyFrequency(gated, text);
    expect(result[0].frequencyCount).toBe(10);
    const expected = 1 + Math.log(10);
    expect(result[0].frequencyAmplifier).toBeCloseTo(expected, 10);
  });

  test("f(1000) = 1 + ln(1000) ≈ 7.908 — log-normalized, not linear", () => {
    const gated = [makeGatedConcept("typescript")];
    const text = "TypeScript ".repeat(1000).trim();
    const result = amplifyFrequency(gated, text);
    expect(result[0].frequencyCount).toBe(1000);
    const expected = 1 + Math.log(1000);
    expect(result[0].frequencyAmplifier).toBeCloseTo(expected, 10);
    // Confirm log-normalized value is around 7.9, not 1000
    expect(result[0].frequencyAmplifier).toBeLessThan(10);
  });

  test("concept not found in text uses frequencyCount=1 (min floor)", () => {
    const gated = [makeGatedConcept("typescript")];
    const text = "Nothing relevant here.";
    const result = amplifyFrequency(gated, text);
    // concept came from text but regex didn't match — floor to 1
    expect(result[0].frequencyCount).toBe(1);
    expect(result[0].frequencyAmplifier).toBeCloseTo(1.0, 10);
  });

  test("handles regex special chars in canonicalForm without crash", () => {
    const gated = [makeGatedConcept("c++")];
    const text = "C++ is a powerful language.";
    // Should not throw — regex chars escaped
    expect(() => amplifyFrequency(gated, text)).not.toThrow();
  });

  test("output objects spread all GatedConcept fields (immutable)", () => {
    const concept = makeGatedConcept("typescript");
    const result = amplifyFrequency([concept], "TypeScript is great.");
    const scored = result[0];
    expect(scored.surfaceForm).toBe(concept.surfaceForm);
    expect(scored.canonicalForm).toBe(concept.canonicalForm);
    expect(scored.tags).toBe(concept.tags);
    expect(scored.isMultiWord).toBe(concept.isMultiWord);
    expect(scored.conceptId).toBe(concept.conceptId);
    expect(scored.gatePass).toBe(true);
    expect(scored.importanceScore).toBe(1.0);
  });

  test("output is a new array — input is not mutated", () => {
    const gated: GatedConcept[] = [makeGatedConcept("typescript")];
    const result = amplifyFrequency(gated, "TypeScript is great.");
    expect(result).not.toBe(gated);
    expect("frequencyCount" in gated[0]).toBe(false);
  });

  test("multiple concepts scored independently in same text", () => {
    const gated = [
      makeGatedConcept("typescript"),
      makeGatedConcept("javascript"),
    ];
    const text = "TypeScript TypeScript TypeScript JavaScript JavaScript";
    const result = amplifyFrequency(gated, text);
    expect(result[0].frequencyCount).toBe(3);
    expect(result[1].frequencyCount).toBe(2);
  });
});
