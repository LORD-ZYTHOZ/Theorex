// vision/video.ts — Frame extraction from video using ffmpeg (Phase 11).
//
// Uses Bun.$ to shell out to ffmpeg/ffprobe.
// Returns a temp directory of PNG frames — caller MUST clean up via cleanupFrames().
//
// INVARIANTS:
//   - Returns null if ffmpeg is unavailable or the file cannot be read
//   - Temp dir is always created before returning; clean up on both success and error
//   - Duration is derived from ffprobe; falls back to frame_count * intervalSec

import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedFrame {
  readonly path: string;       // absolute path to extracted PNG frame
  readonly offsetSec: number;  // approximate position in video (seconds)
}

export interface VideoInfo {
  readonly durationSec: number;
  readonly frames: readonly ExtractedFrame[];
  readonly tempDir: string;    // caller must call cleanupFrames(tempDir) when done
}

// ---------------------------------------------------------------------------
// getVideoDuration — optional probe, falls back to 0
// ---------------------------------------------------------------------------

async function getVideoDuration(
  videoPath: string,
  ffmpegPath: string,
): Promise<number> {
  const ffprobePath = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  const result = await Bun.$`${ffprobePath} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${videoPath}`
    .quiet()
    .nothrow();
  const dur = parseFloat(result.stdout.toString().trim());
  return isNaN(dur) ? 0 : dur;
}

// ---------------------------------------------------------------------------
// extractFrames
// ---------------------------------------------------------------------------

/**
 * Extract frames from a video file at a fixed interval.
 * Uses ffmpeg via Bun.$. Creates a temp dir of PNG frames.
 *
 * @param videoPath     - absolute or relative path to input video
 * @param intervalSec   - extract one frame every N seconds (default: 5)
 * @param ffmpegPath    - path to ffmpeg binary (default: "ffmpeg")
 * @returns VideoInfo with frames + tempDir, or null on failure
 */
export async function extractFrames(
  videoPath: string,
  intervalSec: number = 5,
  ffmpegPath: string = "ffmpeg",
): Promise<VideoInfo | null> {
  const tempDir = join(tmpdir(), `theorex-video-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  // fps filter: 1 frame every intervalSec seconds
  const fps = `1/${Math.max(1, Math.round(intervalSec))}`;
  const outputPattern = join(tempDir, "frame_%04d.png");

  const result = await Bun.$`${ffmpegPath} -i ${videoPath} -vf fps=${fps} -q:v 2 ${outputPattern} -y`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    await cleanupFrames(tempDir);
    return null;
  }

  const files = await readdir(tempDir).catch(() => [] as string[]);
  const pngFiles = files.filter((f) => f.endsWith(".png")).sort();

  if (pngFiles.length === 0) {
    await cleanupFrames(tempDir);
    return null;
  }

  const frames: ExtractedFrame[] = pngFiles.map((f, i) => ({
    path: join(tempDir, f),
    offsetSec: i * intervalSec,
  }));

  // Try to get real duration from ffprobe; fall back to frame count estimate
  const probedDuration = await getVideoDuration(videoPath, ffmpegPath);
  const durationSec = probedDuration > 0
    ? probedDuration
    : pngFiles.length * intervalSec;

  return { durationSec, frames, tempDir };
}

// ---------------------------------------------------------------------------
// cleanupFrames
// ---------------------------------------------------------------------------

/**
 * Remove the temp directory created by extractFrames.
 * Always call this after processing frames to avoid disk leaks.
 */
export async function cleanupFrames(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
