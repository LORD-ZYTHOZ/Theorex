// src/rag/embedding-store.ts
// Persists concept embeddings to data/concept-embeddings.jsonl.
// Kept separate from axon.json (768 floats/node = ~6KB — too large for the main graph file).
//
// Shape: JSONL file, one record per line: { id: string, embedding: number[] }
//
// APPEND-ONLY: addEmbedding (née saveEmbedding) appends a single line — O(1), no full rewrite.
// MIGRATION: if an existing file starts with '{' or '[' it is the old JSON format — rewrite as JSONL once.
// IMMUTABLE: loadEmbeddings returns a new Map; callers must not mutate it.
// DELETE: deleteEmbedding rewrites the whole file (rare operation — only called on node prune).

import { appendFile, rename as fsRename } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse the JSONL file into a Map.
 * Silently skips blank lines and unparseable lines (corruption resilience).
 */
async function parseJsonl(storePath: string): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  try {
    const text = await Bun.file(storePath).text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as { id: string; embedding: number[] };
        if (record.id && Array.isArray(record.embedding)) {
          map.set(record.id, record.embedding);
        }
      } catch {
        // skip malformed line
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ENOENT")) {
      console.warn(`[embedding-store] Failed to read ${storePath}: ${msg}`);
    }
  }
  return map;
}

/**
 * One-time migration: if file starts with '{' or '[', it is old JSON format.
 * Read it, rewrite as JSONL, return the parsed map.
 * Returns null if migration is not needed.
 */
async function migrateIfNeeded(storePath: string): Promise<Map<string, number[]> | null> {
  let firstByte: string;
  try {
    const slice = await Bun.file(storePath).slice(0, 1).text();
    firstByte = slice.trim();
  } catch {
    return null; // ENOENT or unreadable — not old format
  }

  if (firstByte !== "{" && firstByte !== "[") return null;

  // Old format detected — migrate
  let old: Record<string, number[]> = {};
  try {
    old = await Bun.file(storePath).json() as Record<string, number[]>;
  } catch {
    // Corrupt old JSON — start fresh
    console.warn(`[embedding-store] Old JSON at ${storePath} is corrupt, starting fresh JSONL store.`);
    await Bun.write(storePath, "");
    return new Map();
  }

  const map = new Map<string, number[]>(Object.entries(old));
  const lines = [...map.entries()].map(([id, embedding]) => JSON.stringify({ id, embedding })).join("\n");
  const tmp = storePath + ".tmp";
  await Bun.write(tmp, lines + (lines.length > 0 ? "\n" : ""));
  await fsRename(tmp, storePath);
  console.info(`[embedding-store] Migrated ${map.size} embeddings from JSON → JSONL at ${storePath}`);
  return map;
}

// ---------------------------------------------------------------------------
// Public API (same signatures as before, plus loadEmbeddings)
// ---------------------------------------------------------------------------

/**
 * Load all embeddings into a Map<string, number[]>.
 * key = String(concept_id), value = embedding vector.
 */
export async function loadEmbeddingStore(
  storePath: string
): Promise<Record<string, number[]>> {
  const migrated = await migrateIfNeeded(storePath);
  const map = migrated ?? await parseJsonl(storePath);
  return Object.fromEntries(map);
}

/**
 * Load all embeddings into a Map for efficient lookup.
 * Prefer this over loadEmbeddingStore when you only need reads.
 */
export async function loadEmbeddings(
  storePath: string
): Promise<Map<string, number[]>> {
  const migrated = await migrateIfNeeded(storePath);
  return migrated ?? parseJsonl(storePath);
}

/**
 * Append a single embedding record to the JSONL store — O(1), no full rewrite.
 * If the same conceptId already exists in the file, the newest line wins at read time
 * (parseJsonl processes lines in order, later entries overwrite earlier ones in the Map).
 */
export async function saveEmbedding(
  storePath: string,
  conceptId: number,
  vector: number[]
): Promise<void> {
  // Migrate old format first if present
  await migrateIfNeeded(storePath);
  const line = JSON.stringify({ id: String(conceptId), embedding: vector }) + "\n";
  await appendFile(storePath, line);
}

/**
 * Remove an embedding by conceptId. Rewrites the whole file (rare — called only on prune).
 */
export async function deleteEmbedding(
  storePath: string,
  conceptId: number
): Promise<void> {
  const map = await loadEmbeddings(storePath);
  map.delete(String(conceptId));
  const lines = [...map.entries()].map(([id, embedding]) => JSON.stringify({ id, embedding })).join("\n");
  const tmp = storePath + ".tmp";
  await Bun.write(tmp, lines + (lines.length > 0 ? "\n" : ""));
  await fsRename(tmp, storePath);
}
