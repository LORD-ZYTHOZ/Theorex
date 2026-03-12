import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeMemoryAtomic, readMemory } from "../../src/memory/writer";
import { readMeta, writeMeta } from "../../src/memory/meta";
import type { TheorexMeta } from "../../src/memory/meta";

const TEST_DIR = "/tmp/theorex-writer-tests";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("writeMemoryAtomic", () => {
  test("creates target file with correct content", async () => {
    const targetPath = join(TEST_DIR, "MEMORY.md");
    const content = "# Memory\n\n## System\nhello\n";
    await writeMemoryAtomic(targetPath, content);
    expect(existsSync(targetPath)).toBe(true);
    const result = await readMemory(targetPath);
    expect(result).toBe(content);
  });

  test("no residual .tmp file after write", async () => {
    const targetPath = join(TEST_DIR, "MEMORY.md");
    const tmpPath = targetPath + ".tmp";
    await writeMemoryAtomic(targetPath, "content");
    // After successful atomic write, .tmp should be gone (renamed to target)
    expect(existsSync(tmpPath)).toBe(false);
    expect(existsSync(targetPath)).toBe(true);
  });
});

describe("readMemory", () => {
  test("returns empty string for non-existent path (no throw)", async () => {
    const result = await readMemory(join(TEST_DIR, "nonexistent.md"));
    expect(result).toBe("");
  });
});

describe("readMeta / writeMeta", () => {
  test("readMeta returns default for non-existent path", async () => {
    const metaPath = join(TEST_DIR, ".theorex-meta.json");
    const meta = await readMeta(metaPath);
    expect(meta.version).toBe(1);
    expect(meta.last_scan).toBeNull();
    expect(meta.node_metadata).toEqual({});
  });

  test("writeMeta + readMeta round-trip preserves all fields", async () => {
    const metaPath = join(TEST_DIR, ".theorex-meta.json");
    const data: TheorexMeta = {
      version: 1,
      last_scan: "2026-03-10T00:00:00Z",
      node_metadata: {
        "concept-abc": {
          relevance_tier: "ACTIVE",
          sentiment_tier: "PREFERRED",
          last_classified: "2026-03-10T00:00:00Z",
        },
      },
    };
    await writeMeta(metaPath, data);
    const result = await readMeta(metaPath);
    expect(result).toEqual(data);
  });
});
