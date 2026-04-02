/**
 * procedure-extractor.ts — Stage 6A
 * Extracts step-by-step procedures from session concepts and writes them
 * to the `concepts` table (memory_type = 'procedure') via PostgresStore.
 *
 * Uses Ollama (gemma3:latest by default) to produce structured JSON.
 * Model override: PROCEDURE_EXTRACTOR_MODEL env var.
 */

import type { PostgresStore } from "../axon/postgres-store";
import type { FlashEvent } from "../flash/store";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.PROCEDURE_EXTRACTOR_MODEL || "gemma3:latest";
const TIMEOUT_MS = 30_000;
const MAX_CONCEPTS = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcedureExtractionInput {
  agentId: string;
  /** Recent concepts from this session */
  recentConcepts: Array<{
    label: string;
    memory_type: string;
    meta: Record<string, unknown>;
  }>;
  /** Raw session note (optional free-text summary of what happened) */
  sessionNote?: string;
}

export interface ExtractedProcedure {
  name: string;
  steps: string[];
  conditions?: string;
  tools?: string[];
}

// Internal shape expected from the LLM
interface LlmProcedureItem {
  name: string;
  steps: string[];
  conditions?: string;
  tools?: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract procedural knowledge from session concepts and persist them.
 * Returns the list of extracted procedures (empty on parse failure).
 */
export async function extractAndSaveProcedures(
  input: ProcedureExtractionInput,
  store: PostgresStore,
): Promise<ExtractedProcedure[]> {
  const prompt = buildPrompt(input);
  const raw = await callOllama(prompt);

  if (raw === null) {
    return [];
  }

  const procedures = parseProcedures(raw);

  await Promise.allSettled(
    procedures.map((p) => store.saveProcedure(p.name, p.steps, p.conditions, p.tools)),
  );

  return procedures;
}

/**
 * Heuristic: should we auto-extract procedures from this session's flash events?
 * Triggers when the session looks like a multi-step task:
 *   - >= 3 distinct significant tool types (diverse workflow), OR
 *   - >= 5 significant events (high-activity session), OR
 *   - any event contains procedural keywords ("how to", "process", "pipeline", "checklist")
 */
export function shouldAutoExtract(events: readonly FlashEvent[]): boolean {
  const SIGNIFICANCE_THRESHOLD = 0.5;
  const MIN_DISTINCT_TOOLS = 3;
  const MIN_HIGH_ACTIVITY = 5;
  const KEYWORD_RE = /\b(how to|process|pipeline|checklist|workflow|step by step)\b/i;

  const distinctTools = new Set<string>();
  let significantCount = 0;

  for (const e of events) {
    if (e.significance_score < SIGNIFICANCE_THRESHOLD) continue;
    significantCount++;
    distinctTools.add(e.tool_name);

    if (KEYWORD_RE.test(e.tool_input_preview)) return true;
    if (significantCount >= MIN_HIGH_ACTIVITY) return true;
    if (distinctTools.size >= MIN_DISTINCT_TOOLS) return true;
  }

  return false;
}

/**
 * Refine an existing procedure based on outcome feedback.
 * Retrieves the current procedure, asks LLM to improve it given the feedback,
 * and saves the refined version. Returns null if procedure not found or LLM fails.
 */
export async function refineProcedure(
  name: string,
  feedback: string,
  store: PostgresStore,
): Promise<ExtractedProcedure | null> {
  const existing = await store.getProcedure(name);
  if (!existing) return null;

  const prompt = buildRefinePrompt(existing, feedback);
  const raw = await callOllama(prompt);
  if (raw === null) return null;

  const refined = parseRefinedProcedure(raw);
  if (!refined) return null;

  await store.saveProcedure(refined.name, refined.steps, refined.conditions, refined.tools);
  return refined;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildPrompt(input: ProcedureExtractionInput): string {
  const conceptSummary = input.recentConcepts
    .slice(0, MAX_CONCEPTS)
    .map((c) => `- ${c.label} (${c.memory_type})`)
    .join("\n");

  const note = input.sessionNote ?? "none";

  return `You are an AI procedure extraction assistant. Analyze the session data below and extract reusable step-by-step procedures that were performed, discussed, or refined.

Return ONLY a JSON array of objects with shape:
{"name": string, "steps": ["step 1", "step 2", ...], "conditions": string (optional), "tools": ["tool1"] (optional)}

Each procedure should be:
- Named concisely (e.g. "London Breakout Entry", "Risk Sizing Checklist")
- Steps should be ordered, actionable instructions
- Conditions describe when/where the procedure applies
- Tools list any indicators, charts, or instruments needed
If you cannot extract meaningful procedures, return an empty array [].

Session concepts:
${conceptSummary}

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
        `[procedure-extractor] Ollama returned ${res.status}\n`,
      );
      return null;
    }

    const data = (await res.json()) as { response: string };
    return data.response ?? null;
  } catch (err) {
    process.stderr.write(
      `[procedure-extractor] Ollama fetch error: ${String(err)}\n`,
    );
    return null;
  }
}

function parseProcedures(raw: string): ExtractedProcedure[] {
  try {
    const parsed = extractJsonArray(raw);
    if (!Array.isArray(parsed)) {
      process.stderr.write(
        `[procedure-extractor] LLM response was not an array\n`,
      );
      return [];
    }
    return parsed
      .filter(isValidProcedureItem)
      .map((item) => {
        const result: ExtractedProcedure = {
          name: item.name,
          steps: item.steps.filter((s): s is string => typeof s === "string"),
        };
        if (typeof item.conditions === "string") {
          result.conditions = item.conditions;
        }
        if (Array.isArray(item.tools)) {
          result.tools = item.tools.filter((t): t is string => typeof t === "string");
        }
        return result;
      });
  } catch (err) {
    process.stderr.write(
      `[procedure-extractor] JSON parse error: ${String(err)}\n`,
    );
    return [];
  }
}

function buildRefinePrompt(
  existing: { name: string; steps: string[]; conditions?: string; tools?: string[] },
  feedback: string,
): string {
  const stepsList = existing.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const conditions = existing.conditions ?? "none";
  const tools = existing.tools?.join(", ") ?? "none";

  return `You are an AI procedure refinement assistant. Given an existing procedure and outcome feedback, produce an improved version.

Current procedure:
Name: ${existing.name}
Steps:
${stepsList}
Conditions: ${conditions}
Tools: ${tools}

Outcome feedback:
${feedback}

Return ONLY a JSON object with shape:
{"name": string, "steps": ["step 1", ...], "conditions": string (optional), "tools": ["tool1"] (optional)}

Keep the procedure name the same unless the feedback explicitly renames it.
Add, remove, or reorder steps based on the feedback.
Respond with a JSON object only. No explanation.`;
}

function parseRefinedProcedure(raw: string): ExtractedProcedure | null {
  try {
    const parsed = extractJsonObject(raw);
    if (!isValidProcedureItem(parsed)) return null;
    const result: ExtractedProcedure = {
      name: parsed.name,
      steps: parsed.steps.filter((s): s is string => typeof s === "string"),
    };
    if (typeof parsed.conditions === "string") {
      result.conditions = parsed.conditions;
    }
    if (Array.isArray(parsed.tools)) {
      result.tools = parsed.tools.filter((t): t is string => typeof t === "string");
    }
    return result;
  } catch (err) {
    process.stderr.write(
      `[procedure-extractor] refine parse error: ${String(err)}\n`,
    );
    return null;
  }
}

function extractJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("No JSON object found in response");
  }
}

function extractJsonArray(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("No JSON array found in response");
  }
}

function isValidProcedureItem(item: unknown): item is LlmProcedureItem {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as Record<string, unknown>).name === "string" &&
    Array.isArray((item as Record<string, unknown>).steps)
  );
}
