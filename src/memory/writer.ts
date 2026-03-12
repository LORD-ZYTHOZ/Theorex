import { rename } from "node:fs/promises";

/**
 * Atomically writes content to targetPath via temp+rename pattern.
 *
 * Steps:
 * 1. Write to targetPath + ".tmp" (same directory — never cross-filesystem)
 * 2. Rename .tmp to targetPath (atomic on same filesystem)
 *
 * This ensures MEMORY.md is never in a partially-written state.
 * Direct writes to targetPath are impossible through this API.
 */
export async function writeMemoryAtomic(targetPath: string, content: string): Promise<void> {
  const tmpPath = targetPath + ".tmp";
  await Bun.write(tmpPath, content);
  await rename(tmpPath, targetPath);
}

/**
 * Reads the raw string content of a file.
 *
 * Returns "" if the file does not exist (ENOENT — cold start).
 * Never throws on missing file.
 */
export async function readMemory(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return "";
    }
    throw err;
  }
}
