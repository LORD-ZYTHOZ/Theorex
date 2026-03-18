// family/notify.ts — Notify agents of config/pack changes (Phase 12).
// When deployment mode, profession pack, or other live config is updated,
// call notifyAgents() to write a 'change' observation to each agent's axon.
// The observation surfaces in the next session's boot context — agent knows
// to re-check its memory and adapt to the updated environment.
//
// Usage:
//   notifyAgents("profession pack updated to trading")
//   notifyAgents("deployment mode changed to business", ["main", "qwen-sage"])

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeToAgent } from "./write";
import { agentAxonPath, AGENT_SOURCE_WEIGHTS } from "./paths";
import { loadConfig } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyResult {
  readonly agent_id: string;
  readonly success: boolean;
  readonly error?: string;
}

export interface NotifySummary {
  readonly reason: string;
  readonly notified: readonly NotifyResult[];
  readonly success_count: number;
  readonly fail_count: number;
}

// ---------------------------------------------------------------------------
// Agent discovery
// ---------------------------------------------------------------------------

/**
 * Discover all agent IDs that have a live theorex axon on disk.
 * Scans agentAxonDir for <id>/theorex/axon.json entries.
 * Falls back to AGENT_SOURCE_WEIGHTS keys if dir is unreadable.
 */
async function discoverAgentIds(agentAxonDir: string): Promise<string[]> {
  try {
    const entries = await readdir(agentAxonDir, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const axonPath = agentAxonPath(entry.name, agentAxonDir);
      try {
        const f = Bun.file(axonPath);
        if (await f.exists()) ids.push(entry.name);
      } catch {
        // axon.json not present for this agent — skip
      }
    }
    return ids.length > 0 ? ids : Object.keys(AGENT_SOURCE_WEIGHTS);
  } catch {
    // Directory unreadable — fall back to known agents
    return Object.keys(AGENT_SOURCE_WEIGHTS);
  }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Write a 'change' observation to each agent's axon announcing a config update.
 * Agents will see this at next session via boot-inject / flash-inject.
 *
 * @param reason   Human-readable description of what changed (e.g. "profession pack updated to trading")
 * @param agentIds Optional list of specific agent IDs. Defaults to all discovered agents.
 * @param config   Optional partial DispatchConfig override for testing.
 */
export async function notifyAgents(
  reason: string,
  agentIds?: string[],
  overrideAgentAxonDir?: string,
): Promise<NotifySummary> {
  const cfg = await loadConfig().catch(() => null);
  const agentAxonDir = overrideAgentAxonDir
    ?? cfg?.agentAxonDir
    ?? join(homedir(), ".openclaw", "agents");

  const ids = agentIds ?? (await discoverAgentIds(agentAxonDir));

  const observation = `Config updated: ${reason}. Re-check your active context and adapt if needed.`;

  const results = await Promise.all(
    ids.map(async (agent_id): Promise<NotifyResult> => {
      try {
        if (!cfg) throw new Error("config unavailable");
        await writeToAgent(agent_id, observation, cfg, Date.now(), "change");
        return { agent_id, success: true };
      } catch (err) {
        return {
          agent_id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return {
    reason,
    notified: results,
    success_count: results.filter((r) => r.success).length,
    fail_count: results.filter((r) => !r.success).length,
  };
}
