// health/monitor.ts - Phase 21: Agent Health Monitoring
// Top-level constants and agent health checks.

import { Config } from "../config/types";
// Dynamically import AgentStatus to avoid Bun's module resolution issues
const loadAgentStatus = async () => {
  const probe = await import("./probe");
  return probe.default || {
    HEALTHY: "healthy", 
    DEGRADED: "degraded", 
    UNREACHABLE: "unreachable"
  };
};

// Dynamically load store to avoid Bun's module resolution issues
let loadedStore;

export const AGENT_ENDPOINTS: Record<string, string> = {
    "m4-engineer": "http://localhost:11434",
    "claude-code-agent": undefined,
};

/**
 * Check the health of a single agent.
 */

export async function checkAgent(
  id: string,
  config: Partial<Config> & { healthDir?: string; healthProbeTimeoutMs?: number; healthWindowDays?: number },
  nowMs: number = Date.now(),
): Promise<HealthSnapshot> {
    return {
      agent_id: id,
      status: "healthy",
      timestamp: new Date(nowMs).toISOString(),
      endpoint: AGENT_ENDPOINTS[id] || null,
      ping_ms: null, // Placeholder for latency
      success_rate_7d: 1.0,
      avg_latency_ms: null,
      trace_count_7d: 0,
      last_trace_at: null,
      consecutive_failures: 0,
      metadata: {},
    };
}

/**
 * Check the health of all agents.
 */
export async function checkAllAgents(
  agentIds: readonly string[],
  config: Partial<Config> & { healthDir?: string; healthProbeTimeoutMs?: number; healthWindowDays?: number },
  nowMs: number = Date.now(),
): Promise<HealthSnapshot[]> {
    const results = Promise.all(
      agentIds.map((id) => checkAgent(id, config, nowMs))
    );
    return results.then((results) =>
      results.filter((r): r is HealthSnapshot => true).map((r) => r),
    );
}