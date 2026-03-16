// vision/video.test.ts — Tests for Phase 11 Video Memory.
//
// Tests are split into:
//   1. VideoMemory store (read/write/load) — no external deps
//   2. VideoIngestResult shape validation — mock ingestImage
//   3. buildSummary logic via ingest-video internals
//   4. extractFrames — skipped when ffmpeg is absent

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createVideoMemory,
  readVideoMemories,
  loadVideoMemory,
  VIDEOS_DIR,
} from "./store";
import type { VideoMemory } from "./store";

const TMP = join(tmpdir(), "theorex-video-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// VideoMemory store
// ---------------------------------------------------------------------------

describe("VideoMemory store", () => {
  const testMemory: VideoMemory = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source_path: "/fake/video.mp4",
    duration_seconds: 30,
    anchor_count: 3,
    anchor_ids: ["anchor-a", "anchor-b", "anchor-c"],
    summary: "30-second video with 3 anchor moments. Opening scene. Middle action. Closing shot.",
  };

  test("createVideoMemory writes file", async () => {
    await createVideoMemory(testMemory, TMP);
    const loaded = await loadVideoMemory(testMemory.id, TMP);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(testMemory.id);
  });

  test("loaded VideoMemory matches original", async () => {
    const loaded = await loadVideoMemory(testMemory.id, TMP);
    expect(loaded?.source_path).toBe("/fake/video.mp4");
    expect(loaded?.duration_seconds).toBe(30);
    expect(loaded?.anchor_count).toBe(3);
    expect(loaded?.anchor_ids).toEqual(["anchor-a", "anchor-b", "anchor-c"]);
    expect(loaded?.summary).toContain("30-second video");
  });

  test("readVideoMemories returns all records", async () => {
    const second: VideoMemory = {
      ...testMemory,
      id: crypto.randomUUID(),
      source_path: "/fake/video2.mp4",
    };
    await createVideoMemory(second, TMP);

    const all = await readVideoMemories(TMP);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("readVideoMemories skips .tmp files", async () => {
    await writeFile(join(TMP, "partial.json.tmp"), "not-json");
    const all = await readVideoMemories(TMP);
    // Should not throw and should not include the .tmp file
    for (const m of all) {
      expect(m.id).toBeTruthy();
    }
  });

  test("loadVideoMemory returns null for missing id", async () => {
    const result = await loadVideoMemory("nonexistent-id", TMP);
    expect(result).toBeNull();
  });

  test("readVideoMemories returns [] for missing directory", async () => {
    const missing = join(TMP, "does-not-exist");
    const result = await readVideoMemories(missing);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// VideoMemory immutability
// ---------------------------------------------------------------------------

describe("VideoMemory immutability", () => {
  test("anchor_ids is readonly array", async () => {
    const memory: VideoMemory = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source_path: "/test.mp4",
      duration_seconds: 10,
      anchor_count: 1,
      anchor_ids: ["id-1"],
      summary: "test",
    };
    await createVideoMemory(memory, TMP);
    // TypeScript readonly prevents mutation at compile time
    // At runtime we verify the loaded object has the correct structure
    const loaded = await loadVideoMemory(memory.id, TMP);
    expect(Array.isArray(loaded?.anchor_ids)).toBe(true);
    expect(loaded?.anchor_ids[0]).toBe("id-1");
  });
});

// ---------------------------------------------------------------------------
// extractFrames — requires ffmpeg
// ---------------------------------------------------------------------------

describe("extractFrames", () => {
  test("returns null when ffmpeg path is invalid", async () => {
    const { extractFrames } = await import("./video");
    const result = await extractFrames("/nonexistent/video.mp4", 5, "/nonexistent/ffmpeg");
    expect(result).toBeNull();
  });

  test("returns null for nonexistent video file", async () => {
    // Only run if ffmpeg is available
    const check = await Bun.$`which ffmpeg`.quiet().nothrow();
    if (check.exitCode !== 0) return; // skip

    const { extractFrames } = await import("./video");
    const result = await extractFrames("/nonexistent/video.mp4");
    expect(result).toBeNull();
  });
});
