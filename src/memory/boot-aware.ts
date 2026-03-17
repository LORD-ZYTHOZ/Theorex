// memory/boot-aware.ts — Context-window-aware boot injection builder.
// Phase 22: Context-Aware Boot
//
// Builds a boot context string sized to fit within the target model's token budget.
// Model profiles are hardcoded defaults; concept_limit and boot_budget_tokens gate
// how many concepts are included and whether the text must be trimmed.

import { AxonStore } from "../axon/store";
import { agentAxonPath } from "../family/paths";
import { DEFAULT_CONFIG } from "../config";
import { compositeScore } from "../axon/scorer";

// ---------------------------------------------------------------------------
// Model profiles
// ---------------------------------------------------------------------------

export interface ModelProfile {
  readonly name: string;
  readonly max_context_tokens: number;
  readonly boot_budget_tokens: number;
  readonly concept_limit: number;
}

export const MODEL_PROFILES: Record<string, ModelProfile> = {
  "ministral-3b":  { name: "ministral-3b",  max_context_tokens: 32768,  boot_budget_tokens: 4096,  concept_limit: 15 },
  "qwen3-32b":     { name: "qwen3-32b",     max_context_tokens: 32768,  boot_budget_tokens: 6144,  concept_limit: 25 },
  "claude-opus":   { name: "claude-opus",   max_context_tokens: 200000, boot_budget_tokens: 20000, concept_limit: 80 },
  "claude-sonnet": { name: "claude-sonnet", max_context_tokens: 200000, boot_budget_tokens: 16000, concept_limit: 60 },
  "default":       { name: "default",       max_context_tokens: 32768,  boot_budget_tokens: 4096,  concept_limit: 20 },
};

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

/** Return the profile for modelName, falling back to 'default' if unknown. */
export function getModelProfile(modelName: string): ModelProfile {
  return MODEL_PROFILES[modelName] ?? MODEL_PROFILES["default"]!;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface ConceptEntry {
  readonly label: string;
  readonly score: number;
  readonly freq: number;
  readonly agentId: string;
}

/** Load and score all non-SLEEPING nodes from an axon, returning sorted entries. */
async function loadScoredConcepts(axonPath: string): Promise<readonly ConceptEntry[]> {
  const store = await AxonStore.load(axonPath);
  const nowMs = Date.now();
  const entries: ConceptEntry[] = [];

  for (const key of store.graph.nodes()) {
    const attrs = store.graph.getNodeAttributes(key);
    if (attrs.relevance_tier === "SLEEPING") continue;

    const neighborStrengths = store.graph
      .neighbors(key)
      .map((nbr) => {
        const edgeKey = store.graph.edge(key, nbr);
        return edgeKey ? store.graph.getEdgeAttributes(edgeKey).strength : 0;
      });

    const score = compositeScore(
      attrs.last_seen,
      attrs.frequency_count,
      neighborStrengths,
      nowMs,
      DEFAULT_CONFIG,
    );

    const label = attrs.surface_form
      .replace(/[:.!,;]+\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!label || label.length < 4) continue;

    entries.push({
      label,
      score,
      freq: attrs.frequency_count,
      agentId: attrs.agent_id || "unknown",
    });
  }

  return entries.sort((a, b) => b.score - a.score);
}

/** Format a slice of concept entries into a text block. */
function formatConcepts(entries: readonly ConceptEntry[]): string {
  const lines = entries.map((e) => {
    const freqTag = e.freq > 3 ? ` (x${e.freq})` : "";
    return `- ${e.label}${freqTag}`;
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build a boot context string sized to the target model's token budget.
 *
 * Steps:
 *  1. Resolve ModelProfile from modelName (falls back to 'default').
 *  2. Load the agent's axon from axonPath (or the default ~/.openclaw path).
 *  3. Score all concepts and take the top concept_limit.
 *  4. Reduce the slice until the formatted text fits within boot_budget_tokens.
 *  5. Prepend a header line and return the full string.
 */
export async function buildContextAwareBootContext(
  agentId: string,
  modelName?: string,
  axonPath?: string,
): Promise<string> {
  const profile = getModelProfile(modelName ?? "default");
  const resolvedAxonPath = axonPath ?? agentAxonPath(agentId);

  const allConcepts = await loadScoredConcepts(resolvedAxonPath);

  // Start at concept_limit and reduce until text fits the token budget
  let n = Math.min(profile.concept_limit, allConcepts.length);
  let bodyText = formatConcepts(allConcepts.slice(0, n));

  while (n > 0 && estimateTokens(bodyText) > profile.boot_budget_tokens) {
    n -= 1;
    bodyText = formatConcepts(allConcepts.slice(0, n));
  }

  const header = `[Boot: ${profile.name} | budget: ${profile.boot_budget_tokens}t | concepts: ${n}]`;

  if (n === 0) {
    return `${header}\n_No concepts within budget._`;
  }

  return `${header}\n${bodyText}`;
}
