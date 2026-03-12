// Frequency amplification — MUST only run on concepts that have passed importanceGate().
// TypeScript enforces this: GatedConcept[] is the parameter type, not IdentifiedConcept[].

import type { GatedConcept, ScoredConcept } from "./types.ts";

/**
 * Amplifies each gated concept with a log-normalized frequency score.
 *
 * Formula: frequencyAmplifier = 1 + Math.log1p(frequencyCount)
 * Yields: f(1)=1.0, f(10)≈3.302, f(1000)≈7.908 — sublinear, bounded growth.
 *
 * Frequency is counted against originalText (not canonicalForm) via case-insensitive
 * whole-word regex. If no match is found, frequencyCount floors to 1 (concept
 * came from this text — regex just failed to match surface form).
 *
 * Returns a new readonly array; never mutates input objects.
 */
export function amplifyFrequency(
  gated: readonly GatedConcept[],
  originalText: string,
): readonly ScoredConcept[] {
  return gated.map((concept): ScoredConcept => {
    const escaped = concept.canonicalForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = originalText.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? [];
    const frequencyCount = matches.length === 0 ? 1 : matches.length;
    // 1 + ln(n): f(1)=1.0, f(10)≈3.302, f(1000)≈7.908 — log-normalized, bounded growth
    const frequencyAmplifier = 1 + Math.log(frequencyCount);
    return { ...concept, frequencyCount, frequencyAmplifier };
  });
}
