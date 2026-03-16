// vision/store.ts — ImageMemory + VideoMemory node stores (Phase 10 + 11).
// Write-once JSON files in data/images/{uuid}.json and data/videos/{uuid}.json.
// Mirrors moments/store.ts pattern — structurally immune to pruneAxon and scanAxon.

import { mkdir, readdir, rename } from "node:fs/promises";

export const IMAGES_DIR = "data/images";
export const VIDEOS_DIR = "data/videos";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageMemory {
  readonly id: string;                    // crypto.randomUUID() — also the file stem
  readonly timestamp: string;             // ISO 8601
  readonly source_path: string;           // original image path (not stored — reference only)
  readonly description: string;           // AI-generated natural language overview
  readonly elements: readonly string[];   // key visual elements identified
  readonly context: string;               // inferred or user-provided context
  readonly reconstruction_prompt: string; // compact prompt to reason about this image later
  readonly concept_ids: readonly number[]; // axon concept IDs linked at ingest time
}

// ---------------------------------------------------------------------------
// createImageMemory
// ---------------------------------------------------------------------------

/**
 * Atomically write an ImageMemory to {dir}/{memory.id}.json.
 * Creates the directory if it does not exist (mkdir -p behaviour).
 */
export async function createImageMemory(
  memory: ImageMemory,
  dir: string = IMAGES_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${memory.id}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(memory, null, 2));
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// readImageMemories
// ---------------------------------------------------------------------------

/**
 * Read all valid ImageMemory records from the given directory.
 * Returns [] when directory does not exist (ENOENT guard).
 * Skips .tmp files and files with invalid JSON.
 */
export async function readImageMemories(
  dir: string = IMAGES_DIR,
): Promise<ImageMemory[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const jsonFiles = files.filter(
    (f) => f.endsWith(".json") && !f.endsWith(".tmp.json") && !f.endsWith(".tmp"),
  );

  const results: ImageMemory[] = [];
  for (const file of jsonFiles) {
    const memory = await Bun.file(`${dir}/${file}`)
      .json()
      .catch(() => null);
    if (memory !== null) {
      results.push(memory as ImageMemory);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// loadImageMemory
// ---------------------------------------------------------------------------

/**
 * Read a single ImageMemory by id from {dir}/{id}.json.
 * Returns null when the file does not exist or cannot be parsed.
 */
export async function loadImageMemory(
  id: string,
  dir: string = IMAGES_DIR,
): Promise<ImageMemory | null> {
  return Bun.file(`${dir}/${id}.json`)
    .json()
    .catch(() => null);
}

// ---------------------------------------------------------------------------
// VideoMemory (Phase 11)
// ---------------------------------------------------------------------------

/**
 * A VideoMemory groups the anchor ImageMemory nodes extracted from a single video.
 * The raw video is not stored — only the story (anchor moments + summary).
 */
export interface VideoMemory {
  readonly id: string;                     // crypto.randomUUID() — file stem
  readonly timestamp: string;              // ISO 8601
  readonly source_path: string;            // original video path (reference only)
  readonly duration_seconds: number;       // total video duration
  readonly anchor_count: number;           // number of anchor frames ingested
  readonly anchor_ids: readonly string[];  // ImageMemory IDs for each anchor frame
  readonly summary: string;               // AI-synthesised narrative of the full video
}

/**
 * Atomically write a VideoMemory to {dir}/{memory.id}.json.
 */
export async function createVideoMemory(
  memory: VideoMemory,
  dir: string = VIDEOS_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${memory.id}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(memory, null, 2));
  await rename(tmpPath, filePath);
}

/**
 * Read all valid VideoMemory records from the given directory.
 * Returns [] when directory does not exist.
 */
export async function readVideoMemories(
  dir: string = VIDEOS_DIR,
): Promise<VideoMemory[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const jsonFiles = files.filter(
    (f) => f.endsWith(".json") && !f.endsWith(".tmp.json") && !f.endsWith(".tmp"),
  );
  const results: VideoMemory[] = [];
  for (const file of jsonFiles) {
    const memory = await Bun.file(`${dir}/${file}`)
      .json()
      .catch(() => null);
    if (memory !== null) {
      results.push(memory as VideoMemory);
    }
  }
  return results;
}

/**
 * Read a single VideoMemory by id from {dir}/{id}.json.
 * Returns null when the file does not exist or cannot be parsed.
 */
export async function loadVideoMemory(
  id: string,
  dir: string = VIDEOS_DIR,
): Promise<VideoMemory | null> {
  return Bun.file(`${dir}/${id}.json`)
    .json()
    .catch(() => null);
}
