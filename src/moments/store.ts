// src/moments/store.ts — Permanent moment node store.
// Write-once JSON files in data/moments/{uuid}.json.
// Structurally immune to pruneAxon and scanAxon (lives outside axon graph).

import { mkdir, readdir, rename } from "node:fs/promises";
import { appendAuditEvent } from "../audit/logger";

export const MOMENTS_DIR = "data/moments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeRef {
  readonly file: string;
  readonly line: number;
}

export interface MomentNode {
  readonly id: string;           // crypto.randomUUID() — also the file stem
  readonly timestamp: string;    // ISO 8601 — new Date().toISOString() at creation
  readonly story: string;        // human-readable description
  readonly code_refs: readonly CodeRef[];
  readonly concept_ids: readonly number[];
}

// ---------------------------------------------------------------------------
// createMoment
// ---------------------------------------------------------------------------

/**
 * Atomically write a MomentNode to {dir}/{moment.id}.json.
 * Creates the directory if it does not exist (mkdir -p behaviour).
 * Uses Bun.write(tmp) + rename(tmp, final) for atomic write.
 */
export async function createMoment(
  moment: MomentNode,
  dir: string = MOMENTS_DIR
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${moment.id}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(moment, null, 2));
  await rename(tmpPath, filePath);
  void appendAuditEvent({
    type: "moment_capture",
    timestamp: moment.timestamp,
    source: "moment",
    moment_id: moment.id,
    story_preview: moment.story.slice(0, 60),
    concept_ids: moment.concept_ids,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// readMoments
// ---------------------------------------------------------------------------

/**
 * Read all valid MomentNode records from the given directory.
 * Returns [] when directory does not exist (ENOENT guard).
 * Skips .tmp files and files with invalid JSON content.
 */
export async function readMoments(
  dir: string = MOMENTS_DIR
): Promise<MomentNode[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const jsonFiles = files.filter(
    (f) => f.endsWith(".json") && !f.endsWith(".tmp.json") && !f.endsWith(".tmp")
  );

  const results: MomentNode[] = [];
  for (const file of jsonFiles) {
    const moment = await Bun.file(`${dir}/${file}`)
      .json()
      .catch(() => null);
    if (moment !== null) {
      results.push(moment as MomentNode);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// loadMoment
// ---------------------------------------------------------------------------

/**
 * Read a single MomentNode by id from {dir}/{id}.json.
 * Returns null when the file does not exist or cannot be parsed.
 */
export async function loadMoment(
  id: string,
  dir: string = MOMENTS_DIR
): Promise<MomentNode | null> {
  return Bun.file(`${dir}/${id}.json`)
    .json()
    .catch(() => null);
}
