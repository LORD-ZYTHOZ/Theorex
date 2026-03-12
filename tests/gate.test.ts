import { describe, expect, test } from "bun:test";
import { isImportant, importanceGate, IMPORTANT_TAGS, STOP_CONCEPTS } from "../src/gate";
import type { IdentifiedConcept } from "../src/types";

function makeConcept(
  canonicalForm: string,
  tags: string[],
  isMultiWord = false,
): IdentifiedConcept {
  return {
    surfaceForm: canonicalForm,
    canonicalForm,
    tags,
    isMultiWord,
    conceptId: 12345,
  };
}

// ---------------------------------------------------------------------------
// isImportant — 6 gate rules
// ---------------------------------------------------------------------------

describe("isImportant — Rule 1: short single-word tokens rejected", () => {
  test("two-character word with no special tag returns false", () => {
    expect(isImportant(makeConcept("it", ["Pronoun"]))).toBe(false);
  });

  test("one-character token returns false", () => {
    expect(isImportant(makeConcept("a", ["Determiner"]))).toBe(false);
  });

  test("two-character word that IS multi-word is NOT rejected by Rule 1", () => {
    // isMultiWord overrides Rule 1 — Rule 4 accepts it
    expect(isImportant(makeConcept("go", ["Verb"], true))).toBe(true);
  });
});

describe("isImportant — Rule 2: STOP_CONCEPTS rejection", () => {
  test('"thing" with Noun tag returns false', () => {
    expect(isImportant(makeConcept("thing", ["Noun"]))).toBe(false);
  });

  test('"system" with Noun tag returns false', () => {
    expect(isImportant(makeConcept("system", ["Noun"]))).toBe(false);
  });

  test('"people" with Noun tag returns false', () => {
    expect(isImportant(makeConcept("people", ["Noun"]))).toBe(false);
  });

  test('"way" with Noun tag returns false', () => {
    expect(isImportant(makeConcept("way", ["Noun"]))).toBe(false);
  });

  test('"time" with Noun tag returns false', () => {
    expect(isImportant(makeConcept("time", ["Noun"]))).toBe(false);
  });
});

describe("isImportant — Rule 3: named entity tags always pass", () => {
  test("Person tag returns true", () => {
    expect(isImportant(makeConcept("alice", ["Noun", "Person"]))).toBe(true);
  });

  test("Place tag returns true", () => {
    expect(isImportant(makeConcept("paris", ["Noun", "Place"]))).toBe(true);
  });

  test("Organization tag returns true", () => {
    expect(isImportant(makeConcept("openai", ["Noun", "Organization"]))).toBe(true);
  });

  test("Value tag returns true", () => {
    expect(isImportant(makeConcept("42", ["Value"]))).toBe(true);
  });
});

describe("isImportant — Rule 4: multi-word always passes", () => {
  test("multi-word phrase returns true regardless of tags", () => {
    expect(isImportant(makeConcept("machine learning", ["Noun"], true))).toBe(true);
  });

  test("multi-word 'new york' returns true", () => {
    expect(isImportant(makeConcept("new york", ["Place"], true))).toBe(true);
  });
});

describe("isImportant — Rule 5: Acronym tag passes", () => {
  test("NASA with Acronym tag returns true", () => {
    expect(isImportant(makeConcept("nasa", ["Acronym"]))).toBe(true);
  });

  test("ML with Acronym tag returns true", () => {
    expect(isImportant(makeConcept("ml", ["Acronym"]))).toBe(true);
  });
});

describe("isImportant — Rule 6: ProperNoun tag passes", () => {
  test("TypeScript with ProperNoun tag returns true", () => {
    expect(isImportant(makeConcept("typescript", ["ProperNoun"]))).toBe(true);
  });

  test("Python with ProperNoun tag returns true", () => {
    expect(isImportant(makeConcept("python", ["ProperNoun"]))).toBe(true);
  });
});

describe("isImportant — Default: common noun with no special tag fails", () => {
  test("ordinary long noun with only Noun tag returns false", () => {
    // 'algorithm' is 9 chars, has only Noun tag — default case → false
    expect(isImportant(makeConcept("algorithm", ["Noun"]))).toBe(false);
  });

  test("verb with no special tag returns false", () => {
    expect(isImportant(makeConcept("running", ["Verb"]))).toBe(false);
  });
});

describe("isImportant — pure function: no mutation, no side effects", () => {
  test("calling isImportant does not mutate the input concept", () => {
    const concept = makeConcept("typescript", ["ProperNoun"]);
    const before = { ...concept };
    isImportant(concept);
    expect(concept).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// importanceGate
// ---------------------------------------------------------------------------

describe("importanceGate", () => {
  test("empty array returns empty array", () => {
    expect(importanceGate([])).toEqual([]);
  });

  test("returns only concepts that pass isImportant", () => {
    const concepts: IdentifiedConcept[] = [
      makeConcept("typescript", ["ProperNoun"]),     // passes Rule 6
      makeConcept("thing", ["Noun"]),                 // fails Rule 2
      makeConcept("machine learning", ["Noun"], true), // passes Rule 4
      makeConcept("it", ["Pronoun"]),                 // fails Rule 1
    ];
    const result = importanceGate(concepts);
    expect(result.length).toBe(2);
    expect(result[0].canonicalForm).toBe("typescript");
    expect(result[1].canonicalForm).toBe("machine learning");
  });

  test("output objects have gatePass: true", () => {
    const concepts = [makeConcept("typescript", ["ProperNoun"])];
    const result = importanceGate(concepts);
    expect(result[0].gatePass).toBe(true);
  });

  test("output objects have importanceScore: 1.0", () => {
    const concepts = [makeConcept("typescript", ["ProperNoun"])];
    const result = importanceGate(concepts);
    expect(result[0].importanceScore).toBe(1.0);
  });

  test("output is a new array — input is not mutated", () => {
    const concepts: IdentifiedConcept[] = [makeConcept("typescript", ["ProperNoun"])];
    const result = importanceGate(concepts);
    expect(result).not.toBe(concepts);
    expect("gatePass" in concepts[0]).toBe(false);
  });

  test("spreads all input fields into output", () => {
    const concept = makeConcept("alice", ["Person"]);
    const result = importanceGate([concept]);
    const gated = result[0];
    expect(gated.surfaceForm).toBe(concept.surfaceForm);
    expect(gated.canonicalForm).toBe(concept.canonicalForm);
    expect(gated.tags).toBe(concept.tags);
    expect(gated.isMultiWord).toBe(concept.isMultiWord);
    expect(gated.conceptId).toBe(concept.conceptId);
  });

  test("concept repeated in STOP_CONCEPTS never passes gate", () => {
    const concepts: IdentifiedConcept[] = Array.from({ length: 1000 }, () =>
      makeConcept("system", ["Noun"]),
    );
    const result = importanceGate(concepts);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe("IMPORTANT_TAGS constant", () => {
  test("includes Person, Place, Organization, Value, ProperNoun, Acronym", () => {
    expect(IMPORTANT_TAGS.has("Person")).toBe(true);
    expect(IMPORTANT_TAGS.has("Place")).toBe(true);
    expect(IMPORTANT_TAGS.has("Organization")).toBe(true);
    expect(IMPORTANT_TAGS.has("Value")).toBe(true);
    expect(IMPORTANT_TAGS.has("ProperNoun")).toBe(true);
    expect(IMPORTANT_TAGS.has("Acronym")).toBe(true);
  });
});

describe("STOP_CONCEPTS constant", () => {
  const required = [
    "thing", "way", "time", "people", "year", "day", "man", "woman", "child",
    "world", "life", "hand", "part", "place", "case", "week", "company",
    "system", "program", "question", "work", "government", "number", "night",
    "point", "home", "water", "room", "mother",
  ];
  for (const word of required) {
    test(`STOP_CONCEPTS includes "${word}"`, () => {
      expect(STOP_CONCEPTS.has(word)).toBe(true);
    });
  }
});
