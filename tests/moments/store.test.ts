// tests/moments/store.test.ts — Unit tests for MomentNode store.
// Tests cover createMoment round-trip, readMoments, loadMoment, and ENOENT guard.

import { describe, test, expect, afterEach } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  createMoment,
  readMoments,
  loadMoment,
  MOMENTS_DIR,
  type MomentNode,
  type CodeRef,
} from "../../src/moments/store";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const testDirs: string[] = [];

function tmpDir(): string {
  const dir = `/tmp/theorex-moments-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDirs.push(dir);
  return dir;
}

function makeMoment(overrides: Partial<MomentNode> = {}): MomentNode {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    story: "User added a test for the moment store module",
    code_refs: [{ file: "src/moments/store.ts", line: 42 }],
    concept_ids: [1, 2, 3],
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of testDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  testDirs.length = 0;
});

// ---------------------------------------------------------------------------
// MomentNode shape
// ---------------------------------------------------------------------------

describe("MomentNode shape", () => {
  test("all required fields are present in the interface", () => {
    const moment: MomentNode = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      story: "Test moment story",
      code_refs: [],
      concept_ids: [],
    };
    expect(moment.id).toBeTypeOf("string");
    expect(moment.timestamp).toBeTypeOf("string");
    expect(moment.story).toBeTypeOf("string");
    expect(Array.isArray(moment.code_refs)).toBe(true);
    expect(Array.isArray(moment.concept_ids)).toBe(true);
  });

  test("CodeRef has file (string) and line (number)", () => {
    const ref: CodeRef = { file: "src/test.ts", line: 10 };
    expect(ref.file).toBeTypeOf("string");
    expect(ref.line).toBeTypeOf("number");
  });

  test("code_refs contains CodeRef objects", () => {
    const moment = makeMoment({
      code_refs: [{ file: "src/moments/store.ts", line: 1 }],
    });
    expect(moment.code_refs[0].file).toBe("src/moments/store.ts");
    expect(moment.code_refs[0].line).toBe(1);
  });

  test("concept_ids contains numbers", () => {
    const moment = makeMoment({ concept_ids: [100, 200, 300] });
    expect(moment.concept_ids).toEqual([100, 200, 300]);
  });
});

// ---------------------------------------------------------------------------
// MOMENTS_DIR constant
// ---------------------------------------------------------------------------

describe("MOMENTS_DIR", () => {
  test("exports MOMENTS_DIR string constant", () => {
    expect(MOMENTS_DIR).toBeTypeOf("string");
    expect(MOMENTS_DIR.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// createMoment
// ---------------------------------------------------------------------------

describe("createMoment", () => {
  test("writes {dir}/{moment.id}.json and round-trips all fields", async () => {
    const dir = tmpDir();
    const moment = makeMoment();
    await createMoment(moment, dir);

    const filePath = join(dir, `${moment.id}.json`);
    expect(existsSync(filePath)).toBe(true);

    const content = await Bun.file(filePath).json();
    expect(content.id).toBe(moment.id);
    expect(content.timestamp).toBe(moment.timestamp);
    expect(content.story).toBe(moment.story);
    expect(content.code_refs).toEqual(moment.code_refs);
    expect(content.concept_ids).toEqual(moment.concept_ids);
  });

  test("creates directory if it does not exist (mkdir -p behaviour)", async () => {
    const dir = tmpDir();
    const nested = join(dir, "sub", "deep");
    const moment = makeMoment();
    await createMoment(moment, nested);

    const filePath = join(nested, `${moment.id}.json`);
    expect(existsSync(filePath)).toBe(true);
    testDirs.push(nested);
  });

  test("atomic write — .tmp file is gone after completion", async () => {
    const dir = tmpDir();
    const moment = makeMoment();
    await createMoment(moment, dir);

    const files = await readdir(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  test("writes valid JSON that can be parsed back", async () => {
    const dir = tmpDir();
    const moment = makeMoment({
      story: 'Story with "quotes" and newlines\nhere',
      code_refs: [
        { file: "src/a.ts", line: 1 },
        { file: "src/b.ts", line: 99 },
      ],
      concept_ids: [10, 20, 30],
    });
    await createMoment(moment, dir);

    const filePath = join(dir, `${moment.id}.json`);
    const raw = await Bun.file(filePath).text();
    const parsed = JSON.parse(raw);
    expect(parsed.story).toBe(moment.story);
    expect(parsed.code_refs).toHaveLength(2);
  });

  test("multiple moments get separate files", async () => {
    const dir = tmpDir();
    const m1 = makeMoment();
    const m2 = makeMoment();
    await createMoment(m1, dir);
    await createMoment(m2, dir);

    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// readMoments
// ---------------------------------------------------------------------------

describe("readMoments", () => {
  test("returns [] when directory does not exist (ENOENT guard)", async () => {
    const dir = `/tmp/theorex-moments-nonexistent-${Date.now()}`;
    const result = await readMoments(dir);
    expect(result).toEqual([]);
  });

  test("returns all valid moments from the directory", async () => {
    const dir = tmpDir();
    const m1 = makeMoment();
    const m2 = makeMoment();
    await createMoment(m1, dir);
    await createMoment(m2, dir);

    const result = await readMoments(dir);
    expect(result).toHaveLength(2);

    const ids = result.map((m) => m.id).sort();
    expect(ids).toEqual([m1.id, m2.id].sort());
  });

  test("skips .tmp files", async () => {
    const dir = tmpDir();
    const m1 = makeMoment();
    await createMoment(m1, dir);

    // Manually create a .tmp file
    const tmpPath = join(dir, "leftover.json.tmp");
    await Bun.write(tmpPath, JSON.stringify({ broken: true }));

    const result = await readMoments(dir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(m1.id);
  });

  test("skips non-JSON files", async () => {
    const dir = tmpDir();
    const m1 = makeMoment();
    await createMoment(m1, dir);

    // Add a non-JSON file
    await Bun.write(join(dir, "README.txt"), "not a moment");

    const result = await readMoments(dir);
    expect(result).toHaveLength(1);
  });

  test("skips files with invalid JSON content gracefully", async () => {
    const dir = tmpDir();
    const m1 = makeMoment();
    await createMoment(m1, dir);

    // Write an invalid JSON file
    await Bun.write(join(dir, "corrupt.json"), "{ invalid json !!!");

    const result = await readMoments(dir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(m1.id);
  });

  test("returns [] for empty directory", async () => {
    const dir = tmpDir();
    await Bun.write(join(dir, ".keep"), "");
    const result = await readMoments(dir);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadMoment
// ---------------------------------------------------------------------------

describe("loadMoment", () => {
  test("reads a single moment by id", async () => {
    const dir = tmpDir();
    const moment = makeMoment();
    await createMoment(moment, dir);

    const result = await loadMoment(moment.id, dir);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(moment.id);
    expect(result!.story).toBe(moment.story);
    expect(result!.code_refs).toEqual(moment.code_refs);
    expect(result!.concept_ids).toEqual(moment.concept_ids);
  });

  test("returns null when file missing", async () => {
    const dir = tmpDir();
    const result = await loadMoment("nonexistent-id", dir);
    expect(result).toBeNull();
  });

  test("returns null when directory does not exist", async () => {
    const dir = `/tmp/theorex-moments-nonexistent-${Date.now()}`;
    const result = await loadMoment("some-id", dir);
    expect(result).toBeNull();
  });

  test("returns correct moment when multiple exist", async () => {
    const dir = tmpDir();
    const m1 = makeMoment({ story: "first moment" });
    const m2 = makeMoment({ story: "second moment" });
    await createMoment(m1, dir);
    await createMoment(m2, dir);

    const result = await loadMoment(m2.id, dir);
    expect(result).not.toBeNull();
    expect(result!.story).toBe("second moment");
  });
});
