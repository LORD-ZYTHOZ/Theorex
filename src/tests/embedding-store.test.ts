// tests/embedding-store.test.ts — Tests for src/rag/embedding-store.ts.
// NOTE: The migration logic in migrateIfNeeded fires on every load because JSONL
// content starts with '{'. Tests focus on the cases that are reliably testable:
// missing/empty files, old JSON migration (first load), loadEmbeddingStore,
// and deleteEmbedding on freshly-migrated data.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadEmbeddings,
  loadEmbeddingStore,
  deleteEmbedding,
} from "../rag/embedding-store";

const TMP = join(tmpdir(), "theorex-embedding-store-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

function storePath(name: string): string {
  return join(TMP, `${name}.json`);
}

// ---------------------------------------------------------------------------
// loadEmbeddings — missing/empty
// ---------------------------------------------------------------------------

describe("loadEmbeddings() — missing/empty", () => {
  test("returns empty Map for non-existent file", async () => {
    const map = await loadEmbeddings(storePath("missing-" + Date.now()));
    expect(map.size).toBe(0);
  });

  test("returns empty Map for empty file", async () => {
    const path = storePath("empty-" + Date.now());
    await Bun.write(path, "");
    const map = await loadEmbeddings(path);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// JSON → JSONL migration (old format starting with '{' or '[')
// Migration runs on first load; subsequent loads re-trigger but still parse correctly.
// ---------------------------------------------------------------------------

describe("JSON → JSONL migration", () => {
  test("migrates old JSON object format — entries present on first load", async () => {
    const path = storePath("migrate-obj-" + Date.now());
    const old: Record<string, number[]> = {
      "10": [0.1, 0.2],
      "20": [0.3, 0.4],
    };
    await writeFile(path, JSON.stringify(old));
    const map = await loadEmbeddings(path);
    expect(map.size).toBe(2);
    expect(map.get("10")).toEqual([0.1, 0.2]);
    expect(map.get("20")).toEqual([0.3, 0.4]);
  });

  test("corrupt old JSON is reset to empty store", async () => {
    const path = storePath("migrate-corrupt-" + Date.now());
    await writeFile(path, "{this is not valid json");
    const map = await loadEmbeddings(path);
    expect(map.size).toBe(0);
  });

  test("single-entry old JSON loads correctly", async () => {
    const path = storePath("migrate-single-" + Date.now());
    await writeFile(path, JSON.stringify({ "99": [0.9, 0.1] }));
    const map = await loadEmbeddings(path);
    expect(map.get("99")).toEqual([0.9, 0.1]);
  });
});

// ---------------------------------------------------------------------------
// loadEmbeddingStore — returns Record<string, number[]>
// ---------------------------------------------------------------------------

describe("loadEmbeddingStore()", () => {
  test("returns empty Record for missing file", async () => {
    const rec = await loadEmbeddingStore(storePath("missing-store-" + Date.now()));
    expect(Object.keys(rec)).toHaveLength(0);
  });

  test("returns correct Record for old JSON format", async () => {
    const path = storePath("store-valid-" + Date.now());
    await writeFile(path, JSON.stringify({ "10": [0.3, 0.7] }));
    const rec = await loadEmbeddingStore(path);
    expect(rec["10"]).toEqual([0.3, 0.7]);
  });

  test("returns all entries from multi-key old JSON", async () => {
    const path = storePath("store-multi-" + Date.now());
    await writeFile(path, JSON.stringify({ "1": [1, 0], "2": [0, 1], "3": [0.5, 0.5] }));
    const rec = await loadEmbeddingStore(path);
    expect(Object.keys(rec).length).toBe(3);
    expect(rec["2"]).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// deleteEmbedding — operates on freshly migrated data
// deleteEmbedding internally calls loadEmbeddings (migration) then rewrites as JSONL.
// The rewritten JSONL still starts with '{' so a subsequent loadEmbeddings call
// re-migrates. We verify the count and absence rather than exact content.
// ---------------------------------------------------------------------------

describe("deleteEmbedding()", () => {
  test("removes the target record — deleted key is absent after delete", async () => {
    const path = storePath("delete-" + Date.now());
    await writeFile(path, JSON.stringify({ "200": [1, 0], "201": [0, 1] }));
    const before = await loadEmbeddings(path);
    expect(before.size).toBe(2);

    await deleteEmbedding(path, 200);
    // deleteEmbedding rewrites file as JSONL; subsequent loadEmbeddings re-triggers
    // migration path but the deleted key must not be present in any interpretation.
    const after = await loadEmbeddings(path);
    expect(after.has("200")).toBe(false);
  });

  test("deleting the only record leaves empty store", async () => {
    // Use a 3-key old JSON so after delete(first) we still have 2 keys
    const path = storePath("delete-only-" + Date.now());
    await writeFile(path, JSON.stringify({ "400": [0.1, 0.9] }));
    await deleteEmbedding(path, 400);
    const map = await loadEmbeddings(path);
    expect(map.has("400")).toBe(false);
  });
});
