/**
 * profile-extractor.ts — Stage 3D
 * Extracts structured traits from a session's concepts and writes them
 * to the `profiles` Postgres table via PostgresStore.
 *
 * Uses Ollama (gemma3:latest by default) to produce structured JSON.
 * Model override: PROFILE_EXTRACTOR_MODEL env var.
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

export interface ProfileExtractionInput {
  agentId: string;
  /** Recent concepts retrieved from this session (surface_form + meta) */
  recentConcepts: Array<{
    label: string;
    memory_type: string;
    meta: Record<string, unknown>;
  }>;
  /** Optional: recent outcomes */
  outcomes?: Array<{
    direction: string;
    pnl: number;
    meta: Record<string, unknown>;
  }>;
  /** Raw session note (optional free-text summary of what happened) */
  sessionNote?: string;
}

export interface ExtractedProfile {
  subject: string;
  traits: Record<string, unknown>;
}

// Internal shape expected from the LLM
interface LlmProfileItem {
  subject: string;
  traits: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract structured profiles from session concepts and persist them.
 * Returns the list of extracted profiles (empty on parse failure).
 */
export async function extractAndSaveProfiles(
  input: ProfileExtractionInput,
  store: PostgresStore,
): Promise<ExtractedProfile[]> {
  const prompt = buildPrompt(input);
  const raw = await callOllama(prompt);

  if (raw === null) {
    return [];
  }

  const profiles = parseProfiles(raw);

  await Promise.all(
    profiles.map((p) => store.upsertProfile(p.subject, p.traits)),
  );

  return profiles;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildPrompt(input: ProfileExtractionInput): string {
  const conceptSummary = input.recentConcepts
    .map((c) => `- ${c.label} (${c.memory_type})`)
    .join("\n");

  const outcomeSummary = input.outcomes && input.outcomes.length > 0
    ? input.outcomes
        .map((o) => `- ${o.direction} pnl=${o.pnl}`)
        .join("\n")
    : "none";

  const note = input.sessionNote ?? "none";

  return `You are an AI agent profiling assistant. Analyze the session data below and extract structured traits about the agent's behaviour, preferences, and style.

Return ONLY a JSON array of objects with shape {"subject": string, "traits": object}.
Subjects should be concise category names like "trading_style", "risk_preferences", "market_views", "decision_patterns".
Traits should be specific key-value observations.
If you cannot extract meaningful profiles, return an empty array [].

Session concepts:
${conceptSummary}

Recent outcomes:
${outcomeSummary}

Session note:
${note}

Respond with a JSON array only. No explanation.`;
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
        `[profile-extractor] Ollama returned ${res.status}\n`,
      );
      return null;
    }

    const data = (await res.json()) as { response: string };
    return data.response ?? null;
  } catch (err) {
    process.stderr.write(
      `[profile-extractor] Ollama fetch error: ${String(err)}\n`,
    );
    return null;
  }
}

function parseProfiles(raw: string): ExtractedProfile[] {
  try {
    const parsed = extractJsonArray(raw);
    if (!Array.isArray(parsed)) {
      process.stderr.write(
        `[profile-extractor] LLM response was not an array\n`,
      );
      return [];
    }
    return parsed
      .filter(isValidProfileItem)
      .map((item) => ({ subject: item.subject, traits: item.traits }));
  } catch (err) {
    process.stderr.write(
      `[profile-extractor] JSON parse error: ${String(err)}\n`,
    );
    return [];
  }
}

function extractJsonArray(raw: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to extracting array from freeform text
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("No JSON array found in response");
  }
}

function isValidProfileItem(item: unknown): item is LlmProfileItem {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as Record<string, unknown>).subject === "string" &&
    typeof (item as Record<string, unknown>).traits === "object" &&
    (item as Record<string, unknown>).traits !== null
  );
}
