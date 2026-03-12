// Assigns stable numeric concept IDs via Bun.hash.wyhash.
// resolveAlias() is called first so "ml" and "machine learning" hash identically.
// Explicit seed 0n is required — without it, wyhash uses a random per-process seed.

import type { NormalizedConcept, IdentifiedConcept } from "./types";
import { resolveAlias } from "./synonyms";

// 53-bit mask ensures the BigInt→Number conversion stays within MAX_SAFE_INTEGER.
// wyhash returns a 64-bit unsigned integer which regularly exceeds 2^53-1.
// Masking preserves collision resistance for practical vocabulary sizes.
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER); // 2^53 - 1

/**
 * Assigns a stable numeric conceptId to each NormalizedConcept.
 * The ID is derived from the resolved canonical form (alias-collapsed).
 * Pure: input array is never mutated; returns a new readonly array.
 */
export function assignIds(
  concepts: readonly NormalizedConcept[]
): readonly IdentifiedConcept[] {
  return concepts.map((concept) => {
    const resolved = resolveAlias(concept.canonicalForm);
    const conceptId = Number(Bun.hash.wyhash(resolved, 0n) & MAX_SAFE_BIGINT);
    return { ...concept, conceptId };
  });
}
