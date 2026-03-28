// dispatch/worker.ts — Phase 16 Parallel Background Processing.
// Dispatches tasks to local LLM (Qwen3 32B 4-bit) when context
// pressure reaches 50%. Fire-and-forget — results written to agent axon.
//
// Flow:
//   1. route() picks model tier (all tiers → qwen3-32b-4bit on port 8082)
//   2. readPowerState() + getDispatchAdvice() may downgrade large→medium on battery
//   3. LM_INFERENCE_START emitted on EventBus
//   4. Bun.fetch POST to LM Studio /v1/chat/completions (120s timeout — Qwen3 can spike under load)
//   5. LM_INFERENCE_END emitted on EventBus (trace assembled automatically)
//   6. Result written to agent axon as a 'discovery' observation
//   7. DispatchResult returned

import { route } from "../router/heuristic.ts";
import type { RoutingInput } from "../router/heuristic.ts";
import { createBreaker } from "../resilience/circuit";
import { createRetry } from "../resilience/retry";
import { emitError } from "../resilience/error-bus";
import { classifyError, type ErrorEvent } from "../resilience/types";
import { readPowerState, getDispatchAdvice } from "../router/energy.ts";
import { emit } from "../trace/bus.ts";
import { writeToAgent } from "../family/write.ts";
import { loadConfig } from "../config.ts";
import { loadProfiles, routeToAgent } from "../roles/index.ts";
import { patchOutcomeTraceId } from "../evolve/outcome.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchTask {
  readonly id: string;
  readonly agent_id: string;
  readonly task: string;
  readonly context_pct: number;
  readonly query_tokens: number;
  readonly tags: readonly string[];
  readonly created_at: string;
  readonly outcome_id?: string;    // optional — if set, trace_id is patched onto this outcome after dispatch
  readonly tier_override?: "large" | "medium" | "small"; // optional — bypasses HeuristicRouter + energy check
  readonly max_tokens?: number; // optional — override default 1024 max_tokens for LM Studio calls
}

export interface DispatchResult {
  readonly task_id: string;
  readonly model_used: string;
  readonly response: string;
  readonly latency_ms: number;
  readonly success: boolean;
  readonly error?: string;
  readonly written_to_axon: boolean;
  readonly trace_id?: string; // the EventBus trace ID for this dispatch (if known)
}

export interface DispatchConfig {
  readonly largeModelUrl: string;
  readonly mediumModelUrl: string;
  readonly timeoutMs: number;
  readonly contextTriggerPct: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  largeModelUrl: "http://localhost:8082",
  mediumModelUrl: "http://localhost:8082",
  timeoutMs: 120_000,
  contextTriggerPct: 50,
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the LM Studio chat completions URL from model tier. */
function resolveEndpoint(
  tier: "large" | "medium" | "small",
  cfg: DispatchConfig,
): string {
  if (tier === "large") return `${cfg.largeModelUrl}/v1/chat/completions`;
  return `${cfg.mediumModelUrl}/v1/chat/completions`;
}

/** Resolve human-readable model name for trace payloads. */
function resolveModelName(tier: "large" | "medium" | "small"): string {
  if (tier === "large") return "qwen3-32b";
  return "qwen3-32b";
}

/** POST to LM Studio and return { text, completion_tokens, latency_ms }. */
async function callLmStudio(
  url: string,
  task: string,
  timeoutMs: number,
  tier: "large" | "medium" | "small" = "medium",
  maxTokens: number = 1024,
): Promise<{ readonly text: string; readonly completion_tokens: number; readonly latency_ms: number }> {
  // Qwen3 runs in chain-of-thought mode by default — thinking tokens exhaust the
  // budget before the actual answer is produced, causing 60-90s response times.
  // Prepending /no_think disables CoT and keeps responses under 10s.
  const content = tier === "large" ? `/no_think ${task}` : task;
  const body = JSON.stringify({
    messages: [{ role: "user", content }],
    max_tokens: maxTokens,
    temperature: 0.3,
  });

  const start = Date.now();

  const res = await Bun.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`LM Studio returned HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { completion_tokens?: number };
  };

  const raw = json.choices?.[0]?.message?.content ?? "";
  // Strip Qwen3 <think>...</think> blocks so only the actual answer reaches the axon
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")  // Qwen3 CoT blocks
    .replace(/<\|im_end\|>/g, "")                  // Qwen3 end-of-turn token
    .trim();
  const completion_tokens = json.usage?.completion_tokens ?? 0;
  const latency_ms = Date.now() - start;

  return { text, completion_tokens, latency_ms };
}

/** Write a response string to the agent axon as a 'discovery' observation. */
async function writeObservation(
  agentId: string,
  response: string,
  observationType: string,
): Promise<boolean> {
  try {
    const config = await loadConfig();
    await writeToAgent(agentId, response, config, Date.now(), observationType);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a task to a local LLM.
 * Picks model via HeuristicRouter, respects battery state via EnergyDispatch,
 * emits EventBus traces, and writes the result to the agent axon.
 */
export async function dispatch(
  task: DispatchTask,
  config: Partial<DispatchConfig> = {},
): Promise<DispatchResult> {
  const cfg: DispatchConfig = { ...DEFAULT_DISPATCH_CONFIG, ...config };

  // 1. Route: classify query type and pick model tier
  // Always classify query type (for matrix tracking), but skip energy/role
  // overrides when tier_override is explicitly set by caller.
  let effectiveTier: "large" | "medium" | "small";
  const routingInput: RoutingInput = {
    agent_id: task.agent_id,
    query: task.task,
    context_pct: task.context_pct,
    query_tokens: task.query_tokens,
  };
  const routerDecision = route(routingInput);
  const queryType = routerDecision.query_type;

  if (task.tier_override) {
    // Caller explicitly chose a tier — use it, skip energy/role overrides
    effectiveTier = task.tier_override;
  } else {
    // 1b. Role registry override: if a registered operative prefers a specific
    //     model for this query type, honour it over the heuristic choice.
    const profiles = await loadProfiles().catch(() => []);
    const roleMatch = routeToAgent(routerDecision.query_type, profiles);
    let heuristicTier = routerDecision.model_tier;
    if (roleMatch) {
      const pref = roleMatch.model_preference.toLowerCase();
      if (pref.includes("qwen3") || pref.includes("large")) {
        heuristicTier = "large";
      } else if (pref.includes("ministral") || pref.includes("medium") || pref.includes("small")) {
        heuristicTier = "medium";
      }
    }

    // 2. Energy check: downgrade large → medium on low battery
    const powerState = await readPowerState();
    const advice = getDispatchAdvice(powerState, heuristicTier === "large" ? "high" : "medium");
    effectiveTier = (!advice.allow_large_model && heuristicTier === "large")
      ? ("medium" as const)
      : heuristicTier;
  }

  const modelName = resolveModelName(effectiveTier);
  const endpoint = resolveEndpoint(effectiveTier, cfg);

  // Pre-generate trace_id so we can return it to the caller and link it to
  // an outcome_id without waiting for the EventBus to assemble the trace.
  const traceId = crypto.randomUUID();

  // 3. Emit LM_INFERENCE_START — include caller-supplied trace_id
  emit("LM_INFERENCE_START", {
    agent_id: task.agent_id,
    model: modelName,
    prompt_tokens: task.query_tokens,
    query_type: queryType,
    trace_id: traceId,
  });

  // 4. Call LM Studio
  let inferenceText = "";
  let completionTokens = 0;
  let latencyMs = 0;
  let success = false;
  let errorMsg: string | undefined;

  const breaker = createBreaker(endpoint, { threshold: 3, halfOpenAfterMs: 30_000 });
  const retryPolicy = createRetry({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 });

  try {
    const result = await retryPolicy.execute(() =>
      breaker.execute(() =>
        callLmStudio(endpoint, task.task, cfg.timeoutMs, effectiveTier, task.max_tokens ?? 1024)
      )
    );
    inferenceText = result.text;
    completionTokens = result.completion_tokens;
    latencyMs = result.latency_ms;
    success = true;
  } catch (err) {
    latencyMs = 0;
    errorMsg = err instanceof Error ? err.message : String(err);

    const category = classifyError(err);
    const errorEvent: ErrorEvent = {
      id: crypto.randomUUID(),
      service: endpoint,
      category,
      severity: category === "circuit_open" ? "high" : "medium",
      message: errorMsg,
      context: { task_id: task.id, agent_id: task.agent_id, model: modelName, tier: effectiveTier },
      timestamp: new Date().toISOString(),
      agent_id: task.agent_id,
    };
    emitError(errorEvent);
  }

  // 5. Emit LM_INFERENCE_END
  emit("LM_INFERENCE_END", {
    agent_id: task.agent_id,
    model: modelName,
    prompt_tokens: task.query_tokens,
    completion_tokens: completionTokens,
    latency_ms: latencyMs,
    success,
    ...(errorMsg ? { error: errorMsg } : {}),
  });

  // 6. Write result to axon (only on success)
  const written_to_axon = success
    ? await writeObservation(task.agent_id, inferenceText, "discovery")
    : false;

  // 6b. Patch outcome_id with trace_id so trace-review can find the trace
  if (success && task.outcome_id) {
    const config = await loadConfig();
    await patchOutcomeTraceId(
      task.outcome_id,
      traceId,
      config.outcomesDir ?? "data/outcomes",
    ).catch(() => {
      // Non-fatal — don't fail the dispatch if outcome patching fails
    });
  }

  // 7. Return DispatchResult
  return {
    task_id: task.id,
    model_used: modelName,
    response: inferenceText,
    latency_ms: latencyMs,
    success,
    ...(errorMsg ? { error: errorMsg } : {}),
    written_to_axon,
    trace_id: traceId,
  };
}

// ---------------------------------------------------------------------------
// Convenience entry point
// ---------------------------------------------------------------------------

/**
 * Only dispatch if context has reached the trigger threshold (default 50%).
 * Returns null if contextPct is below the threshold — no work done.
 */
export async function dispatchIfNeeded(
  agentId: string,
  task: string,
  contextPct: number,
  config: Partial<DispatchConfig> = {},
  outcomeId?: string,
  tierOverride?: "large" | "medium" | "small",
): Promise<DispatchResult | null> {
  const cfg: DispatchConfig = { ...DEFAULT_DISPATCH_CONFIG, ...config };

  if (contextPct < cfg.contextTriggerPct) return null;

  const dispatchTask: DispatchTask = {
    id: crypto.randomUUID(),
    agent_id: agentId,
    task,
    context_pct: contextPct,
    query_tokens: Math.ceil(task.length / 4), // rough token estimate
    tags: tierOverride ? ["background", "phase16", `tier:${tierOverride}`] : ["background", "phase16"],
    created_at: new Date().toISOString(),
    ...(outcomeId ? { outcome_id: outcomeId } : {}),
    ...(tierOverride ? { tier_override: tierOverride } : {}),
  };

  return dispatch(dispatchTask, config);
}
