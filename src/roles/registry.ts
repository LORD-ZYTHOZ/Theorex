// roles/registry.ts — Phase 18: Formal Agent Roles
// Defines capability contracts for each agent.
// Routing learns which agent handles which task class.
// All functions are pure or side-effect-isolated; no mutation.

import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = "orchestrator" | "operative";
export type Capability =
  | "synthesize"
  | "review"
  | "route"
  | "analyze"
  | "retrieve"
  | "suggest"
  | "code"
  | "trade"
  | "monitor";
export type QueryType = "code" | "math" | "retrieval" | "synthesis" | "general";

export interface AgentProfile {
  readonly agent_id: string;
  readonly role: AgentRole;
  readonly capabilities: readonly Capability[];
  readonly preferred_query_types: readonly QueryType[];
  readonly model_preference: string;
  readonly description: string;
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Default profiles
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_PROFILES: readonly AgentProfile[] = [
  {
    agent_id: "main",
    role: "orchestrator",
    capabilities: ["synthesize", "review", "route"],
    preferred_query_types: ["synthesis", "general"],
    model_preference: "claude-sonnet",
    description: "Main Claude orchestrator — synthesizes, reviews, routes to operatives",
    active: true,
  },
  {
    agent_id: "qwen-sage",
    role: "operative",
    capabilities: ["analyze", "retrieve", "suggest"],
    preferred_query_types: ["retrieval", "code", "math"],
    model_preference: "qwen3-32b",
    description: "Qwen3 32B operative — deep analysis, retrieval, code/math tasks",
    active: true,
  },
  {
    agent_id: "secretarius",
    role: "operative",
    capabilities: ["monitor", "retrieve"],
    preferred_query_types: ["retrieval", "general"],
    model_preference: "ministral-3b",
    description: "Ministral operative — lightweight monitoring and fast retrieval",
    active: true,
  },
] as const;

const DEFAULT_PROFILES_PATH = join("data", "agent-profiles.json");

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Find a profile by agent_id.
 * Returns null if not found.
 */
export function getProfile(
  agentId: string,
  profiles: readonly AgentProfile[] = DEFAULT_AGENT_PROFILES,
): AgentProfile | null {
  return profiles.find((p) => p.agent_id === agentId) ?? null;
}

/**
 * Return all active profiles that have the given capability.
 */
export function getCapableAgents(
  capability: Capability,
  profiles: readonly AgentProfile[] = DEFAULT_AGENT_PROFILES,
): readonly AgentProfile[] {
  return profiles.filter(
    (p) => p.active && (p.capabilities as readonly string[]).includes(capability),
  );
}

/**
 * Find the best active agent for a given query type.
 * Prefers operatives over orchestrators for specialised tasks.
 * Falls back to the first active orchestrator if no operative matches.
 */
export function routeToAgent(
  queryType: QueryType,
  profiles: readonly AgentProfile[] = DEFAULT_AGENT_PROFILES,
): AgentProfile | null {
  const active = profiles.filter((p) => p.active);

  // First: look for an operative that prefers this query type
  const operativeMatch = active.find(
    (p) =>
      p.role === "operative" &&
      (p.preferred_query_types as readonly string[]).includes(queryType),
  );
  if (operativeMatch) return operativeMatch;

  // Second: any operative (any preferred type) — not used here; fall to orchestrator
  // Fall back: orchestrator that prefers this query type
  const orchestratorMatch = active.find(
    (p) =>
      p.role === "orchestrator" &&
      (p.preferred_query_types as readonly string[]).includes(queryType),
  );
  if (orchestratorMatch) return orchestratorMatch;

  // Last resort: first active orchestrator
  return active.find((p) => p.role === "orchestrator") ?? null;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Write profiles to data/agent-profiles.json atomically via Bun.write.
 */
export async function saveProfiles(
  profiles: readonly AgentProfile[],
  path = DEFAULT_PROFILES_PATH,
): Promise<void> {
  const json = JSON.stringify(profiles, null, 2);
  await Bun.write(path, json);
}

/**
 * Read profiles from data/agent-profiles.json.
 * Returns DEFAULT_AGENT_PROFILES if the file is missing or unreadable.
 */
export async function loadProfiles(
  path = DEFAULT_PROFILES_PATH,
): Promise<readonly AgentProfile[]> {
  try {
    const raw = await Bun.file(path).json();
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_AGENT_PROFILES;
    return raw as readonly AgentProfile[];
  } catch {
    return DEFAULT_AGENT_PROFILES;
  }
}
