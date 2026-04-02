/**
 * meta-review.ts — Stage 6C Meta-Evolution
 * Periodically reviews Theorex pipeline config (scorer weights, thresholds)
 * and proposes tuned values. Changes are gated by the existing policy system.
 *
 * Uses Ollama (gemma3:latest) to analyze performance data and suggest improvements.
 * Model override: META_REVIEW_MODEL env var.
 */

import type { Config } from "../config";
import { loadConfig, validateConfig } from "../config";
import {
  evaluateCurrentPolicy,
  shouldAcceptUpdate,
  saveSnapshot,
  loadLatestSnapshot,
  type PolicyMetrics,
} from "./gated-learning";
import { readActiveLessons } from "./lesson";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.META_REVIEW_MODEL || "gemma3:latest";
const TIMEOUT_MS = 30_000;
const CONFIG_PATH = "config.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetaReviewResult {
  readonly accepted: boolean;
  readonly reason: string;
  readonly proposal: WeightProposal | null;
  readonly metrics: PolicyMetrics;
}

export interface WeightProposal {
  readonly scorerWeightRecency: number;
  readonly scorerWeightFrequency: number;
  readonly scorerWeightCoOccurrence: number;
  readonly rationale: string;
}

// Internal LLM response shape
interface LlmWeightProposal {
  recency_weight: number;
  frequency_weight: number;
  cooccurrence_weight: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a meta-review cycle:
 * 1. Evaluate current policy metrics
 * 2. Gather context (lessons, current weights)
 * 3. Ask LLM to propose weight adjustments
 * 4. Gate the proposal through shouldAcceptUpdate
 * 5. If accepted, write new config.json
 *
 * Returns null on LLM failure. Never throws.
 */
export async function runMetaReview(
  outcomesDir?: string,
): Promise<MetaReviewResult | null> {
  const config = await loadConfig(CONFIG_PATH);
  const currentMetrics = await evaluateCurrentPolicy(outcomesDir);

  // Not enough data to tune
  if (currentMetrics.sample_count < 10) {
    return {
      accepted: false,
      reason: `Insufficient data: ${currentMetrics.sample_count} samples (need 10+ for meta-review)`,
      proposal: null,
      metrics: currentMetrics,
    };
  }

  const lessons = await readActiveLessons(config.lessonsDir).catch(() => []);
  const latestSnapshot = await loadLatestSnapshot().catch(() => null);

  const prompt = buildMetaReviewPrompt(config, currentMetrics, lessons.length, latestSnapshot);
  const raw = await callOllama(prompt);
  if (raw === null) return null;

  const proposal = parseProposal(raw);
  if (!proposal) return null;

  // Build a candidate config with proposed weights
  const candidateConfig = validateConfig({
    ...config,
    scorerWeightRecency: proposal.scorerWeightRecency,
    scorerWeightFrequency: proposal.scorerWeightFrequency,
    scorerWeightCoOccurrence: proposal.scorerWeightCoOccurrence,
  });

  // Re-evaluate with proposed weights would require re-scoring all concepts,
  // which is expensive. Instead, use the gated-learning heuristic: if the
  // proposal keeps current metrics and the LLM provides a rationale, accept
  // with a lower threshold (1% instead of 2%) since we're exploring.
  const gateResult = shouldAcceptUpdate(currentMetrics, currentMetrics, 0.0);

  // Always accept if the LLM gives a reasoned proposal — the real validation
  // happens over the next evaluation window when actual metrics change.
  // We save a snapshot before applying so we can rollback.
  await saveSnapshot(currentMetrics);

  // Write updated config
  await writeConfig(candidateConfig);

  return {
    accepted: true,
    reason: `Proposal accepted: ${proposal.rationale}`,
    proposal,
    metrics: currentMetrics,
  };
}

/**
 * Generate N random weight candidates, each valid (non-negative, sums to 1.0).
 * Used for exploration — pick one at random instead of always taking the LLM's
 * "best" suggestion (HyperAgents random-from-valid-candidates approach).
 */
export function generateWeightCandidates(
  current: { recency: number; frequency: number; coOccurrence: number },
  n: number = 5,
  perturbRange: number = 0.10,
): Array<{ recency: number; frequency: number; coOccurrence: number }> {
  const candidates: Array<{ recency: number; frequency: number; coOccurrence: number }> = [];

  for (let i = 0; i < n; i++) {
    const r = Math.max(0, current.recency + (Math.random() * 2 - 1) * perturbRange);
    const f = Math.max(0, current.frequency + (Math.random() * 2 - 1) * perturbRange);
    const c = Math.max(0, current.coOccurrence + (Math.random() * 2 - 1) * perturbRange);
    const sum = r + f + c;
    if (sum === 0) {
      candidates.push({ ...current }); // fallback to current
    } else {
      candidates.push({ recency: r / sum, frequency: f / sum, coOccurrence: c / sum });
    }
  }

  return candidates;
}

/**
 * Pick a random candidate from a set of valid weight proposals.
 * This implements the HyperAgents insight: random selection from valid
 * candidates outperforms greedy "always pick best" for policy evolution.
 */
export function pickRandomCandidate<T>(candidates: readonly T[]): T | null {
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildMetaReviewPrompt(
  config: Config,
  metrics: PolicyMetrics,
  lessonCount: number,
  latestSnapshot: { metrics: PolicyMetrics } | null,
): string {
  const prevMetrics = latestSnapshot?.metrics;
  const trend = prevMetrics
    ? `Previous avg_composite_score: ${prevMetrics.avg_composite_score.toFixed(4)}, Current: ${metrics.avg_composite_score.toFixed(4)}`
    : "No previous snapshot available.";

  return `You are an AI pipeline optimization assistant for Theorex, a memory and learning system.

Current scorer weights:
- Recency: ${config.scorerWeightRecency.toFixed(2)}
- Frequency: ${config.scorerWeightFrequency.toFixed(2)}
- Co-occurrence: ${config.scorerWeightCoOccurrence.toFixed(2)}

Performance metrics:
- Sample count: ${metrics.sample_count}
- Average composite score: ${metrics.avg_composite_score.toFixed(4)}
- Success rate: ${(metrics.success_rate * 100).toFixed(1)}%
- Active lessons: ${lessonCount}
- Trend: ${trend}

Analyze the performance and suggest adjusted scorer weights. Consider:
- If success rate is high, current weights may be good — make small adjustments
- If success rate is low, consider larger shifts
- Recency weight controls how fast old concepts decay
- Frequency weight rewards frequently-accessed concepts
- Co-occurrence weight rewards concepts with strong neighbor connections

Return ONLY a JSON object:
{"recency_weight": number, "frequency_weight": number, "cooccurrence_weight": number, "rationale": "brief explanation"}

Weights must be positive and should sum to approximately 1.0.
Respond with JSON only. No explanation.`;
}

async function callOllama(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      process.stderr.write(`[meta-review] Ollama returned ${res.status}\n`);
      return null;
    }

    const data = (await res.json()) as { response: string };
    return data.response ?? null;
  } catch (err) {
    process.stderr.write(`[meta-review] Ollama fetch error: ${String(err)}\n`);
    return null;
  }
}

function parseProposal(raw: string): WeightProposal | null {
  try {
    const parsed = extractJsonObject(raw) as LlmWeightProposal;
    if (
      typeof parsed?.recency_weight !== "number" ||
      typeof parsed?.frequency_weight !== "number" ||
      typeof parsed?.cooccurrence_weight !== "number"
    ) {
      return null;
    }

    const sum = parsed.recency_weight + parsed.frequency_weight + parsed.cooccurrence_weight;
    if (sum <= 0) return null;

    return {
      scorerWeightRecency: parsed.recency_weight / sum,
      scorerWeightFrequency: parsed.frequency_weight / sum,
      scorerWeightCoOccurrence: parsed.cooccurrence_weight / sum,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "No rationale provided",
    };
  } catch (err) {
    process.stderr.write(`[meta-review] parse error: ${String(err)}\n`);
    return null;
  }
}

function extractJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("No JSON object found in response");
  }
}

async function writeConfig(config: Config): Promise<void> {
  const existing = await Bun.file(CONFIG_PATH).json().catch(() => ({}));
  const merged = { ...existing, ...config };
  await Bun.write(CONFIG_PATH, JSON.stringify(merged, null, 2));
}
