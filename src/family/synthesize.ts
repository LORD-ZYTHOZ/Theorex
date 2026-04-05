// family/synthesize.ts — LLM-assisted semantic extraction for Theorex.
// Phase 6: AI Family Shared Layer — Semantic Memory
//
// Instead of relying on NLP to guess which nouns matter, the local LLM
// extracts structured lessons from raw agent text:
//   {lesson, domain, outcome, confidence}
//
// Each lesson is a complete, meaningful sentence — far richer than nouns.
// These get written to the axon via writeToAgent, so the concept web stores
// "anchor blindness causes overconfidence at key levels" not just "anchor".
//
// LLM endpoint: configurable via config.lmStudioUrl (default: http://localhost:11434)
// Gemma4-31B via Ollama is the default local worker.

import { writeToAgent, batchWriteToAgent } from "./write";
import type { Config } from "../config";

export interface Lesson {
  readonly lesson: string;       // full sentence — the memory to store
  readonly domain: string;       // e.g. "trading", "system", "relationship"
  readonly outcome: string;      // "positive" | "negative" | "neutral"
  readonly confidence: number;   // 0.0–1.0
}

export interface SynthesizeResult {
  readonly agentId: string;
  readonly lessonsExtracted: number;
  readonly conceptsAdded: number;
  readonly edgesAdded: number;
  readonly fallbackUsed: boolean; // true if LLM call failed and NLP fallback ran
}

const SYSTEM_PROMPT = `You are a memory extraction system for AI agents.
Extract key lessons and insights from the given text.
Return ONLY a valid JSON array. No explanation, no markdown, no extra text.

Each item must have:
- "lesson": a complete sentence capturing the insight (max 20 words)
- "domain": one word category (trading, system, risk, psychology, memory, communication, etc.)
- "outcome": "positive", "negative", or "neutral"
- "confidence": 0.0 to 1.0 based on how clearly the text states this

Extract 2-6 lessons. If text has no clear lessons, return [].

Example output:
[
  {"lesson": "anchor blindness causes overconfidence at key support levels", "domain": "trading", "outcome": "negative", "confidence": 0.9},
  {"lesson": "Scout signal approval rate reliably predicts NY session outcome", "domain": "trading", "outcome": "positive", "confidence": 0.8}
]`;

/**
 * Call the local LLM to extract structured lessons from text.
 * Returns null if the LLM is unavailable or returns invalid JSON.
 */
async function extractLessons(
  text: string,
  lmStudioUrl: string,
  timeoutMs: number,
): Promise<readonly Lesson[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${lmStudioUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gemma4:31b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text.slice(0, 3000) }, // cap input to avoid token blowout
        ],
        max_tokens: 512,
        temperature: 0.3,
      }),
    });

    clearTimeout(timer);

    if (!res.ok) return null;

    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as unknown[];

    if (!Array.isArray(parsed)) return null;

    return parsed.filter((item): item is Lesson => {
      if (typeof item !== "object" || item === null) return false;
      const l = item as Record<string, unknown>;
      return (
        typeof l.lesson === "string" && l.lesson.length > 0 &&
        typeof l.domain === "string" &&
        ["positive", "negative", "neutral"].includes(l.outcome as string) &&
        typeof l.confidence === "number" && (l.confidence as number) >= 0 && (l.confidence as number) <= 1
      );
    });
  } catch {
    return null;
  }
}

/**
 * Synthesize lessons from text and write them to an agent's private axon.
 *
 * Flow:
 *   1. Call local LLM → extract structured lessons
 *   2. Write each lesson sentence through processText → axon
 *   3. If LLM unavailable → fall back to writing raw text through processText
 */
export async function synthesizeToAgent(
  agentId: string,
  text: string,
  config: Config,
  nowMs: number = Date.now(),
): Promise<SynthesizeResult> {
  const lmUrl = config.lmStudioUrl;
  const lessons = await extractLessons(text, lmUrl, config.lmStudioTimeoutMs);

  if (lessons === null || lessons.length === 0) {
    // Fallback: write raw text through standard NLP pipeline
    const fallback = await writeToAgent(agentId, text, config, nowMs);
    return {
      agentId,
      lessonsExtracted: 0,
      conceptsAdded: fallback.conceptsAdded,
      edgesAdded: fallback.edgesAdded,
      fallbackUsed: true,
    };
  }

  // Batch all lesson sentences into a single axon load+save (PERF-003)
  const lessonTexts = lessons.map((l) => l.lesson);
  const result = await batchWriteToAgent(agentId, lessonTexts, config, nowMs);

  return {
    agentId,
    lessonsExtracted: lessons.length,
    conceptsAdded: result.conceptsAdded,
    edgesAdded: result.edgesAdded,
    fallbackUsed: false,
  };
}
