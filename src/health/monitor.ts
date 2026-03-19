// health/monitor.ts — Phase 21: Agent Health Monitoring
// Orchestrates endpoint probes + trace metrics → HealthSnapshot.
// Emits agent_health_change audit events when status transitions occur.
// Fire-and-forget for callers — never throws; failures are logged, not re-raised.

import { probeEndpoint, computeTraceHealth, classifyStatus } from "./probe";
import { readHealthSnapshot, writeHealthSnapshot, DEFAULT_HEALTH_DIR } from "./store";
import type { HealthSnapshot } from "./store";
import { appendAuditEvent } from "../audit/logger";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Endpoint registry
// ---------------------------------------------------------------------------

/** Known HTTP endpoints per agent_id. Agents without an entry are trace-only. */
export const AGENT_ENDPOINTS: Readonly<Record<string, string>> = {
  "qwen-sage":    "http://localhost:8082",
  "m4-engineer":  "http://localhost:8082",
  secretarius:    "http://192.168.50.28:8082",
};

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Single-agent check
// ---------------------------------------------------------------------------

/**
 * Probe one agent, compute health, write snapshot, emit audit event on change.
 * Returns the new HealthSnapshot.
 */
export async function checkAgent(
  agentId: string,
  config: Partial<Config> & { healthDir?: string; healthProbeTimeoutMs?: number; healthWindowDays?: number },
  nowMs: number = Date.now(),
): Promise<HealthSnapshot> {
  const healthDir = config.healthDir ?? DEFAULT_HEALTH_DIR;
  const probeTimeoutMs = config.healthProbeTimeoutMs ?? 3000;
  const windowDays = config.healthWindowDays ?? 7;
  const tracesDir = "data/traces";

  const endpoint = AGENT_ENDPOINTS[agentId] ?? null;

  // 1. Probe endpoint (if any)
  const probeResult = endpoint !== null
    ? await probeEndpoint(endpoint, probeTimeoutMs)
    : null;

  // 2. Compute trace-derived health
  const traceHealth = await computeTraceHealth(
    agentId,
    tracesDir,
    windowDays * DAY_MS,
    nowMs,
  );

  // 3. Classify status
  const status = classifyStatus(probeResult, traceHealth);

  // 4. Read previous snapshot to track consecutive_failures
  const previous = await readHealthSnapshot(agentId, healthDir);
  const prevConsecutiveFailures = previous?.consecutive_failures ?? 0;
  const consecutiveFailures =
    status === "unreachable"
      ? prevConsecutiveFailures + 1
      : 0;

  // 5. Build new snapshot (immutable)
  const snap: HealthSnapshot = {
    agent_id: agentId,
    timestamp: new Date(nowMs).toISOString(),
    status,
    endpoint,
    ping_ms: probeResult?.ping_ms ?? null,
    success_rate_7d: traceHealth.success_rate,
    avg_latency_ms: traceHealth.avg_latency_ms,
    trace_count_7d: traceHealth.count,
    last_trace_at: traceHealth.last_at,
    consecutive_failures: consecutiveFailures,
  };

  // 6. Write snapshot
  await writeHealthSnapshot(snap, healthDir);

  // 7. Emit audit event if status changed
  if (previous !== null && previous.status !== status) {
    void appendAuditEvent({
      type: "agent_health_change",
      timestamp: snap.timestamp,
      source: "health-monitor",
      agent_id: agentId,
      from: previous.status,
      to: status,
      endpoint: endpoint ?? "",
    }).catch(() => {});
  }

  return snap;
}

// ---------------------------------------------------------------------------
// All-agents check
// ---------------------------------------------------------------------------

/**
 * Check all known agents from the roles registry.
 * Returns snapshots for all agents (results are independent — one failure doesn't block others).
 */
export async function checkAllAgents(
  agentIds: readonly string[],
  config: Partial<Config> & { healthDir?: string; healthProbeTimeoutMs?: number; healthWindowDays?: number },
  nowMs: number = Date.now(),
): Promise<HealthSnapshot[]> {
  const results = await Promise.allSettled(
    agentIds.map((id) => checkAgent(id, config, nowMs)),
  );
  return results
    .filter(
      (r): r is PromiseFulfilledResult<HealthSnapshot> => r.status === "fulfilled",
    )
    .map((r) => r.value);
}
