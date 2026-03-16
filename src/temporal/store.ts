// temporal/store.ts — Persist last_interaction timestamp for gap detection.
// Reads/writes data/temporal.json (path from config).
// Never throws — cold start returns null last_interaction.

import { rename } from "node:fs/promises";

export interface TemporalRecord {
  readonly last_interaction: string; // ISO 8601
  readonly session_count: number;
}

/**
 * Load temporal record from disk.
 * Returns null if file does not exist (first ever session).
 */
export async function loadTemporalRecord(storePath: string): Promise<TemporalRecord | null> {
  try {
    const file = Bun.file(storePath);
    const exists = await file.exists();
    if (!exists) return null;
    return await file.json() as TemporalRecord;
  } catch {
    return null;
  }
}

/**
 * Save temporal record atomically.
 * Uses write-to-tmp + rename to prevent partial writes.
 */
export async function saveTemporalRecord(storePath: string, record: TemporalRecord): Promise<void> {
  const tmp = storePath + ".tmp";
  await Bun.write(tmp, JSON.stringify(record, null, 2));
  await rename(tmp, storePath);
}
