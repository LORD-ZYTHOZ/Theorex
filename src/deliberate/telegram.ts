// deliberate/telegram.ts — Telegram summary formatter for deliberation records.
// Produces a condensed, mobile-friendly message from a DeliberationRecord.

import type {
  DeliberationRecord,
  DeliberationStatus,
  SingularityReport,
  DivergentReport,
  HorizonReport,
  PerspectiveReport,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELEGRAM_CHAR_LIMIT = 4096;
const MAX_ERROR_LENGTH = 200;

const STATUS_EMOJI: Record<DeliberationStatus, string> = {
  complete: "\u2705",     // ✅
  error: "\u274C",        // ❌
  in_progress: "\u26A0\uFE0F", // ⚠️
  pending: "\u26A0\uFE0F",     // ⚠️
};

// ---------------------------------------------------------------------------
// Perspective extractors (type-safe via discriminant)
// ---------------------------------------------------------------------------

function findReport<T extends PerspectiveReport>(
  perspectives: readonly PerspectiveReport[],
  source: T["source"],
): T | undefined {
  return perspectives.find((r) => r.source === source) as T | undefined;
}

// ---------------------------------------------------------------------------
// Section formatters (each returns a line or empty string)
// ---------------------------------------------------------------------------

function formatPnl(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function formatSingularity(report: SingularityReport): string {
  const wins = report.winning_trades;
  const losses = report.losing_trades;
  const pnl = formatPnl(report.total_pnl);
  return `Singularity: ${wins}W / ${losses}L | P&L: ${pnl}`;
}

function formatDivergent(report: DivergentReport): string {
  const pct = Math.round(report.agreement_rate * 100);
  return `Divergent: ${report.signal_count} signals, ${pct}% agreement`;
}

function formatHorizon(report: HorizonReport): string {
  const pnl = formatPnl(report.unrealized_pnl);
  return `Horizon: ${report.active_positions} positions, ${pnl} unrealized`;
}

// ---------------------------------------------------------------------------
// Main formatter
// ---------------------------------------------------------------------------

export function formatTelegramSummary(record: DeliberationRecord): string {
  const { packet, status, model, error } = record;
  const perspectives = packet.perspectives;

  // Header
  const header = `\uD83D\uDCCA ${packet.session} Debrief \u2014 ${packet.date}`;

  // Perspective sections (skip missing)
  const sections: string[] = [];

  const singularity = findReport<SingularityReport>(perspectives, "singularity");
  if (singularity) sections.push(formatSingularity(singularity));

  const divergent = findReport<DivergentReport>(perspectives, "divergent");
  if (divergent) sections.push(formatDivergent(divergent));

  const horizon = findReport<HorizonReport>(perspectives, "horizon");
  if (horizon) sections.push(formatHorizon(horizon));

  // Status footer
  const statusEmoji = STATUS_EMOJI[status];
  const footer = `Status: ${statusEmoji} ${status} | Model: ${model}`;

  // Error line (if applicable)
  const errorLine = status === "error" && error
    ? `Error: ${error.length > MAX_ERROR_LENGTH ? error.slice(0, MAX_ERROR_LENGTH) + "..." : error}`
    : undefined;

  // Assemble
  const parts = [
    header,
    "",
    ...sections,
    "",
    footer,
    ...(errorLine ? [errorLine] : []),
  ];

  const result = parts.join("\n");

  // Enforce Telegram character limit by truncating if needed
  if (result.length > TELEGRAM_CHAR_LIMIT) {
    return result.slice(0, TELEGRAM_CHAR_LIMIT - 3) + "...";
  }

  return result;
}
