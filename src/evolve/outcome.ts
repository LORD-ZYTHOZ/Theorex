// evolve/outcome.ts — Outcome recording for Phase 13 Living Code.
// An outcome links a decision (node in axon) to a result, marking it success or failure.
// Stored as write-once JSON files in data/outcomes/{uuid}.json (like moments).
// The nightly evolve-review pass reads these to score pattern effectiveness.

import { mkdir, readdir, rename, readFile } from "node:fs/promises";
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
  // Three-channel feedback (Phase 13 upgrade — all optional for backward compatibility)
  readonly explicit_score?: number;    // 0.0–1.0 caller-provided API score
  readonly thumbs_up?: boolean;        // simple binary signal from user
  readonly judge_score?: number;       // 0.0–1.0 LLM judge score (set async after recording)
  readonly judge_reasoning?: string;   // why the judge scored it this way
  readonly trace_id?: string;          // links to TraceRecord in data/traces/
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
// computeCompositeScore
// ---------------------------------------------------------------------------

/**
 * Compute a composite 0.0–1.0 quality score for an outcome using up to three
 * feedback channels.  Only channels that are actually present contribute, and
 * their weights are rebalanced proportionally so the total always sums to 1.
 *
 * Channel weights (when all present):
 *   explicit_score  40%
 *   thumbs_up       20%  (true → 1.0, false → 0.0)
 *   judge_score     40%
 *
 * Fallback when no channel is present: success → 0.6, failure → 0.0
 */
export function computeCompositeScore(outcome: OutcomeRecord): number {
  type Channel = { weight: number; value: number };
  const channels: Channel[] = [];

  if (outcome.explicit_score !== undefined) {
    channels.push({ weight: 0.4, value: Math.min(1, Math.max(0, outcome.explicit_score)) });
  }
  if (outcome.thumbs_up !== undefined) {
    channels.push({ weight: 0.2, value: outcome.thumbs_up ? 1.0 : 0.0 });
  }
  if (outcome.judge_score !== undefined) {
    channels.push({ weight: 0.4, value: Math.min(1, Math.max(0, outcome.judge_score)) });
  }

  if (channels.length === 0) {
    // No signal channels — fall back to the binary success flag
    return outcome.success ? 0.6 : 0.0;
  }

  const totalWeight = channels.reduce((sum, c) => sum + c.weight, 0);
  return channels.reduce((sum, c) => sum + (c.weight / totalWeight) * c.value, 0);
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
    tags: (params.tags ?? []).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// patchOutcomeJudgeScore
// ---------------------------------------------------------------------------

/**
 * Read an existing outcome file and atomically write a new copy that includes
 * the LLM judge score and reasoning.  The original object is never mutated —
 * a fresh object is constructed via spread.
 *
 * Throws if the outcome file does not exist or cannot be parsed.
 */
export async function patchOutcomeJudgeScore(
  outcomeId: string,
  judgeScore: number,
  judgeReasoning: string,
  dir: string = DEFAULT_OUTCOMES_DIR
): Promise<void> {
  const filePath = `${dir}/${outcomeId}.json`;
  const tmpPath = `${filePath}.tmp`;

  const raw = JSON.parse(await readFile(filePath, "utf-8")) as OutcomeRecord;

  // Immutable — build a new object, never mutate `raw`
  const patched: OutcomeRecord = {
    ...raw,
    judge_score: Math.min(1, Math.max(0, judgeScore)),
    judge_reasoning: judgeReasoning,
  };

  await Bun.write(tmpPath, JSON.stringify(patched, null, 2));
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// buildJudgePrompt
// ---------------------------------------------------------------------------

/**
 * Construct the prompt to send to an LLM judge (e.g. Qwen3 or Claude) for
 * async scoring of an outcome.
 *
 * The model should reply with a JSON object of the form:
 *   { "score": 0.0-1.0, "reasoning": "..." }
 */
export function buildJudgePrompt(outcome: OutcomeRecord): string {
  const tagList = outcome.tags.length > 0 ? outcome.tags.join(", ") : "(none)";
  return `You are an objective judge evaluating the quality of a decision and its result.

## Decision
${outcome.decision}

## Result
${outcome.result}

## Outcome
Success: ${outcome.success ? "yes" : "no"}
Tags: ${tagList}

## Your task
Score this outcome on a scale of 0.0 to 1.0, where:
- 1.0 = excellent result, clear learning, well-reasoned decision
- 0.5 = acceptable result, limited learning value
- 0.0 = poor result, no learning captured, or decision was clearly wrong

Reply ONLY with a JSON object in this exact format (no extra text):
{ "score": <number 0.0-1.0>, "reasoning": "<one or two sentences>" }`;
}
