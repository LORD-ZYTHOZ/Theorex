// evolve/lesson.ts — Phase 13 richer lesson schema.
// A LessonRecord is synthesized knowledge derived from patterns in outcomes.
// Unlike raw OutcomeRecords, lessons are actionable, decay-aware, and domain-typed.
//
// Layer model:
//   axon nodes (raw observations)
//     → OutcomeRecords (decision + result + success)
//       → LessonRecords (synthesized from patterns across multiple outcomes)
//         → session brief (filtered subset injected before each session)

import { mkdir, rename, readdir } from "node:fs/promises";

export const DEFAULT_LESSONS_DIR = "data/lessons";

// ---------------------------------------------------------------------------
// Decay rates by time_horizon (fraction of value lost per day)
// ---------------------------------------------------------------------------

const DECAY_RATES: Record<LessonRecord["time_horizon"], number> = {
  immediate: 0.5,   // half-life ~2 days
  short:     0.08,  // half-life ~9 days
  medium:    0.02,  // half-life ~35 days
  permanent: 0.002, // half-life ~350 days
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LessonType = "domain_fact" | "user_model" | "methodology";
export type TimeHorizon = "immediate" | "short" | "medium" | "permanent";

/**
 * LessonRecord — synthesized, decay-aware, actionable knowledge unit.
 *
 * lesson_type controls propagation:
 *   domain_fact  — trading/market knowledge, stays within same domain
 *   user_model   — understanding of user preferences, can cross agents
 *   methodology  — reasoning/process patterns, stays within same reasoning type
 *
 * confidence reflects how well-supported the lesson is by evidence.
 * computeLessonScore() combines confidence, evidence quality, and time decay.
 */
export interface LessonRecord {
  readonly id: string;
  readonly timestamp: string;                    // when first synthesized (ISO 8601)
  readonly agent_id: string;
  readonly domain: string;                       // "trading" | "coding" | "general"
  readonly lesson_type: LessonType;
  readonly title: string;                        // short, searchable (≤100 chars)
  readonly recommendation: string;               // what to do next time (actionable)
  readonly confidence: number;                   // 0.0–1.0
  readonly evidence_count: number;               // how many outcomes support this
  readonly evidence_quality_score: number;       // avg composite score of evidence (0.0–1.0)
  readonly first_observed: string;               // ISO 8601
  readonly last_reinforced: string;              // ISO 8601 — updated on each reinforce
  readonly decay_rate: number;                   // daily decay fraction (derived from time_horizon)
  readonly time_horizon: TimeHorizon;
  readonly evidence_outcome_ids: readonly string[]; // OutcomeRecord.id refs
}

// ---------------------------------------------------------------------------
// buildLesson (factory)
// ---------------------------------------------------------------------------

export function buildLesson(params: {
  agentId: string;
  domain: string;
  lessonType: LessonType;
  title: string;
  recommendation: string;
  confidence: number;
  evidenceCount: number;
  evidenceQualityScore: number;
  timeHorizon: TimeHorizon;
  evidenceOutcomeIds: string[];
}): LessonRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    timestamp: now,
    agent_id: params.agentId,
    domain: params.domain,
    lesson_type: params.lessonType,
    title: params.title.slice(0, 100),
    recommendation: params.recommendation,
    confidence: clamp(params.confidence),
    evidence_count: Math.max(0, params.evidenceCount),
    evidence_quality_score: clamp(params.evidenceQualityScore),
    first_observed: now,
    last_reinforced: now,
    decay_rate: DECAY_RATES[params.timeHorizon],
    time_horizon: params.timeHorizon,
    evidence_outcome_ids: [...params.evidenceOutcomeIds],
  };
}

// ---------------------------------------------------------------------------
// computeLessonScore
// ---------------------------------------------------------------------------

/**
 * Compute a 0.0–1.0 current relevance score for a lesson.
 *
 * Score = confidence × evidence_quality_score × time_decay_factor
 *
 * time_decay_factor = e^(-decay_rate × days_since_reinforced)
 * This ensures lessons fade naturally unless reinforced by new evidence.
 */
export function computeLessonScore(lesson: LessonRecord, nowMs: number = Date.now()): number {
  const daysSince = (nowMs - new Date(lesson.last_reinforced).getTime()) / 86_400_000;
  const decayFactor = Math.exp(-lesson.decay_rate * daysSince);
  return lesson.confidence * lesson.evidence_quality_score * decayFactor;
}

// ---------------------------------------------------------------------------
// Store — write / read / reinforce
// ---------------------------------------------------------------------------

export async function writeLesson(
  lesson: LessonRecord,
  dir: string = DEFAULT_LESSONS_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${lesson.id}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(lesson, null, 2));
  await rename(tmpPath, filePath);
}

export async function readLesson(
  id: string,
  dir: string = DEFAULT_LESSONS_DIR,
): Promise<LessonRecord | null> {
  try {
    return await Bun.file(`${dir}/${id}.json`).json() as LessonRecord;
  } catch {
    return null;
  }
}

export async function readAllLessons(
  dir: string = DEFAULT_LESSONS_DIR,
): Promise<LessonRecord[]> {
  try {
    const entries = await readdir(dir);
    const jsonFiles = entries.filter((e) => e.endsWith(".json") && !e.endsWith(".tmp"));
    const results = await Promise.allSettled(
      jsonFiles.map((f) => Bun.file(`${dir}/${f}`).json() as Promise<LessonRecord>),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<LessonRecord> => r.status === "fulfilled")
      .map((r) => r.value);
  } catch {
    return [];
  }
}

/**
 * Read only lessons whose current score >= minScore.
 * Sorted by score descending.
 */
export async function readActiveLessons(
  dir: string = DEFAULT_LESSONS_DIR,
  opts: { minScore?: number; domain?: string } = {},
): Promise<LessonRecord[]> {
  const { minScore = 0.1, domain } = opts;
  const all = await readAllLessons(dir);
  const nowMs = Date.now();
  return all
    .filter((l) => {
      if (domain && l.domain !== domain) return false;
      return computeLessonScore(l, nowMs) >= minScore;
    })
    .sort((a, b) => computeLessonScore(b, nowMs) - computeLessonScore(a, nowMs));
}

/**
 * Reinforce an existing lesson with a new supporting outcome.
 * Updates last_reinforced, evidence_count, evidence_outcome_ids, and optionally
 * blends in a new quality score (weighted average).
 *
 * Immutable — reads, builds new record, writes atomically.
 */
export async function reinforceLesson(
  id: string,
  dir: string = DEFAULT_LESSONS_DIR,
  opts: { newOutcomeId?: string; newQualityScore?: number } = {},
): Promise<LessonRecord | null> {
  const existing = await readLesson(id, dir);
  if (!existing) return null;

  const newCount = existing.evidence_count + 1;

  // Blend quality score: weighted average between old and new
  const blendedQuality =
    opts.newQualityScore !== undefined
      ? (existing.evidence_quality_score * existing.evidence_count + opts.newQualityScore) / newCount
      : existing.evidence_quality_score;

  const updated: LessonRecord = {
    ...existing,
    evidence_count: newCount,
    evidence_quality_score: clamp(blendedQuality),
    last_reinforced: new Date().toISOString(),
    evidence_outcome_ids: opts.newOutcomeId
      ? [...existing.evidence_outcome_ids, opts.newOutcomeId]
      : existing.evidence_outcome_ids,
  };

  await writeLesson(updated, dir);
  return updated;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}
