// context-slide/monitor.ts — Read context metrics from statusline bridge file.
// Phase 15: Reads /tmp/claude-ctx-{session_id}.json (written by gsd-statusline.js).
// Returns null if metrics unavailable (subagent, fresh session, stale data).

import { join } from "node:path";
import { tmpdir } from "node:os";

const STALE_SECONDS = 60;

export interface ContextMetrics {
  readonly used_pct: number;          // 0–100 percentage of context used
  readonly remaining_pct: number;     // 0–100 percentage remaining
  readonly timestamp: number;         // unix seconds
}

/**
 * Read current context metrics for a session.
 * Returns null if metrics file missing, stale, or unreadable.
 */
export async function readContextMetrics(sessionId: string): Promise<ContextMetrics | null> {
  const metricsPath = join(tmpdir(), `claude-ctx-${sessionId}.json`);
  try {
    const file = Bun.file(metricsPath);
    const exists = await file.exists();
    if (!exists) return null;

    const raw = await file.json() as Record<string, unknown>;
    const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : 0;

    // Reject stale metrics
    const nowSecs = Math.floor(Date.now() / 1000);
    if (timestamp > 0 && nowSecs - timestamp > STALE_SECONDS) return null;

    const used_pct = typeof raw.used_pct === "number" ? raw.used_pct : 0;
    const remaining_pct = typeof raw.remaining_percentage === "number"
      ? raw.remaining_percentage
      : 100 - used_pct;

    return { used_pct, remaining_pct, timestamp };
  } catch {
    return null;
  }
}

/**
 * Read slide state — tracks cooldown between compressions.
 * Returns default state if file missing.
 */
export interface SlideState {
  readonly calls_since_compress: number;
  readonly last_compress_at: string | null; // ISO 8601
  readonly compression_count: number;
}

export async function readSlideState(sessionId: string): Promise<SlideState> {
  const statePath = join(tmpdir(), `theorex-slide-${sessionId}.json`);
  try {
    const file = Bun.file(statePath);
    const exists = await file.exists();
    if (!exists) return { calls_since_compress: 0, last_compress_at: null, compression_count: 0 };
    return await file.json() as SlideState;
  } catch {
    return { calls_since_compress: 0, last_compress_at: null, compression_count: 0 };
  }
}

export async function writeSlideState(sessionId: string, state: SlideState): Promise<void> {
  const statePath = join(tmpdir(), `theorex-slide-${sessionId}.json`);
  await Bun.write(statePath, JSON.stringify(state, null, 2));
}

/**
 * Determine if a compression should be triggered.
 *
 * Triggers when:
 * - used_pct >= threshold (default 50%)
 * - calls_since_compress >= cooldown (default 20) OR first compression
 */
export function shouldCompress(
  metrics: ContextMetrics,
  state: SlideState,
  threshold: number,
  cooldown: number
): boolean {
  if (metrics.used_pct < threshold * 100) return false;
  if (state.last_compress_at === null) return true; // first time
  return state.calls_since_compress >= cooldown;
}
