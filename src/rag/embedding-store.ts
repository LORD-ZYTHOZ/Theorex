// src/rag/embedding-store.ts
// Persists concept embeddings to data/concept-embeddings.json.
// Kept separate from axon.json (768 floats/node = ~6KB — too large for the main graph file).
//
// Shape: Record<string, number[]>  // key = String(concept_id), value = 768-dim float[]
//
// ATOMIC WRITE: Bun.write to .tmp then rename — never corrupts the store.
// IMMUTABLE: loadEmbeddingStore returns a new object; saveEmbedding creates updated copy.

import { rename } from "node:fs/promises";

export async function loadEmbeddingStore(
  storePath: string
): Promise<Record<string, number[]>> {
  try {
    return await Bun.file(storePath).json() as Record<string, number[]>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ENOENT")) {
      // Non-ENOENT means corruption — warn so data loss is visible
      console.warn(`[embedding-store] Failed to load ${storePath}: ${msg}. Starting from empty store.`);
    }
    return {}; // ENOENT or invalid JSON — cold start
  }
}

export async function saveEmbedding(
  storePath: string,
  conceptId: number,
  vector: number[]
): Promise<void> {
  const store = await loadEmbeddingStore(storePath);
  const updated = { ...store, [String(conceptId)]: vector };
  const tmp = storePath + ".tmp";
  await Bun.write(tmp, JSON.stringify(updated));
  await rename(tmp, storePath);
}

export async function deleteEmbedding(
  storePath: string,
  conceptId: number
): Promise<void> {
  const store = await loadEmbeddingStore(storePath);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [String(conceptId)]: _removed, ...updated } = store;
  const tmp = storePath + ".tmp";
  await Bun.write(tmp, JSON.stringify(updated));
  await rename(tmp, storePath);
}
