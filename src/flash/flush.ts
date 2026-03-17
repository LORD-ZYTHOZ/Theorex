// flash/flush.ts — Flush flash buffer to short-term storage.
// FLH-04: filter events >= 0.5 significance; FLH-05: clear flash after flush.
// HKS-02: called by SessionEnd hook via flash-flush CLI subcommand.

import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { readFlash, writeFlash } from "./store";
import { appendEntry } from "../short-term/store";
import type { FlashBuffer } from "./store";
import type { ShortTermEntry } from "../short-term/store";

const FLASH_DIR = "data/flash";
const PRUNE_DEFAULT_DAYS = 7;

/** Regex matching date-stamped session flash files: session_YYYY-MM-DD.json */
const SESSION_DATE_FILE_RE = /^session_(\d{4}-\d{2}-\d{2})\.json$/;

const SIGNIFICANCE_THRESHOLD = 0.5; // FLH-04

export async function flushFlash(
  sessionId: string,
  options?: {
    appendEntry?: (entry: ShortTermEntry) => Promise<void>;
    readFlash?: (sessionId: string) => Promise<FlashBuffer>;
    writeFlash?: (buffer: FlashBuffer) => Promise<void>;
  }
): Promise<number> {
  const _readFlash = options?.readFlash ?? readFlash;
  const _writeFlash = options?.writeFlash ?? writeFlash;
  const _appendEntry = options?.appendEntry ?? appendEntry;

  const buffer = await _readFlash(sessionId);

  // FLH-04: filter events by significance threshold
  // Guard against corrupt buffer (missing/non-array events field)
  const events = Array.isArray(buffer.events) ? buffer.events : [];
  const significant = events.filter(
    (e) => e.significance_score >= SIGNIFICANCE_THRESHOLD
  );

  // Write significant events to short-term storage
  for (const event of significant) {
    const entry: ShortTermEntry = {
      id: crypto.randomUUID(),
      concept_id: 0, // flash events are tool-use records, no concept_id
      surface_form: event.tool_name,
      composite_score: event.significance_score,
      source_weight: 1.0,
      timestamp: event.timestamp,
      date: event.timestamp.slice(0, 10),
    };
    await _appendEntry(entry);
  }

  // FLH-05: clear flash buffer after flush
  await _writeFlash({ session_id: sessionId, events: [] });

  return significant.length;
}

/**
 * Delete date-stamped flash files (session_YYYY-MM-DD.json) older than `daysOld` days.
 * Only touches files matching the session date pattern; never deletes arbitrary files.
 * Returns the list of deleted file paths.
 */
export async function pruneStaleFlashFiles(
  daysOld: number = PRUNE_DEFAULT_DAYS,
  dir: string = FLASH_DIR
): Promise<readonly string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  const cutoffDate = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const deleted: string[] = [];
  for (const entry of entries) {
    const match = SESSION_DATE_FILE_RE.exec(entry);
    if (!match) continue;
    const fileDate = match[1]; // "YYYY-MM-DD"
    if (fileDate < cutoffDate) {
      const filePath = path.join(dir, entry);
      await unlink(filePath);
      deleted.push(filePath);
    }
  }

  return deleted;
}
