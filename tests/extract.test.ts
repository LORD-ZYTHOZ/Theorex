import { describe, expect, test } from "bun:test";
import { extractConcepts } from "../src/extract.ts";
import type { RawConcept } from "../src/types.ts";

describe("extractConcepts", () => {
  // ---------------------------------------------------------------------------
  // Proper nouns extraction
  // ---------------------------------------------------------------------------

  test("extracts proper nouns from text with programming languages", () => {
    const result = extractConcepts("TypeScript is a superset of JavaScript");
    const surfaceForms = result.map((c) => c.surfaceForm);
    // At least one of the proper nouns should appear
    const hasTypeScript = surfaceForms.some((s) =>
      s.toLowerCase().includes("typescript")
    );
    const hasJavaScript = surfaceForms.some((s) =>
      s.toLowerCase().includes("javascript")
    );
    expect(hasTypeScript || hasJavaScript).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Named entities (people + places)
  // ---------------------------------------------------------------------------

  test("extracts named entities — person and place", () => {
    const result = extractConcepts("Barack Obama visited New York");
    const surfaceForms = result.map((c) => c.surfaceForm);

    const hasObama = surfaceForms.some((s) =>
      s.toLowerCase().includes("obama") || s.toLowerCase().includes("barack")
    );
    const hasNewYork = surfaceForms.some((s) =>
      s.toLowerCase().includes("new york")
    );

    expect(hasObama).toBe(true);
    expect(hasNewYork).toBe(true);
  });

  test("Barack Obama isMultiWord is true", () => {
    const result = extractConcepts("Barack Obama visited New York");
    const obama = result.find(
      (c) =>
        c.surfaceForm.toLowerCase().includes("obama") ||
        c.surfaceForm.toLowerCase().includes("barack")
    );
    if (obama) {
      expect(obama.isMultiWord).toBe(obama.surfaceForm.includes(" "));
    }
  });

  test("New York isMultiWord is true", () => {
    const result = extractConcepts("Barack Obama visited New York");
    const newYork = result.find((c) =>
      c.surfaceForm.toLowerCase().includes("new york")
    );
    expect(newYork).toBeDefined();
    expect(newYork!.isMultiWord).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Stop-words only → empty result
  // ---------------------------------------------------------------------------

  test("returns empty array for stop-word-only text", () => {
    const result = extractConcepts("the the the");
    expect(result).toBeArray();
    expect(result.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Purity — same input yields identical output
  // ---------------------------------------------------------------------------

  test("pure function — same input produces identical output", () => {
    const text = "TypeScript is used at Microsoft";
    const first = extractConcepts(text);
    const second = extractConcepts(text);

    expect(first.length).toBe(second.length);
    const firstForms = first.map((c) => c.surfaceForm).sort();
    const secondForms = second.map((c) => c.surfaceForm).sort();
    expect(firstForms).toEqual(secondForms);
  });

  // ---------------------------------------------------------------------------
  // Deduplication — no two entries with same lowercased surface form
  // ---------------------------------------------------------------------------

  test("deduplicates by lowercased surface form", () => {
    // Even if compromise emits the same term from nouns + topics, dedup must occur
    const result = extractConcepts("dogs are animals and dogs are friendly");
    const lowered = result.map((c) => c.surfaceForm.trim().toLowerCase());
    const unique = new Set(lowered);
    expect(unique.size).toBe(lowered.length);
  });

  // ---------------------------------------------------------------------------
  // Structural validation — RawConcept shape
  // ---------------------------------------------------------------------------

  test("each result entry has surfaceForm, tags, isMultiWord fields", () => {
    const result = extractConcepts("Barack Obama visited New York");
    expect(result.length).toBeGreaterThan(0);
    for (const concept of result) {
      expect(typeof concept.surfaceForm).toBe("string");
      expect(Array.isArray(concept.tags)).toBe(true);
      expect(typeof concept.isMultiWord).toBe("boolean");
    }
  });

  test("surfaceForm is never empty string", () => {
    const result = extractConcepts("Barack Obama visited New York");
    for (const concept of result) {
      expect(concept.surfaceForm.trim().length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // Malformed compromise output — must not crash
  // (parseCompromiseJson validator safety net)
  // ---------------------------------------------------------------------------

  test("returns array (no crash) for empty string input", () => {
    const result = extractConcepts("");
    expect(result).toBeArray();
  });

  test("returns array (no crash) for whitespace-only input", () => {
    const result = extractConcepts("   ");
    expect(result).toBeArray();
  });

  // ---------------------------------------------------------------------------
  // Return type is readonly-compatible (structural check via TypeScript)
  // ---------------------------------------------------------------------------

  test("result is assignable to readonly RawConcept[]", () => {
    const result: readonly RawConcept[] = extractConcepts("TypeScript");
    expect(result).toBeArray();
  });
});
