import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// --- Constants ---

const FLASH_DIR = "data/flash";
const MAX_EVENTS = 50; // FLH-01
const TOKEN_CEILING = 4000; // FLH-03

// --- Types ---

export interface FlashEvent {
  readonly tool_name: string;
  readonly tool_input_preview: string; // JSON.stringify(tool_input).slice(0, 300)
  readonly tool_response_preview: string; // first 500 chars of response content
  readonly timestamp: string; // ISO 8601
  readonly significance_score: number; // 0.0–1.0
}

export interface FlashBuffer {
  readonly session_id: string;
  readonly events: readonly FlashEvent[];
}

// --- Pure utilities ---

/**
 * Estimate token count for a list of events.
 * Uses the rough heuristic: 1 token ≈ 4 characters.
 */
export function estimateTokens(events: readonly FlashEvent[]): number {
  return Math.ceil(JSON.stringify(events).length / 4);
}

/**
 * Apply ring buffer eviction rules to produce a new event array.
 *
 * Rules applied in order:
 * 1. Append incoming to existing events.
 * 2. Evict to MAX_EVENTS by removing lowest-significance entries first.
 *    Ties are broken by timestamp ascending (oldest evicted first). (FLH-01)
 * 3. Trim lowest-significance events until estimateTokens < TOKEN_CEILING OR
 *    only 1 event remains. (FLH-03)
 *
 * Never mutates the input arrays.
 */
export function enforceRingBuffer(
  events: readonly FlashEvent[],
  incoming: FlashEvent
): readonly FlashEvent[] {
  // Step 1: append incoming
  const appended: readonly FlashEvent[] = [...events, incoming];

  // Step 2: significance-biased eviction — evict lowest-significance first,
  // with timestamp as tiebreak (older evicted first).
  let afterRing: readonly FlashEvent[] = appended;
  if (appended.length > MAX_EVENTS) {
    const sorted = [...appended].sort((a, b) => {
      const scoreDiff = a.significance_score - b.significance_score;
      if (scoreDiff !== 0) return scoreDiff; // ascending: lowest first
      return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
    });
    const evictCount = appended.length - MAX_EVENTS;
    const evicted = new Set(sorted.slice(0, evictCount));
    // Preserve original insertion order for survivors
    afterRing = appended.filter((e) => !evicted.has(e));
  }

  // Step 3: token ceiling enforcement — evict lowest-significance until under ceiling or min 1
  let result: readonly FlashEvent[] = afterRing;
  while (result.length > 1 && estimateTokens(result) >= TOKEN_CEILING) {
    const sorted = [...result].sort((a, b) => {
      const scoreDiff = a.significance_score - b.significance_score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
    });
    const toRemove = sorted[0];
    result = result.filter((e) => e !== toRemove);
  }

  return result;
}

// --- I/O ---

/**
 * Read the flash buffer for a session from disk.
 * Returns an empty FlashBuffer if the file does not exist.
 * Never throws on missing file.
 */
export async function readFlash(
  sessionId: string,
  dir: string = FLASH_DIR
): Promise<FlashBuffer> {
  const filePath = path.join(dir, `${sessionId}.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as FlashBuffer;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { session_id: sessionId, events: [] };
    }
    throw err;
  }
}

/**
 * Write a FlashBuffer to disk atomically.
 * Uses write-to-tmpdir + rename pattern to prevent partial writes.
 * Creates the data/flash/ directory if it does not exist.
 * Never mutates the buffer.
 */
export async function writeFlash(
  buffer: FlashBuffer,
  dir: string = FLASH_DIR
): Promise<void> {
  const finalPath = path.join(dir, `${buffer.session_id}.json`);
  const tmpPath = path.join(tmpdir(), `theorex-flash-${buffer.session_id}-${Date.now()}.json`);

  // Ensure directory exists
  await mkdir(dir, { recursive: true });

  // Write to temp file
  const content = JSON.stringify(buffer, null, 2);
  await writeFile(tmpPath, content, "utf-8");

  // Atomic rename to final path
  await rename(tmpPath, finalPath);
}
