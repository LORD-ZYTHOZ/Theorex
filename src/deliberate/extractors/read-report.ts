// deliberate/extractors/read-report.ts — Shared JSON report reader.
// All extractors use the same pattern: check existence, read, parse, return null on error.

/**
 * Read and parse a typed JSON report file.
 * Returns null if the file does not exist or cannot be parsed as T.
 */
export async function readJsonReport<T>(path: string): Promise<T | null> {
  try {
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) return null;

    const text = await file.text();
    const parsed = JSON.parse(text) as T;
    return parsed;
  } catch {
    return null;
  }
}