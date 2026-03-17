// evolve/outcome.ts — Outcome recording for Phase 13 Living Code.
// An outcome links a decision (node in axon) to a result, marking it success or failure.
// Stored as write-once JSON files in data/outcomes/{uuid}.json (like moments).
// The nightly evolve-review pass reads these to score pattern effectiveness.

import { mkdir, readdir, rename } from "node:fs/promises";
import { appendAuditEvent } from "../audit/logger";

export const DEFAULT_OUTCOMES_DIR = "data/outcomes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutcomeRecord {
  readonly id: string;              // crypto.randomUUID()
  readonly timestamp: string;       // ISO 8601
  readonly agent_id: string;        // which agent recorded this
  readonly decision: string;        // free-text description of what was decided/attempted
  readonly result: string;          // free-text description of what actually happened
  readonly success: boolean;        // did it work?
  readonly concept_ids: readonly number[]; // axon concepts involved (optional — from context)
  readonly tags: readonly string[]; // optional domain tags e.g. ["trading", "strategy"]
}

// ---------------------------------------------------------------------------
// recordOutcome
// ---------------------------------------------------------------------------

/**
 * Atomically write an OutcomeRecord to {dir}/{outcome.id}.json.
 * Creates the directory if it does not exist.
 */
export async function recordOutcome(
  outcome: OutcomeRecord,
  dir: string = DEFAULT_OUTCOMES_DIR
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${outcome.id}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(outcome, null, 2));
  await rename(tmpPath, filePath);
  void appendAuditEvent({
    type: "outcome_record",
    timestamp: outcome.timestamp,
    source: "evolve",
    outcome_id: outcome.id,
    agent_id: outcome.agent_id,
    success: outcome.success,
    decision_preview: outcome.decision.slice(0, 60),
  } as Parameters<typeof appendAuditEvent>[0]).catch(() => {});
}

// ---------------------------------------------------------------------------
// readOutcomes
// ---------------------------------------------------------------------------

/**
 * Read all valid OutcomeRecord files from the given directory.
 * Silently skips files that fail to parse.
 */
export async function readOutcomes(
  dir: string = DEFAULT_OUTCOMES_DIR
): Promise<OutcomeRecord[]> {
  try {
    const entries = await readdir(dir);
    const jsonFiles = entries.filter(
      (e) => e.endsWith(".json") && !e.endsWith(".tmp")
    );
    const results = await Promise.allSettled(
      jsonFiles.map(async (file) => {
        const raw = await Bun.file(`${dir}/${file}`).json();
        return raw as OutcomeRecord;
      })
    );
    return results
      .filter((r): r is PromiseFulfilledResult<OutcomeRecord> => r.status === "fulfilled")
      .map((r) => r.value);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// readOutcomesSince
// ---------------------------------------------------------------------------

/**
 * Read outcomes recorded after a given ISO 8601 timestamp.
 */
export async function readOutcomesSince(
  since: string,
  dir: string = DEFAULT_OUTCOMES_DIR
): Promise<OutcomeRecord[]> {
  const all = await readOutcomes(dir);
  const sinceMs = new Date(since).getTime();
  return all.filter((o) => new Date(o.timestamp).getTime() >= sinceMs);
}

// ---------------------------------------------------------------------------
// buildOutcome (factory helper)
// ---------------------------------------------------------------------------

export function buildOutcome(params: {
  agentId: string;
  decision: string;
  result: string;
  success: boolean;
  conceptIds?: number[];
  tags?: string[];
}): OutcomeRecord {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    agent_id: params.agentId,
    decision: params.decision,
    result: params.result,
    success: params.success,
    concept_ids: params.conceptIds ?? [],
    tags: params.tags ?? [],
  };
}
