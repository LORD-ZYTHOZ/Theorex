import { rename } from "node:fs/promises";

export interface TheorexMeta {
  version: 1;
  last_scan: string | null;   // ISO 8601 or null if never scanned
  node_metadata: Record<string, {
    relevance_tier: "ACTIVE" | "MILD" | "LESS";
    sentiment_tier: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
    last_classified: string;  // ISO 8601
  }>;
}

const DEFAULT_META: TheorexMeta = {
  version: 1,
  last_scan: null,
  node_metadata: {},
};

/**
 * Reads .theorex-meta.json from the given path.
 *
 * Returns the default TheorexMeta if the file does not exist.
 * Never throws on missing file.
 *
 * Note: .theorex-meta.json is NEVER embedded in MEMORY.md — it is a separate file.
 */
export async function readMeta(path: string): Promise<TheorexMeta> {
  try {
    const text = await Bun.file(path).text();
    return JSON.parse(text) as TheorexMeta;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return { ...DEFAULT_META, node_metadata: {} };
    }
    throw err;
  }
}

/**
 * Atomically writes TheorexMeta to the given path via temp+rename pattern.
 *
 * Same atomic write approach as writeMemoryAtomic — writes to path+".tmp"
 * then renames, ensuring the meta file is never partially written.
 */
export async function writeMeta(path: string, meta: TheorexMeta): Promise<void> {
  const tmpPath = path + ".tmp";
  await Bun.write(tmpPath, JSON.stringify(meta, null, 2));
  await rename(tmpPath, path);
}
