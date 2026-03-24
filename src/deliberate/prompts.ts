// deliberate/prompts.ts — Prompt templates for multi-perspective deliberation.
// Each builder produces a system+context prompt for a specific analysis engine.

import type { SessionPacket, PerspectiveReport } from "./types";

// ---------------------------------------------------------------------------
// Perspective prompts
// ---------------------------------------------------------------------------

export function buildSingularityPrompt(packet: SessionPacket): string {
  return [
    "You are analyzing this trading session from the perspective of Singularity — a micro/technicals engine focused on price structure, sweep + OB patterns, SL/TP execution.",
    "",
    `Session: ${packet.session}`,
    `Date: ${packet.date}`,
    "",
    "## Session Data",
    "",
    "```json",
    JSON.stringify(packet, null, 2),
    "```",
    "",
    "## Focus Questions",
    "",
    "- What did price do during this session? Key levels, sweeps, structure shifts.",
    "- What setups triggered or were missed? Order block reactions, sweep quality.",
    "- How tight were SL distances? Were TP targets hit or did price reverse early?",
    "- What was the overall technicals read for this window?",
    "",
    "## Response Format",
    "",
    "Respond with a single JSON object matching the PerspectiveReport schema (source: \"singularity\").",
    "Include fields: source, total_trades, winning_trades, losing_trades, total_pnl, win_rate, avg_hold_time_ms, largest_win, largest_loss, session_trades.",
  ].join("\n");
}

export function buildDivergentPrompt(packet: SessionPacket): string {
  return [
    "You are analyzing this trading session from the perspective of Divergent — a macro/sentiment engine that synthesizes VIX, SPX correlation, 5 LLM persona votes, and regime classification.",
    "",
    `Session: ${packet.session}`,
    `Date: ${packet.date}`,
    "",
    "## Session Data",
    "",
    "```json",
    JSON.stringify(packet, null, 2),
    "```",
    "",
    "## Focus Questions",
    "",
    "- What was the macro regime during this session? Risk-on, risk-off, or transitional?",
    "- How did the LLM personas vote? Was sentiment aligned with price action?",
    "- Were there divergences between model agreement and actual market movement?",
    "- What signals fired and what was their quality?",
    "",
    "## Response Format",
    "",
    "Respond with a single JSON object matching the PerspectiveReport schema (source: \"divergent\").",
    "Include fields: source, signal_count, agreement_rate, signals.",
  ].join("\n");
}

export function buildHorizonPrompt(packet: SessionPacket): string {
  return [
    "You are analyzing this trading session from the perspective of Horizon — the predictions engine that forecasts price levels, timing, and directional bias.",
    "",
    `Session: ${packet.session}`,
    `Date: ${packet.date}`,
    "",
    "## Session Data",
    "",
    "```json",
    JSON.stringify(packet, null, 2),
    "```",
    "",
    "## Focus Questions",
    "",
    "- What did we predict for this session? Price targets, direction, timing.",
    "- How accurate were the predictions? Which hit, which missed?",
    "- What did we fail to predict that was significant?",
    "- How should prediction models be calibrated going forward?",
    "",
    "## Response Format",
    "",
    "Respond with a single JSON object matching the PerspectiveReport schema (source: \"horizon\").",
    "Include fields: source, active_positions, total_exposure, unrealized_pnl, positions.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Orchestrator prompt
// ---------------------------------------------------------------------------

interface Perspectives {
  readonly singularity: PerspectiveReport | null;
  readonly divergent: PerspectiveReport | null;
  readonly horizon: PerspectiveReport | null;
}

function formatPerspective(name: string, report: PerspectiveReport | null): string {
  if (report === null) {
    return `### ${name}\n\nPerspective not available for this session.`;
  }
  return `### ${name}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``;
}

export function buildOrchestratorPrompt(
  packet: SessionPacket,
  perspectives: Perspectives,
): string {
  return [
    "You are the Deliberation Orchestrator. You have received analysis from up to three engine perspectives for a single trading session. Your job is to synthesize them into a unified assessment.",
    "",
    `Session: ${packet.session}`,
    `Date: ${packet.date}`,
    "",
    "## Perspective Reports",
    "",
    formatPerspective("Singularity (technicals)", perspectives.singularity),
    "",
    formatPerspective("Divergent (macro/sentiment)", perspectives.divergent),
    "",
    formatPerspective("Horizon (predictions)", perspectives.horizon),
    "",
    "## Instructions",
    "",
    "Cross-reference the available perspectives. Identify where engines agree, where they conflict, and what none of them caught.",
    "",
    "## Response Format",
    "",
    "Respond with a single JSON object containing:",
    "",
    "```json",
    "{",
    '  "alignments": ["string — where 2+ engines agreed"],',
    '  "conflicts": ["string — where engines disagreed"],',
    '  "blind_spots": ["string — what no engine caught"],',
    '  "missed_opportunities": ["string — trades/signals that should have been acted on"],',
    '  "takeaways": [',
    "    {",
    '      "insight": "string — the key learning",',
    '      "test_condition": "string | null — how to verify this insight next session",',
    '      "engines_involved": ["singularity", "divergent", "horizon"],',
    '      "confidence": 0.0',
    "    }",
    "  ]",
    "}",
    "```",
  ].join("\n");
}
