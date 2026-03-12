import nlp from "compromise";
import type { RawConcept, NormalizedConcept } from "./types.ts";

// ---------------------------------------------------------------------------
// normalizeConcepts — pure function, same input = identical output.
// Maps each RawConcept to a NormalizedConcept by attaching a canonicalForm.
//
// Normalization strategy (applied in order):
//   1. nouns().toSingular() — collapses plural to singular root
//   2. normalize({ verbs, case, acronyms }) — gerund→base, case-fold
//   3. .toLowerCase().trim() — guarantee lowercase output
//
// Falls back to lowercased surfaceForm if all steps produce an empty string.
// Never mutates the input RawConcept — spreads into a new object.
// ---------------------------------------------------------------------------

function toCanonical(surfaceForm: string): string {
  if (!surfaceForm.trim()) return surfaceForm.toLowerCase().trim();

  const doc = nlp(surfaceForm);
  doc.nouns().toSingular();
  doc.normalize({ verbs: true, case: true, acronyms: true });

  const result = doc.text().toLowerCase().trim();
  return result.length > 0 ? result : surfaceForm.toLowerCase().trim();
}

export function normalizeConcepts(
  concepts: readonly RawConcept[]
): readonly NormalizedConcept[] {
  return concepts.map((c): NormalizedConcept => ({
    ...c,
    canonicalForm: toCanonical(c.surfaceForm),
  }));
}
