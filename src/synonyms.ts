// Alias dictionary and resolver for synonym collapse.
// resolveAlias() is called on canonicalForm before hashing in identify.ts,
// ensuring "ml" and "machine learning" map to the same concept node.
//
// registerAliases() uses Strategy C from the Plan 01 spike:
//   nlp.extend({ words: { ml: "Acronym", ... } })
// Spike result: Strategy B and C both verified working in compromise v14.15.0.

import nlp from "compromise";

// ---------------------------------------------------------------------------
// Known abbreviation → expanded form dictionary
// Keys are lowercase; resolveAlias() normalizes lookup with .toLowerCase()
// ---------------------------------------------------------------------------

export const ALIASES: Record<string, string> = {
  ml: "machine learning",
  ai: "artificial intelligence",
  nlp: "natural language processing",
  llm: "large language model",
  rag: "retrieval augmented generation",
};

// ---------------------------------------------------------------------------
// resolveAlias — pure function, no side effects
// ---------------------------------------------------------------------------

/**
 * Resolves an abbreviated canonical form to its expanded alias if known.
 * Lookup is case-insensitive. Returns input unchanged if no alias exists.
 */
export function resolveAlias(canonical: string): string {
  if (canonical === "") return "";
  return ALIASES[canonical.toLowerCase()] ?? canonical;
}

// ---------------------------------------------------------------------------
// registerAliases — one-time module initialization
// Registers each abbreviation as an Acronym tag in compromise's global lexicon.
// Called once at module load. Safe to call multiple times (idempotent).
// ---------------------------------------------------------------------------

export function registerAliases(): void {
  const words: Record<string, string> = {};
  for (const key of Object.keys(ALIASES)) {
    words[key] = "Acronym";
  }
  // Strategy C (canonical v14 plugin format) — verified in Plan 01 spike
  (nlp as unknown as { extend: (plugin: { words: Record<string, string> }) => void })
    .extend({ words });
}

// Module-level initialization — acceptable one-time side effect
registerAliases();
