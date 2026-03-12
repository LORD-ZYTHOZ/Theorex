// Importance gate — hard prerequisite before frequency counting.
// Frequency counting MUST NEVER run before gate PASS.
// The type system enforces this: amplifyFrequency() accepts GatedConcept[], not IdentifiedConcept[].

import type { IdentifiedConcept, GatedConcept } from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tags that unconditionally pass the gate (Rules 3, 5, 6). */
export const IMPORTANT_TAGS: ReadonlySet<string> = new Set([
  "Person",
  "Place",
  "Organization",
  "Value",
  "ProperNoun",
  "Acronym",
]);

/** Common nouns that carry no signal — always rejected regardless of length or tags. */
export const STOP_CONCEPTS: ReadonlySet<string> = new Set([
  "thing", "way", "time", "people", "year", "day", "man", "woman", "child",
  "world", "life", "hand", "part", "place", "case", "week", "company",
  "system", "program", "question", "work", "government", "number", "night",
  "point", "home", "water", "room", "mother",
  "area", "fact", "lot", "side", "kind", "head", "eye", "face", "body",
  "group", "problem", "right", "job", "word", "state", "city", "name",
  "line", "example", "reason", "end", "result", "issue", "idea", "bit",
]);

// ---------------------------------------------------------------------------
// isImportant — pure function, 6 rules in strict order
// ---------------------------------------------------------------------------

/**
 * Returns true if a concept should pass the importance gate.
 *
 * Rules are evaluated in strict order:
 *  1. Reject short single-word tokens (len ≤ 2 and not multi-word)
 *  2. Reject STOP_CONCEPTS members
 *  3. Accept named entities (Person / Place / Organization / Value)
 *  4. Accept multi-word phrases
 *  5. Accept Acronyms
 *  6. Accept ProperNouns
 *  Default: reject
 */
export function isImportant(concept: IdentifiedConcept): boolean {
  const { canonicalForm, tags, isMultiWord } = concept;

  // Rule 1 — reject very short single-word tokens (pronouns, particles, etc.)
  // Exception: concepts with important tags override this rejection
  if (
    canonicalForm.length <= 2 &&
    !isMultiWord &&
    !tags.some((t) => IMPORTANT_TAGS.has(t))
  ) return false;

  // Rule 2 — reject stop-concept nouns even if they're longer
  if (STOP_CONCEPTS.has(canonicalForm)) return false;

  // Rule 3 — named entities (Person, Place, Organization, Value) always pass
  if (tags.some((t) => ["Person", "Place", "Organization", "Value"].includes(t))) return true;

  // Rule 4 — multi-word phrases always pass
  if (isMultiWord) return true;

  // Rule 5 — acronyms pass
  if (tags.includes("Acronym")) return true;

  // Rule 6 — proper nouns pass
  if (tags.includes("ProperNoun")) return true;

  // Default — common word with no distinguishing tag
  return false;
}

// ---------------------------------------------------------------------------
// importanceGate — filters an array, returns only passing concepts
// ---------------------------------------------------------------------------

/**
 * Filters IdentifiedConcept[] through the importance gate.
 * Returns a new readonly array of GatedConcept — failed concepts are absent.
 * Never mutates the input array or any input object.
 */
export function importanceGate(
  concepts: readonly IdentifiedConcept[],
): readonly GatedConcept[] {
  return concepts
    .filter(isImportant)
    .map((concept): GatedConcept => ({
      ...concept,
      gatePass: true as const,
      importanceScore: 1.0,
    }));
}
