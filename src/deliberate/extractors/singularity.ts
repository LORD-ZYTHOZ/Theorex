// deliberate/extractors/singularity.ts — Extract Singularity trade performance
// for a specific trading session window.
//
// Reads latent_trades.jsonl, filters by date and session time window,
// then computes aggregate statistics into a SingularityReport.

import type { TradingSession, SingularityReport, TradeRecord } from "../types";

// ---------------------------------------------------------------------------
// Session time windows (UTC hours)
// ---------------------------------------------------------------------------

interface SessionWindow {
  readonly startHour: number;
  readonly endHour: number;
}

const SESSION_WINDOWS: Record<TradingSession, SessionWindow> = {
  asian:     { startHour: 0,  endHour: 8 },
  london:    { startHour: 8,  endHour: 16 },
  new_york:  { startHour: 13, endHour: 21 },
  off_hours: { startHour: 21, endHour: 24 },
} as const;

// ---------------------------------------------------------------------------
// JSONL reader
// ---------------------------------------------------------------------------

async function readTradesJsonl(path: string): Promise<readonly TradeRecord[]> {
  try {
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) return [];

    const text = await file.text();
    const lines = text.trim().split("\n").filter(Boolean);

    return lines.map((line) => {
      const parsed = JSON.parse(line) as TradeRecord;
      return parsed;
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function isInDateAndSession(
  trade: TradeRecord,
  date: string,
  window: SessionWindow,
): boolean {
  const entryDate = new Date(trade.entry_time);
  const tradeDate = entryDate.toISOString().slice(0, 10);
  if (tradeDate !== date) return false;

  const hour = entryDate.getUTCHours();
  return hour >= window.startHour && hour < window.endHour;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildEmptyReport(): SingularityReport {
  return {
    source: "singularity",
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    total_pnl: 0,
    win_rate: 0,
    avg_hold_time_ms: 0,
    largest_win: 0,
    largest_loss: 0,
    session_trades: [],
  };
}

function buildReport(trades: readonly TradeRecord[]): SingularityReport {
  if (trades.length === 0) return buildEmptyReport();

  const winning = trades.filter((t) => t.pnl > 0);
  const losing = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const avgHold = trades.reduce((sum, t) => sum + t.hold_time_ms, 0) / trades.length;
  const pnls = trades.map((t) => t.pnl);

  return {
    source: "singularity",
    total_trades: trades.length,
    winning_trades: winning.length,
    losing_trades: losing.length,
    total_pnl: totalPnl,
    win_rate: winning.length / trades.length,
    avg_hold_time_ms: avgHold,
    largest_win: Math.max(...pnls, 0),
    largest_loss: Math.min(...pnls, 0),
    session_trades: trades,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a SingularityReport for the given date and trading session.
 * Reads trades from a JSONL file, filters by date and session window,
 * and computes aggregate statistics.
 *
 * Returns an empty report (zero trades) if the file doesn't exist or
 * no trades match the criteria.
 */
export async function extractSingularityReport(
  tradesPath: string,
  session: TradingSession,
  date: string,
): Promise<SingularityReport> {
  const allTrades = await readTradesJsonl(tradesPath);
  const window = SESSION_WINDOWS[session];
  const filtered = allTrades.filter((t) => isInDateAndSession(t, date, window));
  return buildReport(filtered);
}
