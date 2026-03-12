// src/rag/embedding-store.ts
// Persists concept embeddings to data/concept-embeddings.json.
// Kept separate from axon.json (384 floats/node = ~3KB — too large for the main graph file).
//
// Shape: Record<string, number[]>  // key = String(concept_id), value = 384-dim float[]
//
// ATOMIC WRITE: Bun.write to .tmp then rename — never corrupts the store.
// IMMUTABLE: loadEmbeddingStore returns a new object; saveEmbedding creates updated copy.

import { rename } from "node:fs/promises";

export async function loadEmbeddingStore(
  storePath: string
): Promise<Record<string, number[]>> {
  try {
    return await Bun.file(storePath).json() as Record<string, number[]>;
  } catch {
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
