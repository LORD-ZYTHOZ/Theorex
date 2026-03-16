// Phase 10: Visual Memory store tests

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createImageMemory,
  readImageMemories,
  loadImageMemory,
} from "../../src/vision/store";
import type { ImageMemory } from "../../src/vision/store";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "theorex-v10-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeMemory(overrides?: Partial<ImageMemory>): ImageMemory {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source_path: "/tmp/test.png",
    description: "A trading dashboard showing XAUUSD candlesticks",
    elements: ["candlestick chart", "volume bars", "signal arrow"],
    context: "User reviewing NY session setup",
    reconstruction_prompt: "Trading chart with candlesticks and a signal at 14:32",
    concept_ids: [100, 200, 300],
    ...overrides,
  };
}

test("createImageMemory: writes file to directory", async () => {
  const memory = makeMemory();
  await createImageMemory(memory, tmpDir);

  const file = Bun.file(join(tmpDir, `${memory.id}.json`));
  expect(await file.exists()).toBe(true);
});

test("createImageMemory: written file is valid JSON matching input", async () => {
  const memory = makeMemory();
  await createImageMemory(memory, tmpDir);

  const loaded = await Bun.file(join(tmpDir, `${memory.id}.json`)).json() as ImageMemory;
  expect(loaded.id).toBe(memory.id);
  expect(loaded.description).toBe(memory.description);
  expect(loaded.elements).toEqual(memory.elements);
  expect(loaded.concept_ids).toEqual(memory.concept_ids);
});

test("createImageMemory: creates directory if it does not exist", async () => {
  const nested = join(tmpDir, "deep", "images");
  const memory = makeMemory();
  await createImageMemory(memory, nested);

  const file = Bun.file(join(nested, `${memory.id}.json`));
  expect(await file.exists()).toBe(true);
});

test("readImageMemories: returns all valid memories", async () => {
  const m1 = makeMemory();
  const m2 = makeMemory();
  await createImageMemory(m1, tmpDir);
  await createImageMemory(m2, tmpDir);

  const memories = await readImageMemories(tmpDir);
  expect(memories.length).toBe(2);
  const ids = memories.map((m) => m.id);
  expect(ids).toContain(m1.id);
  expect(ids).toContain(m2.id);
});

test("readImageMemories: returns [] for missing directory", async () => {
  const memories = await readImageMemories(join(tmpDir, "nonexistent"));
  expect(memories).toEqual([]);
});

test("readImageMemories: skips invalid JSON files", async () => {
  const m = makeMemory();
  await createImageMemory(m, tmpDir);
  // Write a corrupt file
  await Bun.write(join(tmpDir, "corrupt.json"), "not json {{{");

  const memories = await readImageMemories(tmpDir);
  expect(memories.length).toBe(1);
  expect(memories[0]!.id).toBe(m.id);
});

test("loadImageMemory: loads by id", async () => {
  const m = makeMemory();
  await createImageMemory(m, tmpDir);

  const loaded = await loadImageMemory(m.id, tmpDir);
  expect(loaded).not.toBeNull();
  expect(loaded!.description).toBe(m.description);
});

test("loadImageMemory: returns null for missing id", async () => {
  const loaded = await loadImageMemory("nonexistent-id", tmpDir);
  expect(loaded).toBeNull();
});
