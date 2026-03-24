// evolve/session-brief.ts — Phase 13 session brief generation.
// Filters active lessons into a compact brief injected before each trading/coding session.
// The brief closes the loop: lessons written → lessons read → behavior changes.

import { computeLessonScore } from "./lesson";
import type { LessonRecord } from "./lesson";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionBrief {
  readonly generated_at: string;   // ISO 8601
  readonly agent_id: string;
  readonly domain: string;
  readonly lessons: readonly LessonRecord[];
  readonly total_available: number; // lessons considered before cap
}

export interface BriefOptions {
  readonly domain: string;
  readonly maxLessons?: number;    // default: 5
  readonly minScore?: number;      // default: 0.1
  readonly agentId?: string;       // if set, filter to this agent only
}

// ---------------------------------------------------------------------------
// buildSessionBrief
// ---------------------------------------------------------------------------

/**
 * Select the most relevant lessons for a session.
 *
 * Filters by domain (and optionally agent_id), requires score >= minScore,
 * sorts by score descending, and caps at maxLessons.
 */
export function buildSessionBrief(
  lessons: readonly LessonRecord[],
  opts: BriefOptions,
): SessionBrief {
  const { domain, maxLessons = 5, minScore = 0.1, agentId } = opts;
  const nowMs = Date.now();

  const filtered = lessons.filter((l) => {
    if (l.domain !== domain) return false;
    if (agentId && l.agent_id !== agentId) return false;
    return computeLessonScore(l, nowMs) >= minScore;
  });

  const sorted = [...filtered].sort(
    (a, b) => computeLessonScore(b, nowMs) - computeLessonScore(a, nowMs),
  );

  const selected = sorted.slice(0, maxLessons);

  // Infer agent_id from first lesson if not provided
  const resolvedAgentId = agentId ?? selected[0]?.agent_id ?? "unknown";

  return {
    generated_at: new Date().toISOString(),
    agent_id: resolvedAgentId,
    domain,
    lessons: selected,
    total_available: filtered.length,
  };
}

// ---------------------------------------------------------------------------
// formatSessionBrief
// ---------------------------------------------------------------------------

/**
 * Format a SessionBrief as human-readable text for injection into session context.
 *
 * Output is compact — each lesson gets one line of title + one line of recommendation.
 * Designed to be prepended to a system prompt or boot context.
 */
export function formatSessionBrief(brief: SessionBrief): string {
  if (brief.lessons.length === 0) {
    return `## Session Brief — ${brief.domain}\nNo active lessons for this domain yet.\n`;
  }

  const nowMs = Date.now();
  const lines: string[] = [
    `## Session Brief — ${brief.domain} (${brief.lessons.length} lessons)`,
    `_Generated ${new Date(brief.generated_at).toLocaleString()}_`,
    "",
  ];

  for (const lesson of brief.lessons) {
    const score = computeLessonScore(lesson, nowMs);
    const confidencePct = Math.round(lesson.confidence * 100);
    const qualityPct = Math.round(lesson.evidence_quality_score * 100);
    lines.push(
      `**${lesson.title}**`,
      `→ ${lesson.recommendation}`,
      `  _confidence ${confidencePct}% · quality ${qualityPct}% · ${lesson.evidence_count} samples · score ${score.toFixed(2)}_`,
      "",
    );
  }

  if (brief.total_available > brief.lessons.length) {
    lines.push(`_${brief.total_available - brief.lessons.length} more lessons available (below score threshold)_`);
  }

  return lines.join("\n");
}
