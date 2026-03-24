// evolve/ingest-trades.ts — Phase 13: Singularity trade outcome ingestion.
// Reads shadow_outcomes.jsonl and converts closed trades to OutcomeRecords.
// Uses a watermark (set of seen trade_ids) to avoid re-ingesting on repeat runs.
// Designed to run nightly on M1 via the Theorex nightly script.

import { rename, mkdir } from "node:fs/promises";
import { buildOutcome, recordOutcome } from "./outcome";
import type { OutcomeRecord } from "./outcome";

export const DEFAULT_WATERMARKS_DIR = "data/ingest-watermarks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema of a closed Singularity trade from shadow_outcomes.jsonl */
export interface SingularityTrade {
  readonly trade_id: string;
  readonly direction: "BUY" | "SELL";
  readonly session: string;            // LONDON / ASIAN / NY
  readonly regime: string;             // normal / spike / etc.
  readonly prob: number;               // entry probability (0–1)
  readonly lots: number;
  readonly entry_price: number;
  readonly sl: number;
  readonly tp: number;
  readonly exit_price: number;
  readonly outcome: "TP" | "SL" | "TIMEOUT";
  readonly pnl: number;                // raw P&L in account currency
  readonly r: number;                  // R multiple (negative = loss)
  readonly ticks_held: number;
  readonly dispatch_time: string;      // ISO 8601
  readonly closed_at: string;          // ISO 8601
}

export interface IngestResult {
  readonly ingested: number;
  readonly skipped: number;           // already seen (watermarked)
  readonly malformed: number;         // parse failures
}

export interface IngestOptions {
  readonly filePath: string;
  readonly agentId: string;
  readonly outcomesDir?: string;
  readonly watermarksDir?: string;
}

// ---------------------------------------------------------------------------
// convertTradeToOutcome
// ---------------------------------------------------------------------------

/**
 * Convert a SingularityTrade to an OutcomeRecord.
 *
 * success: TP trades → true; SL → false; TIMEOUT → based on pnl sign.
 * explicit_score: R multiple normalized to 0.0–1.0 (R=2 → ~0.8, R=-1 → ~0.25).
 * tags: [session, direction, regime, "singularity"] — all lowercase.
 */
export function convertTradeToOutcome(
  trade: SingularityTrade,
  agentId: string,
): OutcomeRecord {
  const success =
    trade.outcome === "TP"
      ? true
      : trade.outcome === "SL"
        ? false
        : trade.pnl > 0;

  // Normalize R to 0.0–1.0:
  // R=3+ → 1.0, R=2 → 0.8, R=1 → 0.65, R=0 → 0.5, R=-0.5 → 0.35, R=-1 → 0.25
  const explicit_score = Math.min(1, Math.max(0, 0.5 + trade.r * 0.15));

  const decision =
    `${trade.session} ${trade.direction} entry — prob=${trade.prob.toFixed(2)} ` +
    `regime=${trade.regime} entry=${trade.entry_price} sl=${trade.sl} tp=${trade.tp}`;

  const result =
    `${trade.outcome} at ${trade.exit_price} — ` +
    `R=${trade.r.toFixed(2)} pnl=${trade.pnl.toFixed(2)} ticks=${trade.ticks_held}`;

  const tags = [
    trade.session.toLowerCase(),
    trade.direction.toLowerCase(),
    trade.regime.toLowerCase(),
    "singularity",
  ].filter(Boolean);

  const base = buildOutcome({ agentId, decision, result, success, tags });
  return {
    ...base,
    timestamp: trade.closed_at,  // use actual close time, not ingest time
    explicit_score,
  };
}

// ---------------------------------------------------------------------------
// ingestTradeFile
// ---------------------------------------------------------------------------

/**
 * Read a shadow_outcomes.jsonl file, skip already-seen trade_ids, and write
 * new trades as OutcomeRecords. Updates the watermark on completion.
 */
export async function ingestTradeFile(opts: IngestOptions): Promise<IngestResult> {
  const {
    filePath,
    agentId,
    outcomesDir = "data/outcomes",
    watermarksDir = DEFAULT_WATERMARKS_DIR,
  } = opts;

  const sourceName = filePath.split("/").pop()?.replace(".jsonl", "") ?? "trades";
  const seen = await readWatermark(sourceName, watermarksDir);

  let text: string;
  try {
    text = await Bun.file(filePath).text();
  } catch {
    return { ingested: 0, skipped: 0, malformed: 0 };
  }

  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  let ingested = 0;
  let skipped = 0;
  let malformed = 0;

  const newSeen = new Set(seen);

  for (const line of lines) {
    let trade: SingularityTrade;
    try {
      trade = JSON.parse(line) as SingularityTrade;
    } catch {
      malformed++;
      continue;
    }

    if (!trade.trade_id || !trade.outcome) {
      malformed++;
      continue;
    }

    if (seen.has(trade.trade_id)) {
      skipped++;
      continue;
    }

    const outcome = convertTradeToOutcome(trade, agentId);
    await recordOutcome(outcome, outcomesDir);
    newSeen.add(trade.trade_id);
    ingested++;
  }

  if (ingested > 0) {
    await writeWatermark(sourceName, newSeen, watermarksDir);
  }

  return { ingested, skipped, malformed };
}

// ---------------------------------------------------------------------------
// Watermark store — tracks which trade_ids have been ingested
// ---------------------------------------------------------------------------

export async function readWatermark(
  sourceName: string,
  dir: string = DEFAULT_WATERMARKS_DIR,
): Promise<Set<string>> {
  try {
    const raw = await Bun.file(`${dir}/${sourceName}.json`).json() as { ids: string[] };
    return new Set(raw.ids ?? []);
  } catch {
    return new Set();
  }
}

export async function writeWatermark(
  sourceName: string,
  ids: Set<string>,
  dir: string = DEFAULT_WATERMARKS_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${sourceName}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify({ ids: [...ids] }));
  await rename(tmpPath, filePath);
}
