// heuristic.ts — HeuristicRouter for Phase 16 model dispatch.
// Selects the best model tier based on query characteristics and context pressure.
// All functions are pure; no I/O, no side effects.

import { DEFAULT_CONFIG } from "../config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryType = "code" | "math" | "retrieval" | "synthesis" | "general";
export type ModelTier = "large" | "medium" | "small";

export interface RoutingInput {
  readonly agent_id: string;
  readonly query: string;
  readonly context_pct: number;     // 0–100, % of context window used
  readonly query_tokens: number;
  readonly urgent?: boolean;
}

export interface RoutingDecision {
  readonly model_tier: ModelTier;
  readonly model_name: string;      // e.g. "qwen3-32b", "ministral-3b", "claude-api"
  readonly reason: string;          // human-readable explanation
  readonly confidence: number;      // 0–1
  readonly query_type: QueryType;
}

export interface FallbackChain {
  readonly primary: ModelTier;
  readonly fallbacks: readonly ModelTier[];
  readonly last_resort: "claude-api";
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const CODE_KEYWORDS = new Set([
  "code", "typescript", "javascript", "python",
  "debug", "function", "class",
]);

const MATH_KEYWORDS = new Set([
  "math", "calculate", "formula", "equation", "number",
]);

const RETRIEVAL_KEYWORDS = new Set([
  "find", "search", "retrieve", "remember", "recall", "lookup",
]);

// Model name map — large/medium/small → actual model identifier.
// Reads lmStudioUrl from DEFAULT_CONFIG; callers may pass a custom map.
const DEFAULT_MODEL_NAMES: Readonly<Record<ModelTier, string>> = {
  large: "qwen3-32b",
  medium: "ministral-3b",
  small: "ministral-3b",
} as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Tokenise a query into lowercase words for keyword matching. */
function tokenise(query: string): readonly string[] {
  return query.toLowerCase().match(/[a-z]+/g) ?? [];
}

/** Classify the query type from its tokens. */
export function classifyQuery(query: string): QueryType {
  const tokens = tokenise(query);

  if (tokens.some((t) => CODE_KEYWORDS.has(t))) return "code";
  if (tokens.some((t) => MATH_KEYWORDS.has(t))) return "math";
  if (tokens.some((t) => RETRIEVAL_KEYWORDS.has(t))) return "retrieval";

  // Simple synthesis heuristic: long queries without specific signals
  if (query.length > 200) return "synthesis";

  return "general";
}

/** Resolve a ModelTier to a concrete model name. */
function resolveModelName(
  tier: ModelTier,
  modelNames: Readonly<Record<ModelTier, string>> = DEFAULT_MODEL_NAMES,
): string {
  return modelNames[tier];
}

// ---------------------------------------------------------------------------
// Core routing logic
// ---------------------------------------------------------------------------

/**
 * Route a query to the most appropriate model tier.
 * Heuristics are applied in strict priority order — first match wins.
 *
 * Priority:
 *  1. urgent=true          → small  (fastest response)
 *  2. context_pct >= 50    → large  (offload heavy context)
 *  3. query_tokens > 500   → large  (long input, needs capacity)
 *  4. code keywords        → large  (code generation / debugging)
 *  5. math keywords        → large  (reasoning-heavy)
 *  6. retrieval keywords   → medium (memory lookup, moderate cost)
 *  7. default              → medium
 */
export function route(
  input: RoutingInput,
  modelNames: Readonly<Record<ModelTier, string>> = DEFAULT_MODEL_NAMES,
): RoutingDecision {
  const query_type = classifyQuery(input.query);

  const decide = (
    tier: ModelTier,
    reason: string,
    confidence: number,
  ): RoutingDecision => ({
    model_tier: tier,
    model_name: resolveModelName(tier, modelNames),
    reason,
    confidence,
    query_type,
  });

  if (input.urgent) {
    return decide("small", "urgent flag set — fastest model selected", 0.95);
  }

  if (input.context_pct >= 50) {
    return decide(
      "large",
      `context at ${input.context_pct}% — offloading to large model`,
      0.9,
    );
  }

  if (input.query_tokens > 500) {
    return decide(
      "large",
      `query is ${input.query_tokens} tokens — large model for capacity`,
      0.85,
    );
  }

  if (query_type === "code") {
    return decide("large", "code/debug keywords detected", 0.8);
  }

  if (query_type === "math") {
    return decide("large", "math/formula keywords detected", 0.8);
  }

  if (query_type === "retrieval") {
    return decide("medium", "retrieval keywords detected", 0.75);
  }

  return decide("medium", "no strong signal — defaulting to medium", 0.6);
}

// ---------------------------------------------------------------------------
// Fallback chain
// ---------------------------------------------------------------------------

/**
 * Build a fallback chain for a routing decision.
 * If the primary model is unavailable, callers should try fallbacks in order,
 * and use claude-api as the last resort.
 */
export function buildFallbackChain(decision: RoutingDecision): FallbackChain {
  const chains: Readonly<Record<ModelTier, readonly ModelTier[]>> = {
    large: ["medium", "small"],
    medium: ["small", "large"],
    small: ["medium", "large"],
  };

  return {
    primary: decision.model_tier,
    fallbacks: chains[decision.model_tier],
    last_resort: "claude-api",
  };
}
