// src/short-term/store.ts — Short-term JSONL store.
// Provides JSONL append writer, 14-day rotation, and all-files reader.
// CRITICAL: uses appendFile from node:fs/promises — Bun.write REPLACES file content.

import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";

export const STM_DIR = "data/short-term";

export interface ShortTermEntry {
  readonly id: string;           // crypto.randomUUID()
  readonly concept_id: number;   // from ConceptEvent.concept_id
  readonly surface_form: string; // from ConceptEvent.surface_form
  readonly composite_score: number;
  readonly source_weight: number;
  readonly timestamp: string;    // ISO 8601
  readonly date: string;         // YYYY-MM-DD (derived from timestamp)
}

/**
 * Append a ShortTermEntry as a JSON line to data/short-term/YYYY-MM-DD.jsonl.
 * Creates the directory and file if they do not exist.
 * Never replaces existing content — always appends.
 */
export async function appendEntry(entry: ShortTermEntry, dir = STM_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${entry.date}.jsonl`;
  await appendFile(path, JSON.stringify(entry) + "\n");
}

/**
 * Delete JSONL files whose date prefix is strictly older than 14 days.
 * Files exactly 14 days old are kept (boundary is exclusive).
 * Returns the count of deleted files.
 */
export async function rotateStm(today: Date = new Date(), dir = STM_DIR): Promise<number> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 14);
  // Normalize cutoff to midnight UTC for clean date comparison
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let deleted = 0;
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const dateStr = file.replace(".jsonl", "");
    // String comparison works correctly for YYYY-MM-DD format
    if (dateStr < cutoffStr) {
      await unlink(`${dir}/${file}`);
      deleted++;
    }
  }
  return deleted;
}

/**
 * Read all ShortTermEntry records from the 14-day window.
 * Returns entries in ascending date order (files sorted lexicographically).
 * Returns empty array if the directory is absent or contains no JSONL files.
 */
export async function readShortTermFiles(dir = STM_DIR): Promise<ShortTermEntry[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const jsonlFiles = files.filter(f => f.endsWith(".jsonl")).sort();
  const results: ShortTermEntry[] = [];
  for (const file of jsonlFiles) {
    const text = await Bun.file(`${dir}/${file}`).text().catch(() => "");
    if (!text.trim()) continue;
    const entries = Bun.JSONL.parse(text) as ShortTermEntry[];
    results.push(...entries);
  }
  return results;
}
