// health/monitor.ts - Phase 21: Agent Health Monitoring
// Real implementation: probes endpoints, computes trace health, writes snapshots.

import { probeEndpoint, computeTraceHealth, classifyStatus, AgentStatus } from "./probe";
import { readTraces } from "../trace/bus";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthSnapshot {
  agent_id: string;
  status: AgentStatus;
  timestamp: string;
  endpoint: string | null;
  ping_ms: number | null;
  success_rate_7d: number;
  avg_latency_ms: number | null;
  trace_count_7d: number;
  last_trace_at: string | null;
  consecutive_failures: number;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent endpoints
// ---------------------------------------------------------------------------

export const AGENT_ENDPOINTS: Record<string, string | undefined> = {
  // HADES (m4) — OC gateway on m4
  "main": "http://localhost:18790/health",
  // OC sub-agents — no HTTP endpoints, health assessed via trace data only
  "claude-code-agent": undefined, // OC sub-agent (Claude Code CLI, OC-native)
  "qwen-sage": undefined,         // OC sub-agent (Qwen reasoning)
  // NOVA (m1) — OC gateway on m1, reached via m4:18789 tunnel
  "secretarius": "http://localhost:18789/health",
};

// 7-day window for trace health
const TRACE_WINDOW_DAYS = 7;
const TRACE_WINDOW_MS = TRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Snapshot persistence
// ---------------------------------------------------------------------------

async function ensureHealthDir(healthDir: string): Promise<void> {
  if (!existsSync(healthDir)) {
    await mkdir(healthDir, { recursive: true });
  }
}

async function writeSnapshot(healthDir: string, snap: HealthSnapshot): Promise<void> {
  await ensureHealthDir(healthDir);
  const path = join(healthDir, `${snap.agent_id}.json`);
  await writeFile(path, JSON.stringify(snap, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Individual agent check
// ---------------------------------------------------------------------------

export async function checkAgent(
  id: string,
  config: { healthDir?: string; healthProbeTimeoutMs?: number; tracesDir?: string },
  nowMs: number = Date.now(),
): Promise<HealthSnapshot> {
  const healthDir = config.healthDir ?? "data/health";
  const timeoutMs = config.healthProbeTimeoutMs ?? 5000;
  const tracesDir = config.tracesDir ?? "data/traces";

  const endpoint = AGENT_ENDPOINTS[id];
  const timestamp = new Date(nowMs).toISOString();

  // Probe endpoint if defined
  const probe = endpoint ? await probeEndpoint(endpoint, timeoutMs) : null;

  // Compute trace health
  const traceHealth = await computeTraceHealth(id, tracesDir, TRACE_WINDOW_MS, nowMs);

  // Classify
  const status = classifyStatus(probe, traceHealth);

  const snap: HealthSnapshot = {
    agent_id: id,
    status,
    timestamp,
    endpoint: endpoint ?? null,
    ping_ms: probe?.ping_ms ?? null,
    success_rate_7d: traceHealth.success_rate,
    avg_latency_ms: traceHealth.avg_latency_ms,
    trace_count_7d: traceHealth.count,
    last_trace_at: traceHealth.last_at,
    consecutive_failures: 0,
    metadata: {
      reachable: probe?.reachable ?? false,
    },
  };

  // Persist snapshot
  await writeSnapshot(healthDir, snap);

  return snap;
}

// ---------------------------------------------------------------------------
// Check all agents
// ---------------------------------------------------------------------------

export async function checkAllAgents(
  agentIds: readonly string[],
  config: { healthDir?: string; healthProbeTimeoutMs?: number; tracesDir?: string },
  nowMs: number = Date.now(),
): Promise<HealthSnapshot[]> {
  const results = await Promise.all(
    agentIds.map((id) => checkAgent(id, config, nowMs)),
  );
  return results;
}
