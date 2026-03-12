// Pipeline entry point — wires the five pure functions into processText().
// Gate is called at step 4; amplify at step 5 — this order is non-negotiable.
// attachMetadata builds ConceptEvent from ScoredConcept + caller-injected fields.
// No filesystem writes, no network calls, no database queries.

import { extractConcepts } from "./extract.ts";
import { normalizeConcepts } from "./normalize.ts";
import { assignIds } from "./identify.ts";
import { importanceGate } from "./gate.ts";
import { amplifyFrequency } from "./amplify.ts";
import type { ConceptEvent, NodeType, PipelineInput, ScoredConcept } from "./types.ts";

// ---------------------------------------------------------------------------
// attachMetadata — pure function, builds ConceptEvent[] from ScoredConcept[]
// ---------------------------------------------------------------------------

function attachMetadata(
  scored: readonly ScoredConcept[],
  input: PipelineInput,
): readonly ConceptEvent[] {
  return scored
    .map((s): ConceptEvent => ({
      concept_id: s.conceptId,
      surface_form: s.surfaceForm,
      importance_score: s.importanceScore,
      frequency_count: s.frequencyCount,
      composite_score: s.importanceScore * s.frequencyAmplifier * input.sourceWeight,
      source_weight: input.sourceWeight,
      node_type: input.nodeType,
      timestamp: input.timestamp,
    }))
    .sort((a, b) => a.concept_id - b.concept_id);
}

// ---------------------------------------------------------------------------
// processText — pipeline entry point (public API)
// ---------------------------------------------------------------------------

/**
 * Runs the full significance pipeline on a piece of text.
 *
 * Pipeline: extract → normalize → assignIds → importanceGate → amplifyFrequency → attachMetadata
 * Gate is step 4 — amplify never runs on concepts that fail the gate.
 * amplifyFrequency receives the ORIGINAL text (not normalized forms) for frequency counting.
 *
 * @param text         - Source text to analyse
 * @param sourceWeight - Signal producer weight (Claude=1.0, Nova=0.7, Qwen3=0.8)
 * @param nodeType     - Graph node category (default: "concept")
 * @param timestamp    - ISO 8601 timestamp (default: now at call time)
 * @returns Sorted (by concept_id asc) readonly ConceptEvent array
 */
export function processText(
  text: string,
  sourceWeight: number,
  nodeType: NodeType = "concept",
  timestamp: string = new Date().toISOString(),
): readonly ConceptEvent[] {
  const input: PipelineInput = { text, sourceWeight, nodeType, timestamp };

  const raw = extractConcepts(text);
  const normalized = normalizeConcepts(raw);
  const identified = assignIds(normalized);
  const gated = importanceGate(identified);
  const scored = amplifyFrequency(gated, text);

  return attachMetadata(scored, input);
}
