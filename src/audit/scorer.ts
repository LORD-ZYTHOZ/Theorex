// Pure drift math engine — zero I/O, zero external dependencies.
// AuditEvent is defined locally (minimal subset) because scorer.ts is
// a pure math module that must not import from I/O modules.

type AuditEvent = {
  type: string;
  timestamp: string;
  concept_id?: number;
  surface_form?: string;
  from?: string;
  to?: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface InstabilityFlag {
  readonly concept_id: number;
  readonly surface_form: string;
  readonly dropped_at: string; // ISO 8601 of the tier_change event
  readonly from: "ACTIVE";
  readonly to: "MILD" | "LESS";
}

export interface SentimentFlipFlag {
  readonly concept_id: number;
  readonly surface_form: string;
  readonly sentiments_seen: readonly string[]; // both PREFERRED and DISPREFERRED found in window
}

export type DriftTrend = "stable" | "drifting" | "recovering";

// ---------------------------------------------------------------------------
// computeDriftScore — Jaccard overlap of moment anchors vs active concepts
// ---------------------------------------------------------------------------

export function computeDriftScore(
  momentConceptIds: ReadonlySet<number>,
  activeConceptIds: ReadonlySet<number>,
): number {
  if (momentConceptIds.size === 0) return 1.0;
  if (activeConceptIds.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const id of momentConceptIds) {
    if (activeConceptIds.has(id)) {
      intersectionSize += 1;
    }
  }

  const unionSize =
    momentConceptIds.size + activeConceptIds.size - intersectionSize;

  return intersectionSize / unionSize;
}

// ---------------------------------------------------------------------------
// detectInstability — ACTIVE→non-ACTIVE tier drops within rolling window
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

export function detectInstability(
  events: readonly AuditEvent[],
  windowDays: number,
  nowMs: number = Date.now(),
): InstabilityFlag[] {
  const cutoffMs = nowMs - windowDays * MS_PER_DAY;
  const flags: InstabilityFlag[] = [];

  for (const event of events) {
    if (event.type !== "tier_change") continue;
    if (event.from !== "ACTIVE") continue;
    if (event.to === "ACTIVE") continue;
    if (event.to !== "MILD" && event.to !== "LESS") continue;

    const eventMs = new Date(event.timestamp).getTime();
    if (eventMs < cutoffMs) continue;

    flags.push({
      concept_id: event.concept_id as number,
      surface_form: event.surface_form as string,
      dropped_at: event.timestamp,
      from: "ACTIVE",
      to: event.to as "MILD" | "LESS",
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// detectSentimentFlips — concepts seen as BOTH PREFERRED and DISPREFERRED
// ---------------------------------------------------------------------------

export function detectSentimentFlips(
  events: readonly AuditEvent[],
  windowDays: number,
  nowMs: number = Date.now(),
): SentimentFlipFlag[] {
  const cutoffMs = nowMs - windowDays * MS_PER_DAY;

  type ConceptEntry = {
    surface_form: string;
    seen: Set<string>;
  };
  const conceptMap = new Map<number, ConceptEntry>();

  for (const event of events) {
    if (event.type !== "sentiment_flip") continue;
    if (event.concept_id === undefined) continue;

    const eventMs = new Date(event.timestamp).getTime();
    if (eventMs < cutoffMs) continue;

    const id = event.concept_id;
    let entry = conceptMap.get(id);
    if (!entry) {
      entry = { surface_form: event.surface_form as string, seen: new Set() };
      conceptMap.set(id, entry);
    }

    // Record the resulting sentiment (to) observed in-window.
    // Only the outcome of each in-window event is tracked — the from value
    // represents the prior state which may have been set before the window.
    if (event.to) entry.seen.add(event.to);
  }

  const flags: SentimentFlipFlag[] = [];
  for (const [concept_id, { surface_form, seen }] of conceptMap) {
    if (seen.has("PREFERRED") && seen.has("DISPREFERRED")) {
      flags.push({
        concept_id,
        surface_form,
        sentiments_seen: Array.from(seen),
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// classifyTrend — categorise current drift state
// ---------------------------------------------------------------------------

export function classifyTrend(
  currentScore: number,
  instabilityCount: number,
): DriftTrend {
  // recovering takes precedence — high score but recent instability
  if (currentScore >= 0.7 && instabilityCount > 0) return "recovering";
  // drifting — score too low or too many drops
  if (currentScore < 0.5 || instabilityCount >= 3) return "drifting";
  // everything else
  return "stable";
}
