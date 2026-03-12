import nlp from "compromise";
import type { RawConcept } from "./types.ts";

// ---------------------------------------------------------------------------
// Internal validator — converts compromise .json() output to a safe shape.
// compromise .json() returns phrase-level objects: { text: string, terms: [...] }
// The terms[] array holds individual tokens with per-token tags.
// We validate the top-level entry and collect all tags from terms.
// Malformed entries (missing text or terms) are silently skipped.
// ---------------------------------------------------------------------------

interface CompromiseEntry {
  text: string;
  tags: string[];
}

function parseCompromiseJson(raw: unknown[]): CompromiseEntry[] {
  const results: CompromiseEntry[] = [];

  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;

    if (typeof record["text"] !== "string") continue;

    const text = record["text"] as string;

    // Collect unique tags from all terms in the phrase
    const tags: string[] = [];
    const termsRaw = record["terms"];
    if (Array.isArray(termsRaw)) {
      for (const term of termsRaw) {
        if (term !== null && typeof term === "object") {
          const termRecord = term as Record<string, unknown>;
          if (Array.isArray(termRecord["tags"])) {
            for (const tag of termRecord["tags"]) {
              if (typeof tag === "string" && !tags.includes(tag)) {
                tags.push(tag);
              }
            }
          }
        }
      }
    }

    results.push({ text, tags });
  }

  return results;
}

// ---------------------------------------------------------------------------
// extractConcepts — pure function, same input = identical output.
// Extracts noun phrases and named entities (topics) from English text.
// topics() covers people, places, and organizations.
// Deduplicates by lowercased, trimmed surface form.
// ---------------------------------------------------------------------------

export function extractConcepts(text: string): readonly RawConcept[] {
  if (!text.trim()) return [];

  const doc = nlp(text);

  const nounsRaw = doc.nouns().json() as unknown[];
  const topicsRaw = doc.topics().json() as unknown[];

  const nouns = parseCompromiseJson(nounsRaw);
  const topics = parseCompromiseJson(topicsRaw);

  const seen = new Set<string>();
  const concepts: RawConcept[] = [];

  for (const entry of [...nouns, ...topics]) {
    const trimmed = entry.text.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    concepts.push({
      surfaceForm: trimmed,
      tags: entry.tags,
      isMultiWord: trimmed.includes(" "),
    });
  }

  return concepts;
}
