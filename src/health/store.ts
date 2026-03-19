// health/store.ts — Phase 21: Agent Health Monitoring
// Persist HealthSnapshot records to data/health/{agent_id}.json.
// Atomic writes (tmp→rename). No mutation of existing objects.

import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { AgentStatus } from "./probe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthSnapshot {
  readonly agent_id: string;
  readonly timestamp: string;          // ISO 8601 — time of this check
  readonly status: AgentStatus;
  readonly endpoint: string | null;    // null for agents with no HTTP endpoint
  readonly ping_ms: number | null;     // null if unreachable or no endpoint
  readonly success_rate_7d: number;
  readonly avg_latency_ms: number | null;
  readonly trace_count_7d: number;
  readonly last_trace_at: string | null;
  readonly consecutive_failures: number; // increments each check, resets on healthy/degraded
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const DEFAULT_HEALTH_DIR = "data/health";

function snapshotPath(agentId: string, dir: string): string {
  return join(dir, `${agentId}.json`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read the latest snapshot for an agent.
 * Returns null if no snapshot exists yet.
 */
export async function readHealthSnapshot(
  agentId: string,
  dir: string = DEFAULT_HEALTH_DIR,
): Promise<HealthSnapshot | null> {
  try {
    const raw = await Bun.file(snapshotPath(agentId, dir)).json();
    return raw as HealthSnapshot;
  } catch {
    return null;
  }
}

/**
 * Read all health snapshots from the health directory.
 * Silently skips files that fail to parse.
 */
export async function readAllHealthSnapshots(
  dir: string = DEFAULT_HEALTH_DIR,
): Promise<HealthSnapshot[]> {
  try {
    const glob = new Bun.Glob("*.json");
    const files: string[] = [];
    for await (const f of glob.scan({ cwd: dir, onlyFiles: true })) {
      files.push(f);
    }
    const results = await Promise.allSettled(
      files.map(async (f) => {
        const raw = await Bun.file(join(dir, f)).json();
        return raw as HealthSnapshot;
      }),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<HealthSnapshot> => r.status === "fulfilled",
      )
      .map((r) => r.value);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Atomically write a HealthSnapshot to data/health/{agent_id}.json.
 * Uses tmp→rename pattern to prevent partial writes.
 */
export async function writeHealthSnapshot(
  snap: HealthSnapshot,
  dir: string = DEFAULT_HEALTH_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = snapshotPath(snap.agent_id, dir);
  const tmp = `${target}.tmp`;
  await Bun.write(tmp, JSON.stringify(snap, null, 2));
  await rename(tmp, target);
}
