// health/probe.ts — Phase 21: Agent Health Monitoring
// HTTP endpoint probing + trace-derived health metrics.
// All functions are pure or perform explicit I/O. No side effects on callers.

import { readTraces } from "../trace/bus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = "healthy" | "degraded" | "unreachable";

export interface EndpointProbe {
  readonly reachable: boolean;
  readonly ping_ms: number | null; // null if unreachable
}

export interface TraceHealth {
  readonly success_rate: number;
  readonly avg_latency_ms: number | null;
  readonly count: number;
  readonly last_at: string | null; // ISO 8601 of most recent trace
}

// ---------------------------------------------------------------------------
// Endpoint probe
// ---------------------------------------------------------------------------

/**
 * Ping an OpenAI-compatible endpoint (/v1/models) with a short timeout.
 * Returns reachable=false on any network error or timeout.
 */
export async function probeEndpoint(
  endpoint: string,
  timeoutMs: number = 3000,
): Promise<EndpointProbe> {
  const url = endpoint.replace(/\/$/, "") + "/v1/models";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const ping_ms = Date.now() - start;
    clearTimeout(timer);
    // Accept any 2xx — model list endpoint may differ across servers
    return { reachable: res.ok, ping_ms: res.ok ? ping_ms : null };
  } catch {
    clearTimeout(timer);
    return { reachable: false, ping_ms: null };
  }
}

// ---------------------------------------------------------------------------
// Trace-derived health metrics
// ---------------------------------------------------------------------------

/**
 * Compute success_rate, avg_latency, count, and last_at for a given agent_id
 * from traces within the specified rolling window (windowMs milliseconds back).
 */
export async function computeTraceHealth(
  agentId: string,
  tracesDir: string,
  windowMs: number,
  nowMs: number = Date.now(),
): Promise<TraceHealth> {
  const all = await readTraces(tracesDir);
  const cutoff = nowMs - windowMs;

  const recent = all.filter(
    (t) =>
      t.agent_id === agentId &&
      new Date(t.start_time).getTime() >= cutoff,
  );

  if (recent.length === 0) {
    return { success_rate: 0, avg_latency_ms: null, count: 0, last_at: null };
  }

  const successCount = recent.filter((t) => t.success).length;
  const totalLatency = recent.reduce((sum, t) => sum + t.latency_ms, 0);

  // Most recent by start_time
  const sorted = [...recent].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  );

  return {
    success_rate: successCount / recent.length,
    avg_latency_ms: totalLatency / recent.length,
    count: recent.length,
    last_at: sorted[0]?.start_time ?? null,
  };
}

// ---------------------------------------------------------------------------
// Status classifier
// ---------------------------------------------------------------------------

const DEGRADED_SUCCESS_THRESHOLD = 0.7; // below this → degraded
const DEGRADED_LATENCY_THRESHOLD_MS = 30_000; // above this → degraded

/**
 * Derive AgentStatus from probe + trace data.
 *
 * Rules (in order):
 *   unreachable — endpoint exists but ping failed (or no endpoint and zero traces)
 *   degraded    — ping ok but success_rate < 0.7 OR avg_latency > 30s
 *   healthy     — ping ok AND metrics within thresholds (or no endpoint, traces present)
 */
export function classifyStatus(
  probe: EndpointProbe | null, // null when agent has no HTTP endpoint
  traces: TraceHealth,
): AgentStatus {
  if (probe !== null) {
    if (!probe.reachable) return "unreachable";
    if (
      traces.count > 0 &&
      (traces.success_rate < DEGRADED_SUCCESS_THRESHOLD ||
        (traces.avg_latency_ms !== null &&
          traces.avg_latency_ms > DEGRADED_LATENCY_THRESHOLD_MS))
    ) {
      return "degraded";
    }
    return "healthy";
  }

  // No endpoint — classify from traces alone
  if (traces.count === 0) return "unreachable";
  if (traces.success_rate < DEGRADED_SUCCESS_THRESHOLD) return "degraded";
  return "healthy";
}
