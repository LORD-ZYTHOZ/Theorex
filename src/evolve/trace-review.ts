// evolve/trace-review.ts — Phase 20: GEPA-Style Trace Review.
// When an outcome fails, attach the linked TraceRecord, send both to a local LLM,
// parse the recommended fix, and store it in the agent axon as observation_type: trace_fix.
//
// This closes the learning loop:
//   trace → outcome (failure) → trace-review → fix stored as concept → boot-inject → agent learns

import { readFile } from "node:fs/promises";
import { DEFAULT_OUTCOMES_DIR, readOutcomes, computeCompositeScore } from "./outcome";
import type { OutcomeRecord } from "./outcome";
import { DEFAULT_TRACES_DIR } from "../trace/bus";
import type { TraceRecord } from "../trace/bus";
import { writeToAgent } from "../family/write";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraceReviewRecord {
  readonly id: string;               // crypto.randomUUID()
  readonly timestamp: string;        // ISO 8601
  readonly outcome_id: string;       // which outcome was reviewed
  readonly trace_id: string | null;  // linked TraceRecord (null if outcome had no trace_id)
  readonly agent_id: string;
  readonly score: number;            // 0.0–1.0 reviewer confidence in diagnosis
  readonly fix_description: string;  // concrete fix recommendation
  readonly model_used: string;       // which LLM produced the review
  readonly written_to_axon: boolean;
}

export interface ReviewerResponse {
  readonly score: number;
  readonly fix_description: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIMARY_LLM_URL = "http://localhost:8082/v1/chat/completions";
const FALLBACK_LLM_URL = "http://localhost:1234/v1/chat/completions";
const LLM_TIMEOUT_MS = 45_000;

// Only review outcomes with composite score at or below this threshold.
// Avoids wasting LLM cycles on borderline outcomes that nearly succeeded.
const REVIEW_SCORE_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// buildTraceReviewPrompt — pure, testable
// ---------------------------------------------------------------------------

/**
 * Build the prompt sent to the reviewer LLM.
 * Combines the failed outcome with its execution trace (if available).
 */
export function buildTraceReviewPrompt(
  outcome: OutcomeRecord,
  trace: TraceRecord | null,
): string {
  const tagList = outcome.tags.length > 0 ? outcome.tags.join(", ") : "(none)";

  const traceSection = trace
    ? `## Execution Trace
Model: ${trace.model}
Total tokens: ${trace.total_tokens}
Latency: ${trace.latency_ms}ms
Events captured: ${trace.events.length}
${trace.error ? `Error: ${trace.error}\n` : ""}`
    : "## Execution Trace\n(No trace was attached to this outcome)\n";

  return `You are an expert AI system reviewer. A decision was made, it failed, and you must diagnose what went wrong and recommend a fix.

## Failed Outcome
Decision: ${outcome.decision}
Result: ${outcome.result}
Tags: ${tagList}

${traceSection}
## Your task
1. Identify the root cause of the failure.
2. Provide a concrete, actionable fix that can be stored as a learned concept.
3. Score how confident you are in your diagnosis (0.0 = uncertain, 1.0 = very certain).

Reply ONLY with a JSON object in this exact format (no extra text, no markdown fences):
{ "score": <number 0.0-1.0>, "fix_description": "<one or two sentences describing the fix>" }`;
}

// ---------------------------------------------------------------------------
// parseReviewerResponse — pure, testable
// ---------------------------------------------------------------------------

/**
 * Extract score and fix_description from the raw LLM response.
 * LLMs sometimes wrap JSON in prose or markdown fences — we search for the
 * JSON object rather than assuming clean output.
 * Returns null if the response cannot be parsed.
 */
export function parseReviewerResponse(raw: string): ReviewerResponse | null {
  // Match a JSON object containing both required keys (in either order)
  const pattern =
    /\{[^{}]*"score"[^{}]*"fix_description"[^{}]*\}/s;
  const altPattern =
    /\{[^{}]*"fix_description"[^{}]*"score"[^{}]*\}/s;

  const match = raw.match(pattern) ?? raw.match(altPattern);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as { score?: unknown; fix_description?: unknown };

    const score =
      typeof parsed.score === "number"
        ? Math.min(1, Math.max(0, parsed.score))
        : null;

    const fix =
      typeof parsed.fix_description === "string" &&
      parsed.fix_description.trim().length > 0
        ? parsed.fix_description.trim()
        : null;

    if (score === null || fix === null) return null;
    return { score, fix_description: fix };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: load trace from disk
// ---------------------------------------------------------------------------

async function loadTrace(
  traceId: string,
  tracesDir: string,
): Promise<TraceRecord | null> {
  try {
    const raw = JSON.parse(
      await readFile(`${tracesDir}/${traceId}.json`, "utf-8"),
    ) as TraceRecord;
    return raw;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: call reviewer LLM with primary → fallback
// ---------------------------------------------------------------------------

async function callReviewer(
  prompt: string,
): Promise<{ readonly text: string; readonly modelUsed: string }> {
  const body = JSON.stringify({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 256,
    temperature: 0.2,
  });

  // Try primary: Qwen3 32B (localhost:8082)
  try {
    const res = await Bun.fetch(PRIMARY_LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (res.ok) {
      const json = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      if (text.trim().length > 0) return { text, modelUsed: "qwen3-32b" };
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: Ministral 3B (localhost:1234)
  const res = await Bun.fetch(FALLBACK_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Both LLMs unavailable. Fallback returned HTTP ${res.status}`);
  }

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return { text, modelUsed: "ministral-3b" };
}

// ---------------------------------------------------------------------------
// reviewFailedOutcome — main export
// ---------------------------------------------------------------------------

/**
 * Review a single failed outcome:
 * 1. Load the linked TraceRecord (if trace_id is present)
 * 2. Build a prompt combining outcome + trace
 * 3. Send to Qwen3 32B (fallback: Ministral 3B)
 * 4. Parse score + fix_description from the response
 * 5. Write fix to agent axon as observation_type: trace_fix
 * 6. Return a TraceReviewRecord (always — even on LLM failure)
 */
export async function reviewFailedOutcome(
  outcome: OutcomeRecord,
  config: Config,
  tracesDir: string = DEFAULT_TRACES_DIR,
): Promise<TraceReviewRecord> {
  const trace = outcome.trace_id
    ? await loadTrace(outcome.trace_id, tracesDir)
    : null;

  const prompt = buildTraceReviewPrompt(outcome, trace);

  let reviewerText = "";
  let modelUsed = "unavailable";
  let callFailed = false;
  let callError = "";

  try {
    const result = await callReviewer(prompt);
    reviewerText = result.text;
    modelUsed = result.modelUsed;
  } catch (err) {
    callFailed = true;
    callError = err instanceof Error ? err.message : String(err);
  }

  if (callFailed) {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      outcome_id: outcome.id,
      trace_id: outcome.trace_id ?? null,
      agent_id: outcome.agent_id,
      score: 0,
      fix_description: `[review unavailable: ${callError}]`,
      model_used: "unavailable",
      written_to_axon: false,
    };
  }

  const parsed = parseReviewerResponse(reviewerText);
  const score = parsed?.score ?? 0;
  const fixDescription =
    parsed?.fix_description ??
    `Review of failed outcome: ${outcome.decision.slice(0, 120)}`;

  // Write fix to agent axon as a trace_fix typed concept
  let writtenToAxon = false;
  try {
    await writeToAgent(
      outcome.agent_id,
      `trace_fix: ${fixDescription}`,
      config,
      Date.now(),
      "trace_fix",
    );
    writtenToAxon = true;
  } catch {
    // Non-fatal — the review record is still returned
  }

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    outcome_id: outcome.id,
    trace_id: outcome.trace_id ?? null,
    agent_id: outcome.agent_id,
    score,
    fix_description: fixDescription,
    model_used: modelUsed,
    written_to_axon: writtenToAxon,
  };
}

// ---------------------------------------------------------------------------
// filterFailureCandidates — pure filter, exported for testability
// ---------------------------------------------------------------------------

/**
 * Given a list of outcomes, return the subset that should be reviewed:
 * - Matches agentId (or "all")
 * - success === false
 * - composite score at or below REVIEW_SCORE_THRESHOLD
 */
export function filterFailureCandidates(
  outcomes: readonly OutcomeRecord[],
  agentId: string,
): OutcomeRecord[] {
  return outcomes.filter((o) => {
    if (agentId !== "all" && o.agent_id !== agentId) return false;
    if (o.success) return false;
    return computeCompositeScore(o) <= REVIEW_SCORE_THRESHOLD;
  });
}

// ---------------------------------------------------------------------------
// reviewAllFailures — batch review for nightly loop
// ---------------------------------------------------------------------------

/**
 * Scan the outcomes directory for failed outcomes below the score threshold
 * and run reviewFailedOutcome on each one.
 *
 * Pass agentId = "all" to review failures across all agents.
 * Returns all TraceReviewRecord results (including ones where LLM was unavailable).
 */
export async function reviewAllFailures(
  agentId: string,
  config: Config,
  outcomesDir: string = DEFAULT_OUTCOMES_DIR,
  tracesDir: string = DEFAULT_TRACES_DIR,
): Promise<TraceReviewRecord[]> {
  const all = await readOutcomes(outcomesDir);
  const candidates = filterFailureCandidates(all, agentId);

  const results: TraceReviewRecord[] = [];
  for (const outcome of candidates) {
    const record = await reviewFailedOutcome(outcome, config, tracesDir);
    results.push(record);
  }
  return results;
}
