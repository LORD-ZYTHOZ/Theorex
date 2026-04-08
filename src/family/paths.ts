// family/paths.ts — Canonical path resolution for per-agent and shared axon stores.
// Phase 6: AI Family Shared Layer
//
// All paths default to ~/.openclaw/ layout used by the OC agent system on M1.
// Override via config.sharedAxonPath / config.agentAxonDir for custom deployments.

import { homedir } from "node:os";
import { join } from "node:path";

const OPENCLAW_BASE = join(homedir(), ".openclaw");

/** Absolute path to a specific agent's private axon store. */
export function agentAxonPath(agentId: string, agentAxonDir = ""): string {
  const base = agentAxonDir || join(OPENCLAW_BASE, "agents");
  return join(base, agentId, "theorex", "axon.json");
}

/** Absolute path to a specific agent's personal layer (business mode). */
export function agentPersonalLayerPath(agentId: string, agentAxonDir = ""): string {
  const base = agentAxonDir || join(OPENCLAW_BASE, "agents");
  return join(base, agentId, "theorex", "personal.json");
}

/** Absolute path to the shared concept web. */
export function resolvedSharedAxonPath(configPath = ""): string {
  return configPath || join(OPENCLAW_BASE, "workspace", "theorex", "shared-axon.json");
}

/** Known agent IDs in the OC ecosystem with their source weights. */
export const AGENT_SOURCE_WEIGHTS: Record<string, number> = {
  main: 0.7,       // HADES on m4 (executive + engineering)
  "qwen-sage": 0.8,
  secretarius: 0.7,
  meridian: 0.7,   // Divergence guardian
  augur: 0.7,      // Horizon guardian
  "claude-code-agent": 1.0,
  "pi-coding-agent": 0.7,
  "ag-coding-agent": 0.7,
};

/** Source weight for a given agent_id; falls back to 0.7 for unknown agents. */
export function sourceWeightForAgent(agentId: string): number {
  return AGENT_SOURCE_WEIGHTS[agentId] ?? 0.7;
}
