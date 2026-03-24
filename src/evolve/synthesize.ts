// evolve/synthesize.ts — Phase 13 lesson synthesis.
// Derives LessonRecords from patterns in OutcomeRecords.
// Pure function — no I/O. Callers handle persistence.
//
// Algorithm:
//   1. Group outcomes by tag
//   2. For each tag with ≥ MIN_EVIDENCE outcomes, compute win rate + quality score
//   3. Emit a LessonRecord with appropriate lesson_type, confidence, and time_horizon

import { computeCompositeScore } from "./outcome";
import type { OutcomeRecord } from "./outcome";
import { buildLesson } from "./lesson";
import type { LessonRecord, LessonType, TimeHorizon } from "./lesson";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_EVIDENCE = 3;          // minimum outcomes per tag before synthesizing
const HIGH_CONFIDENCE_WR = 0.75; // win rate above which lesson is confident
const LOW_CONFIDENCE_WR = 0.35;  // win rate below which lesson flags avoidance

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SynthesisInput {
  readonly agentId: string;
  readonly domain: string;
  readonly outcomes: readonly OutcomeRecord[];
}

// ---------------------------------------------------------------------------
// synthesizeLessons
// ---------------------------------------------------------------------------

/**
 * Derive LessonRecords from a set of OutcomeRecords.
 *
 * Returns only lessons with sufficient evidence (≥ MIN_EVIDENCE outcomes per tag).
 * Each tag generates at most one lesson (the strongest signal per tag).
 *
 * Does not read/write files — caller is responsible for persistence.
 */
export function synthesizeLessons(input: SynthesisInput): LessonRecord[] {
  const { agentId, domain, outcomes } = input;
  if (outcomes.length === 0) return [];

  // Group by tag
  const tagMap = new Map<string, OutcomeRecord[]>();
  for (const outcome of outcomes) {
    for (const tag of outcome.tags) {
      const existing = tagMap.get(tag) ?? [];
      tagMap.set(tag, [...existing, outcome]);
    }
  }

  const lessons: LessonRecord[] = [];

  for (const [tag, tagOutcomes] of tagMap) {
    if (tagOutcomes.length < MIN_EVIDENCE) continue;

    const successCount = tagOutcomes.filter((o) => o.success).length;
    const winRate = successCount / tagOutcomes.length;

    // Average composite quality score across all outcomes for this tag
    const avgQuality =
      tagOutcomes.reduce((sum, o) => sum + computeCompositeScore(o), 0) /
      tagOutcomes.length;

    // Skip if evidence quality is too weak to trust (even with volume)
    if (avgQuality < 0.05) continue;

    const { confidence, title, recommendation, lessonType, timeHorizon } =
      _deriveAttributes(tag, winRate, tagOutcomes.length, domain);

    lessons.push(
      buildLesson({
        agentId,
        domain,
        lessonType,
        title,
        recommendation,
        confidence,
        evidenceCount: tagOutcomes.length,
        evidenceQualityScore: avgQuality,
        timeHorizon,
        evidenceOutcomeIds: tagOutcomes.map((o) => o.id),
      }),
    );
  }

  return lessons;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _deriveAttributes(
  tag: string,
  winRate: number,
  sampleCount: number,
  domain: string,
): {
  confidence: number;
  title: string;
  recommendation: string;
  lessonType: LessonType;
  timeHorizon: TimeHorizon;
} {
  // Confidence = win rate, with a small sample-count bonus (max 0.15 at 15+ samples).
  // High WR → high confidence (lean in). Low WR → low confidence (avoid signal).
  const sampleBonus = Math.min(0.15, sampleCount * 0.01);
  const confidence = Math.min(0.95, winRate + sampleBonus);

  // Domain-specific lesson_type inference
  const lessonType = _inferLessonType(tag, domain);

  // Time horizon: trading signals decay faster than coding methodology
  const timeHorizon = _inferTimeHorizon(domain, lessonType, winRate);

  let title: string;
  let recommendation: string;

  if (winRate >= HIGH_CONFIDENCE_WR) {
    title = `${tag} — high success pattern (${Math.round(winRate * 100)}% win rate)`;
    recommendation = `Use "${tag}" approach — consistently produces good outcomes. Lean into this pattern.`;
  } else if (winRate <= LOW_CONFIDENCE_WR) {
    title = `${tag} — avoid (${Math.round(winRate * 100)}% win rate)`;
    recommendation = `Avoid "${tag}" pattern — consistently underperforms. Review approach or avoid entirely.`;
  } else {
    title = `${tag} — mixed results (${Math.round(winRate * 100)}% win rate)`;
    recommendation = `"${tag}" has inconsistent results. Apply only with additional confirmation signals.`;
  }

  return { confidence, title, recommendation, lessonType, timeHorizon };
}

function _inferLessonType(tag: string, domain: string): LessonType {
  // Coding methodology tags
  if (domain === "coding") return "methodology";
  // User preference signals
  if (tag.startsWith("user-") || tag.includes("preference")) return "user_model";
  // Everything else is domain fact
  return "domain_fact";
}

function _inferTimeHorizon(
  domain: string,
  lessonType: LessonType,
  winRate: number,
): TimeHorizon {
  if (lessonType === "methodology") return "permanent";
  if (lessonType === "user_model") return "medium";
  // Trading domain facts: strong signals last medium, weak ones fade fast
  if (domain === "trading") {
    return winRate >= HIGH_CONFIDENCE_WR ? "medium" : "short";
  }
  return "medium";
}
