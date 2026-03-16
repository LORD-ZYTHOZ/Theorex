// context-slide/slide.ts — Orchestrate context compression and window slide.
// Phase 15: Called by PostToolUse hook. Checks threshold, compresses, saves, outputs additionalContext.
// Completely silent when not triggered. Never blocks tool execution.

import {
  readContextMetrics,
  readSlideState,
  writeSlideState,
  shouldCompress,
} from "./monitor";
import { extractKeyPoints, formatKeyPointsForAxon } from "./compress";
import { synthesizeToAgent } from "../family/synthesize";
import type { Config } from "../config";

export interface SlideResult {
  readonly triggered: boolean;
  readonly additionalContext: string | null;
  readonly compressionCount: number;
}

/**
 * Run the context slide check for a session.
 * - Reads context metrics
 * - Checks if threshold crossed and cooldown elapsed
 * - If triggered: extracts key points, saves to axon, returns additionalContext
 * - If not triggered: increments call counter, returns { triggered: false }
 */
export async function runContextSlide(
  sessionId: string,
  config: Config
): Promise<SlideResult> {
  // Read current context metrics
  const metrics = await readContextMetrics(sessionId);
  const state = await readSlideState(sessionId);

  // Increment call counter regardless
  const updatedState = {
    ...state,
    calls_since_compress: state.calls_since_compress + 1,
  };

  // No metrics available — just update counter and exit
  if (metrics === null) {
    await writeSlideState(sessionId, updatedState).catch(() => {});
    return { triggered: false, additionalContext: null, compressionCount: state.compression_count };
  }

  // Check if we should compress
  if (!shouldCompress(metrics, state, config.contextSlideThreshold, config.contextSlideCooldownCalls)) {
    await writeSlideState(sessionId, updatedState).catch(() => {});
    return { triggered: false, additionalContext: null, compressionCount: state.compression_count };
  }

  // --- COMPRESSION TRIGGERED ---

  let keyPointsText = "";
  let usedLLM = false;

  try {
    const keyPoints = await extractKeyPoints(sessionId, config.synthEndpoint);
    keyPointsText = formatKeyPointsForAxon(keyPoints);
    usedLLM = !keyPoints.raw_fallback;

    // Write key points to the agent's axon (permanent memory)
    await synthesizeToAgent(
      config.temporalAgentId,
      `[Context slide at ${metrics.used_pct}% usage] ${keyPointsText}`,
      config
    );
  } catch {
    // Synthesis failure — still update state, just report without key points
    keyPointsText = "(extraction unavailable)";
  }

  // Update slide state — reset counter, record compression
  const newCompressionCount = state.compression_count + 1;
  await writeSlideState(sessionId, {
    calls_since_compress: 0,
    last_compress_at: new Date().toISOString(),
    compression_count: newCompressionCount,
  }).catch(() => {});

  // Build additionalContext message for the AI
  const method = usedLLM ? "LLM" : "heuristic";
  const message =
    `THEOREX CONTEXT SLIDE #${newCompressionCount}: Context at ${metrics.used_pct}% — ` +
    `key points extracted (${method}) and saved to memory. ` +
    `Session continues. Saved: ${keyPointsText.slice(0, 200)}`;

  return {
    triggered: true,
    additionalContext: message,
    compressionCount: newCompressionCount,
  };
}
