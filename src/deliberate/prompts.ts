// deliberate/prompts.ts — Prompt templates for multi-perspective deliberation.

import type { SessionPacket, PerspectiveReport } from "./types";

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