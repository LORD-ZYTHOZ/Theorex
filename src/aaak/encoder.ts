/**
 * encoder.ts — AAAK compression module
 * Converts verbose text into AAAK shorthand using Gemma3 via Ollama.
 *
 * AAAK is a lossless shorthand dialect for AI agents:
 *   ENTITY(role,attr) | KEY: val | DECISION: A>B(reason) | ★★★★ (1-4 stars)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AaakResult {
  compressed: string;
  ratio: number; // original_tokens / compressed_tokens estimate
}

export interface AaakEncoderOptions {
  ollamaUrl?: string;  // default: http://localhost:11434
  model?: string;      // default: gemma3:latest
  timeoutMs?: number;  // default: 15000
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_MODEL = "gemma3:latest";
const DEFAULT_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT =
  "You compress AI agent memory into AAAK shorthand. " +
  "AAAK grammar: ENTITY(role,attr) | KEY: val | DECISION: A>B(reason) | " +
  "★★★★ (1-4 stars = importance). " +
  "Compress to <15% of original tokens. Output ONLY the AAAK string, nothing else.";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress text into AAAK shorthand via Ollama.
 * Falls back to `{ compressed: text, ratio: 1 }` if Ollama is unreachable
 * or returns an unusable response — never throws.
 */
export async function compressToAaak(
  text: string,
  opts?: AaakEncoderOptions,
): Promise<AaakResult> {
  const url = opts?.ollamaUrl ?? DEFAULT_OLLAMA_URL;
  const model = opts?.model ?? DEFAULT_MODEL;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const compressed = await callOllama(text, url, model, timeoutMs);

  if (!compressed) {
    return { compressed: text, ratio: 1 };
  }

  return { compressed, ratio: estimateRatio(text, compressed) };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function callOllama(
  text: string,
  ollamaUrl: string,
  model: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        system: SYSTEM_PROMPT,
        prompt: text,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      process.stderr.write(`[aaak-encoder] Ollama returned ${res.status}\n`);
      return null;
    }

    const data = (await res.json()) as { response?: string };
    const response = data.response?.trim();

    if (!response) {
      process.stderr.write("[aaak-encoder] Ollama returned empty response\n");
      return null;
    }

    return response;
  } catch (err) {
    process.stderr.write(`[aaak-encoder] Ollama fetch error: ${String(err)}\n`);
    return null;
  }
}

function estimateRatio(original: string, compressed: string): number {
  const originalTokens = original.split(" ").length;
  const compressedTokens = compressed.split(" ").length;
  return Math.round(originalTokens / compressedTokens);
}
