// deliberate/writer.ts — Writes deliberation records as JSON + markdown.
// Atomic JSON write via tmp→rename. Markdown rendered from record data.

import { join } from "node:path";
import { rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import type {
  DeliberationRecord,
  PerspectiveReport,
  SingularityReport,
  DivergentReport,
  HorizonReport,
} from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WriteOptions {
  readonly force?: boolean;
}

export interface WriteResult {
  readonly jsonPath: string;
  readonly mdPath: string;
}

/**
 * Writes a deliberation record as JSON + markdown files.
 * JSON is written atomically via tmp→rename.
 * Throws if files already exist and `force` is not true.
 */
export async function writeDeliberation(
  record: DeliberationRecord,
  dir: string,
  opts?: WriteOptions,
): Promise<WriteResult> {
  await mkdir(dir, { recursive: true });

  const base = `${record.date}-${record.session}`;
  const jsonPath = join(dir, `${base}.json`);
  const mdPath = join(dir, `${base}.md`);

  // Dedup check
  if (!opts?.force) {
    const jsonExists = await Bun.file(jsonPath).exists();
    if (jsonExists) {
      throw new Error(`Deliberation file already exists: ${jsonPath}`);
    }
  }

  // Atomic JSON write: tmp → rename
  const tmpPath = join(tmpdir(), `deliberation-${crypto.randomUUID()}.json`);
  await Bun.write(tmpPath, JSON.stringify(record, null, 2));
  await rename(tmpPath, jsonPath);

  // Markdown write
  const md = renderMarkdown(record);
  await Bun.write(mdPath, md);

  return { jsonPath, mdPath };
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

/**
 * Renders a human-readable markdown debrief from a deliberation record.
 */
export function renderMarkdown(record: DeliberationRecord): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Deliberation: ${record.date} ${record.session}\n`);
  sections.push(`| Field | Value |`);
  sections.push(`|-------|-------|`);
  sections.push(`| Status | ${record.status} |`);
  sections.push(`| Model | ${record.model} |`);
  sections.push(`| Created | ${record.created_at} |`);
  if (record.completed_at) {
    sections.push(`| Completed | ${record.completed_at} |`);
  }
  sections.push("");

  // Perspectives
  sections.push("## Perspectives\n");
  for (const perspective of record.packet.perspectives) {
    sections.push(renderPerspective(perspective));
  }

  // Response / Analysis
  if (record.response) {
    sections.push("## Analysis\n");
    sections.push(record.response);
    sections.push("");
  }

  // Timing footer
  const timingParts: string[] = [];
  if (record.tokens_used !== undefined) {
    timingParts.push(`Tokens: ${record.tokens_used}`);
  }
  if (record.latency_ms !== undefined) {
    timingParts.push(`Latency: ${record.latency_ms}ms`);
  }
  if (timingParts.length > 0) {
    sections.push("---\n");
    sections.push(`*${timingParts.join(" | ")}*`);
    sections.push("");
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Perspective renderers
// ---------------------------------------------------------------------------

function renderPerspective(report: PerspectiveReport): string {
  switch (report.source) {
    case "singularity":
      return renderSingularity(report);
    case "divergent":
      return renderDivergent(report);
    case "horizon":
      return renderHorizon(report);
  }
}

function renderSingularity(r: SingularityReport): string {
  const lines = [
    `### Singularity\n`,
    `- Total trades: ${r.total_trades}`,
    `- Winning: ${r.winning_trades} | Losing: ${r.losing_trades}`,
    `- Win rate: ${(r.win_rate * 100).toFixed(1)}%`,
    `- Total PnL: ${r.total_pnl.toFixed(2)}`,
    `- Largest win: ${r.largest_win.toFixed(2)} | Largest loss: ${r.largest_loss.toFixed(2)}`,
    `- Avg hold time: ${r.avg_hold_time_ms}ms`,
    "",
  ];
  return lines.join("\n");
}

function renderDivergent(r: DivergentReport): string {
  const lines = [
    `### Divergent\n`,
    `- Signal count: ${r.signal_count}`,
    `- Agreement rate: ${(r.agreement_rate * 100).toFixed(1)}%`,
  ];
  if (r.signals.length > 0) {
    lines.push(`- Latest signal: ${r.signals[0].direction} (confidence: ${r.signals[0].confidence})`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderHorizon(r: HorizonReport): string {
  const lines = [
    `### Horizon\n`,
    `- Active positions: ${r.active_positions}`,
    `- Total exposure: ${r.total_exposure.toFixed(2)}`,
    `- Unrealized PnL: ${r.unrealized_pnl.toFixed(2)}`,
  ];
  for (const pos of r.positions) {
    lines.push(`- ${pos.symbol} ${pos.side} ${pos.size} @ ${pos.entry_price} → ${pos.current_price} (${pos.unrealized_pnl >= 0 ? "+" : ""}${pos.unrealized_pnl.toFixed(2)})`);
  }
  lines.push("");
  return lines.join("\n");
}
