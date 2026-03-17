// flash/record.ts — Parse PostToolUse stdin and record to flash buffer.
// HKS-01: called by flash-write CLI subcommand (invoked with async: true from hook).

import { readFlash, writeFlash, enforceRingBuffer } from "./store.ts";
import type { FlashEvent } from "./store.ts";
import { processText } from "../compose.ts";

const MAX_CONTENT_CHARS = 2000; // don't score huge responses

/** Parse raw PostToolUse hook input and compute a FlashEvent. */
export function buildFlashEvent(hookInput: Record<string, unknown>): FlashEvent {
  const toolName = String(hookInput.tool_name ?? "unknown");
  const toolInput = hookInput.tool_input ?? {};
  const toolResponse = hookInput.tool_response ?? {};

  // Build a text summary for significance scoring
  const inputStr = JSON.stringify(toolInput).slice(0, MAX_CONTENT_CHARS);
  const responseStr = String(
    (toolResponse as Record<string, unknown>).stdout ??
    (toolResponse as Record<string, unknown>).content ??
    JSON.stringify(toolResponse)
  ).slice(0, 500);

  // Score using significance engine (pure function — no I/O)
  const textToScore = `${toolName} ${inputStr}`.slice(0, MAX_CONTENT_CHARS);
  let significance_score = 0;
  try {
    const events = processText(textToScore, 1.0, "concept", new Date().toISOString());
    if (events.length > 0) {
      significance_score = Math.min(1.0, Math.max(...events.map((e) => e.composite_score)));
    }
  } catch {
    significance_score = 0;
  }

  return {
    tool_name: toolName,
    tool_input_preview: inputStr.slice(0, 300),
    tool_response_preview: responseStr,
    timestamp: new Date().toISOString(),
    significance_score,
  };
}

/** Read flash buffer, add event, enforce ring buffer + token ceiling, write back atomically. */
export async function recordFlashEvent(
  sessionId: string,
  hookInput: Record<string, unknown>
): Promise<void> {
  const incoming = buildFlashEvent(hookInput);
  const buffer = await readFlash(sessionId);
  const updated = enforceRingBuffer(buffer.events, incoming);
  await writeFlash({ session_id: sessionId, events: updated });
}
