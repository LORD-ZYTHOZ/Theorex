/**
 * session-summarizer.ts — Stage 3D
 * Summarizes a session and saves the result to the `session_summaries`
 * Postgres table via PostgresStore.
 *
 * Uses Ollama (gemma3:latest by default) to produce structured JSON.
 * Model override: PROFILE_EXTRACTOR_MODEL env var (shared config).
 */

import type { PostgresStore } from "../axon/postgres-store";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.PROFILE_EXTRACTOR_MODEL || "gemma3:latest";
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSummaryInput {
  /** ISO timestamp or UUID */
  sessionId: string;
  agentId: string;
  /** Concepts accessed/created this session */
  concepts: Array<{ label: string; memory_type: string }>;
  /** Key events that happened */
  events?: string[];
  /** Optional free-text notes */
  notes?: string;
}

export interface SessionSummaryResult {
  summary: string;
  keyDecisions: string[];
}

// Internal shape expected from the LLM
interface LlmSummaryResponse {
  summary: string;
  key_decisions: string[];
}

const FALLBACK_RESULT: SessionSummaryResult = {
  summary: "",
  keyDecisions: [],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Summarize a session using an LLM and persist the summary.
 * Returns a fallback empty result on parse failure (never throws).
 */
export async function summarizeAndSaveSession(
  input: SessionSummaryInput,
  store: PostgresStore,
): Promise<SessionSummaryResult> {
  const prompt = buildPrompt(input);
  const raw = await callOllama(prompt);

  if (raw === null) {
    return FALLBACK_RESULT;
  }

  const result = parseSummary(raw);
  await store.saveSessionSummary(input.sessionId, result.summary, result.keyDecisions);
  return result;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildPrompt(input: SessionSummaryInput): string {
  const conceptList = input.concepts
    .map((c) => `- ${c.label} (${c.memory_type})`)
    .join("\n");

  const eventList =
    input.events && input.events.length > 0
      ? input.events.map((e) => `- ${e}`).join("\n")
      : "none";

  const notes = input.notes ?? "none";

  return `You are an AI session summarizer. Summarize the session below concisely.

Return ONLY a JSON object with shape:
{"summary": "<one paragraph summary>", "key_decisions": ["decision 1", "decision 2", ...]}

Session ID: ${input.sessionId}

Concepts accessed:
${conceptList}

Key events:
${eventList}

Notes:
${notes}

Respond with a JSON object only. No explanation.`;
}

async function callOllama(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      process.stderr.write(
        `[session-summarizer] Ollama returned ${res.status}\n`,
      );
      return null;
    }

    const data = (await res.json()) as { response: string };
    return data.response ?? null;
  } catch (err) {
    process.stderr.write(
      `[session-summarizer] Ollama fetch error: ${String(err)}\n`,
    );
    return null;
  }
}

function parseSummary(raw: string): SessionSummaryResult {
  try {
    const parsed = extractJsonObject(raw) as LlmSummaryResponse;

    const summary = typeof parsed?.summary === "string" ? parsed.summary : "";
    const keyDecisions = Array.isArray(parsed?.key_decisions)
      ? parsed.key_decisions.filter((d): d is string => typeof d === "string")
      : [];

    return { summary, keyDecisions };
  } catch (err) {
    process.stderr.write(
      `[session-summarizer] JSON parse error: ${String(err)}\n`,
    );
    return FALLBACK_RESULT;
  }
}

function extractJsonObject(raw: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to extracting object from freeform text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("No JSON object found in response");
  }
}
