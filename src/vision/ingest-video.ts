// vision/ingest-video.ts — Full video ingestion pipeline (Phase 11).
//
// Pipeline:
//   video file
//     → ffmpeg extracts frames at fixed interval (video.ts)
//     → each frame → ingestImage() → ImageMemory (reuses Phase 10 pipeline)
//     → anchor ImageMemory IDs collected
//     → summary synthesised from frame descriptions
//     → VideoMemory written to data/videos/{uuid}.json
//     → temp frames cleaned up
//
// INVARIANTS:
//   - Returns null if ffmpeg unavailable or video cannot be read (non-fatal)
//   - Returns null if no frames were successfully ingested (vision model down)
//   - Temp frames are always cleaned up (success and failure)
//   - observation_type: "image" on all concepts (reuses ingestImage tagging)

import type { Config } from "../config";
import { ingestImage } from "./ingest";
import { extractFrames, cleanupFrames } from "./video";
import { createVideoMemory } from "./store";
import type { VideoMemory } from "./store";

export interface VideoIngestResult {
  readonly memory: VideoMemory;
  readonly framesProcessed: number;
  readonly conceptsAdded: number;
  readonly edgesAdded: number;
}

/**
 * Ingest a video into Theorex:
 * 1. Extract frames at fixed interval via ffmpeg
 * 2. Describe each frame via vision model (ingestImage)
 * 3. Synthesise a summary from all anchor descriptions
 * 4. Write VideoMemory grouping all anchor ImageMemory IDs
 *
 * Returns null if ffmpeg is unavailable, the video is unreadable,
 * or the vision model is unavailable for all frames.
 */
export async function ingestVideo(
  videoPath: string,
  config: Config,
  options?: {
    axonPath?: string;
    imagesDir?: string;
    videosDir?: string;
    userContext?: string;
    agentId?: string;
    nowMs?: number;
  },
): Promise<VideoIngestResult | null> {
  const intervalSec = config.videoFrameIntervalSec ?? 5;
  const ffmpegPath = config.ffmpegPath ?? "ffmpeg";
  const videosDir = options?.videosDir ?? config.videosDir ?? "data/videos";
  const agentId = options?.agentId ?? "main";
  const nowMs = options?.nowMs ?? Date.now();
  const timestamp = new Date(nowMs).toISOString();

  // 1. Extract frames
  const videoInfo = await extractFrames(videoPath, intervalSec, ffmpegPath);
  if (!videoInfo) return null;

  // 2. Ingest each frame — collect successful results
  const anchorIds: string[] = [];
  const descriptions: string[] = [];
  let totalConceptsAdded = 0;
  let totalEdgesAdded = 0;

  try {
    for (const frame of videoInfo.frames) {
      const result = await ingestImage(frame.path, config, {
        axonPath: options?.axonPath,
        imagesDir: options?.imagesDir,
        userContext: options?.userContext
          ? `${options.userContext} (video frame at ${frame.offsetSec}s)`
          : `video frame at ${frame.offsetSec}s`,
        agentId,
        nowMs: nowMs + frame.offsetSec * 1000, // stagger timestamps along timeline
      });

      if (result) {
        anchorIds.push(result.memory.id);
        descriptions.push(result.memory.description);
        totalConceptsAdded += result.conceptsAdded;
        totalEdgesAdded += result.edgesAdded;
      }
    }
  } finally {
    // Always clean up temp frames regardless of vision model availability
    await cleanupFrames(videoInfo.tempDir);
  }

  if (anchorIds.length === 0) return null;

  // 3. Synthesise summary from anchor descriptions
  const summary = buildSummary(descriptions, videoInfo.durationSec);

  // 4. Write VideoMemory
  const memory: VideoMemory = {
    id: crypto.randomUUID(),
    timestamp,
    source_path: videoPath,
    duration_seconds: videoInfo.durationSec,
    anchor_count: anchorIds.length,
    anchor_ids: anchorIds,
    summary,
  };

  await createVideoMemory(memory, videosDir);

  return {
    memory,
    framesProcessed: anchorIds.length,
    conceptsAdded: totalConceptsAdded,
    edgesAdded: totalEdgesAdded,
  };
}

// ---------------------------------------------------------------------------
// buildSummary — lightweight local synthesis (no LLM required)
// ---------------------------------------------------------------------------

/**
 * Build a compact narrative summary from anchor frame descriptions.
 * Used when no LLM is available for synthesis — concatenates key sentences.
 * Format: "{N}-second video. {first desc}. [...] {last desc}."
 */
function buildSummary(descriptions: readonly string[], durationSec: number): string {
  if (descriptions.length === 0) return "No anchor frames extracted.";

  const durStr = durationSec > 0
    ? `${Math.round(durationSec)}-second video`
    : "Video";

  if (descriptions.length === 1) {
    return `${durStr}. ${descriptions[0]}`;
  }

  // Take first + last + up to 3 middle descriptions to bound summary length
  const mid = descriptions.slice(1, -1);
  const sampled = mid.length <= 3
    ? mid
    : [mid[0], mid[Math.floor(mid.length / 2)], mid[mid.length - 1]].filter(Boolean);

  const parts = [descriptions[0], ...sampled, descriptions[descriptions.length - 1]];
  return `${durStr} with ${descriptions.length} anchor moments. ${parts.join(" ")}`;
}
