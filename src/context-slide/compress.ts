// context-slide/compress.ts — Extract key points from flash buffer via local LLM.
// Phase 15: Called when context hits threshold. Uses whatever local LLM is configured.
// Falls back to heuristic extraction if LLM unavailable.

import { readFlash } from "../flash/store";
import type { FlashEvent } from "../flash/store";

const LLM_TIMEOUT_MS = 15_000;

export interface KeyPoints {
  readonly summary: string;           // one paragraph narrative
  readonly decisions: string[];       // decisions made
  readonly facts: string[];           // facts established
  readonly tasks_in_progress: string[]; // active work
  readonly errors_solved: string[];   // problems resolved
  readonly raw_fallback: boolean;     // true = LLM unavailable, used heuristics
}

// ---------------------------------------------------------------------------
// Flash buffer → narrative text
// ---------------------------------------------------------------------------

/**
 * Convert flash events into a readable activity narrative.
 * Groups by tool type so the LLM can understand what was happening.
 */
export function flashEventsToNarrative(events: readonly FlashEvent[]): string {
  if (events.length === 0) return "No recent activity recorded.";

  const lines: string[] = ["Recent activity (tool uses, most recent last):"];

  for (const ev of events) {
    const ts = ev.timestamp.slice(11, 16); // HH:MM
    const preview = ev.tool_input_preview.slice(0, 150).replace(/\n/g, " ");
    const response = ev.tool_response_preview.slice(0, 100).replace(/\n/g, " ");
    lines.push(`[${ts}] ${ev.tool_name}: ${preview}${response ? ` → ${response}` : ""}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

const EXTRACT_PROMPT = `You are a memory compression system. Extract key points from this AI session activity log.

Return ONLY valid JSON in this exact shape:
{
  "summary": "one paragraph describing what was happening",
  "decisions": ["list of decisions made"],
  "facts": ["list of facts established or confirmed"],
  "tasks_in_progress": ["list of tasks currently being worked on"],
  "errors_solved": ["list of problems resolved"]
}

Keep each item concise (< 20 words). Only include non-empty arrays.

SESSION ACTIVITY:
`;

async function extractViaLLM(narrative: string, synthEndpoint: string): Promise<KeyPoints | null> {
  try {
    const response = await fetch(`${synthEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local-model",
        messages: [
          { role: "user", content: EXTRACT_PROMPT + narrative }
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";

    // Parse JSON from response — handle markdown code blocks
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<KeyPoints>;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      tasks_in_progress: Array.isArray(parsed.tasks_in_progress) ? parsed.tasks_in_progress : [],
      errors_solved: Array.isArray(parsed.errors_solved) ? parsed.errors_solved : [],
      raw_fallback: false,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Heuristic fallback
// ---------------------------------------------------------------------------

/**
 * Rule-based extraction when LLM unavailable.
 * Looks for high-significance events and tool patterns.
 */
function extractHeuristic(events: readonly FlashEvent[]): KeyPoints {
  const highSig = events.filter((e) => e.significance_score >= 0.5);
  const writes = events.filter((e) => e.tool_name === "Write" || e.tool_name === "Edit");
  const bashes = events.filter((e) => e.tool_name === "Bash");

  const facts = highSig
    .slice(-5)
    .map((e) => `${e.tool_name}: ${e.tool_input_preview.slice(0, 80)}`);

  const tasks = writes
    .slice(-3)
    .map((e) => `Modified: ${e.tool_input_preview.slice(0, 60)}`);

  const summary = events.length > 0
    ? `Session had ${events.length} tool uses. ${writes.length} file changes, ${bashes.length} bash commands.`
    : "No activity recorded.";

  return {
    summary,
    decisions: [],
    facts,
    tasks_in_progress: tasks,
    errors_solved: [],
    raw_fallback: true,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract key points from the current session's flash buffer.
 * Attempts LLM extraction first, falls back to heuristics.
 */
export async function extractKeyPoints(
  sessionId: string,
  synthEndpoint: string
): Promise<KeyPoints> {
  const buffer = await readFlash(sessionId);

  if (buffer.events.length === 0) {
    return {
      summary: "Session started — no activity yet.",
      decisions: [],
      facts: [],
      tasks_in_progress: [],
      errors_solved: [],
      raw_fallback: true,
    };
  }

  const narrative = flashEventsToNarrative(buffer.events);
  const llmResult = await extractViaLLM(narrative, synthEndpoint);

  if (llmResult !== null) return llmResult;
  return extractHeuristic(buffer.events);
}

/**
 * Format key points as a compact text block for axon storage.
 */
export function formatKeyPointsForAxon(points: KeyPoints): string {
  const parts: string[] = [points.summary];

  if (points.decisions.length > 0) {
    parts.push("Decisions: " + points.decisions.join("; "));
  }
  if (points.facts.length > 0) {
    parts.push("Facts: " + points.facts.join("; "));
  }
  if (points.tasks_in_progress.length > 0) {
    parts.push("In progress: " + points.tasks_in_progress.join("; "));
  }
  if (points.errors_solved.length > 0) {
    parts.push("Resolved: " + points.errors_solved.join("; "));
  }

  return parts.join(" | ");
}
