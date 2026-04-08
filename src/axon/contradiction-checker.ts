/**
 * ContradictionChecker — checks if new content contradicts existing concepts.
 *
 * Pure module with no direct DB or LLM imports.
 * All dependencies are injected via ContradictionCheckerDeps.
 */

export type ContradictionSeverity = 'hard' | 'soft';

export interface Contradiction {
  conceptId: string;
  label: string;
  severity: ContradictionSeverity;
  reason: string;
}

export interface ContradictionCheckResult {
  hasHard: boolean;
  hasSoft: boolean;
  contradictions: Contradiction[];
}

export interface ConceptRow {
  id: string;
  label: string;
  body: string | null;
}

export interface ContradictionCheckerDeps {
  /** Find top N similar concepts for a given agent using cosine similarity on embeddings. */
  searchSimilar: (embedding: number[], agentId: string, limit: number) => Promise<ConceptRow[]>;
  /** Embed the query text to produce a vector. */
  embed: (text: string) => Promise<number[]>;
  /** Ask LLM whether new content contradicts an existing concept body. */
  llmVerdict: (newContent: string, existingBody: string) => Promise<'hard' | 'soft' | 'none'>;
}

const EMPTY_RESULT: ContradictionCheckResult = {
  hasHard: false,
  hasSoft: false,
  contradictions: [],
};

const DEFAULT_SIMILARITY_LIMIT = 5;

/**
 * Check whether `newContent` contradicts any existing concepts for `agentId`.
 *
 * Graceful degradation: if embed or searchSimilar fails, returns an empty result.
 * Individual llmVerdict failures per concept are skipped (that concept is omitted).
 */
export async function checkContradictions(
  newContent: string,
  agentId: string,
  deps: ContradictionCheckerDeps,
  similarityLimit?: number,
): Promise<ContradictionCheckResult> {
  const limit = similarityLimit ?? DEFAULT_SIMILARITY_LIMIT;

  let embedding: number[];
  let similarConcepts: ConceptRow[];

  try {
    embedding = await deps.embed(newContent);
    similarConcepts = await deps.searchSimilar(embedding, agentId, limit);
  } catch {
    return EMPTY_RESULT;
  }

  // Only check concepts that have a body to compare against
  const conceptsWithBody = similarConcepts.filter(
    (c): c is ConceptRow & { body: string } => c.body !== null && c.body.length > 0,
  );

  // Run verdicts concurrently; failed verdicts yield null (skipped)
  const verdictResults = await Promise.all(
    conceptsWithBody.map(async (concept) => {
      try {
        const verdict = await deps.llmVerdict(newContent, concept.body);
        return { concept, verdict };
      } catch {
        return null;
      }
    }),
  );

  // Build contradictions array immutably (filter nulls and 'none' verdicts)
  const contradictions: Contradiction[] = verdictResults
    .filter(
      (r): r is { concept: ConceptRow & { body: string }; verdict: 'hard' | 'soft' } =>
        r !== null && r.verdict !== 'none',
    )
    .map(({ concept, verdict }) => ({
      conceptId: concept.id,
      label: concept.label,
      severity: verdict,
      reason: `New content contradicts existing concept "${concept.label}" (${verdict})`,
    }));

  const hasHard = contradictions.some((c) => c.severity === 'hard');
  const hasSoft = contradictions.some((c) => c.severity === 'soft');

  return { hasHard, hasSoft, contradictions };
}
