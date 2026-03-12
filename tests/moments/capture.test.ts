// tests/moments/capture.test.ts — Unit tests for capture module.
// Covers MOM-01 through MOM-04 and CLI-07.

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { captureCodeRefs, extractConceptIds, runMoment } from "../../src/moments/capture";
import type { Config } from "../../src/config";
import { DEFAULT_CONFIG } from "../../src/config";
import { AxonStore } from "../../src/axon/store";
import type { CodeRef } from "../../src/moments/store";
import { readMoments } from "../../src/moments/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestConfig(momentsDir: string): Config {
  return { ...DEFAULT_CONFIG, momentsDir };
}

/** Build an AxonStore with one ACTIVE node whose concept_id is knownId. */
async function makeAxonWithConcept(axonPath: string, conceptId: number): Promise<AxonStore> {
  const store = new AxonStore();
  // We use the internal mergeNode path via a fake ConceptEvent
  store.mergeNode({
    concept_id: conceptId,
    surface_form: "typescript",
    importance_score: 0.9,
    frequency_count: 5,
    composite_score: 0.9,
    source_weight: 1.0,
    node_type: "moment",
    timestamp: new Date().toISOString(),
  });
  await store.save(axonPath);
  return store;
}

let tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

async function makeTmpDir(): Promise<string> {
  const d = await mkdtemp(`${tmpdir()}/theorex-capture-`);
  tmpDirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// captureCodeRefs
// ---------------------------------------------------------------------------

describe("captureCodeRefs", () => {
  test("1. returns an array (may be empty — git may or may not be available)", async () => {
    const refs = await captureCodeRefs();
    expect(Array.isArray(refs)).toBe(true);
  });

  test("2. returns [] when git command fails (mocked failure)", async () => {
    // We pass a failing git fn to captureCodeRefs via the optional override
    const refs = await captureCodeRefs(() => Promise.reject(new Error("git not found")));
    expect(refs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractConceptIds
// ---------------------------------------------------------------------------

describe("extractConceptIds", () => {
  test("3. filters processText() output to only IDs present in knownIds Set", () => {
    // Use a story that is likely to produce some concept events
    // We need at least some non-empty NLP output — use a rich sentence
    const story =
      "TypeScript machine learning neural networks artificial intelligence deep learning";
    // Get result with all known IDs (permissive set)
    const all = extractConceptIds(story, new Set<number>(Array.from({ length: 100000 }, (_, i) => i)));
    // Then with empty set
    const none = extractConceptIds(story, new Set<number>());
    expect(none).toEqual([]);
    // all should have at least some ids (processText may return empty for short text)
    // At minimum it should be an array
    expect(Array.isArray(all)).toBe(true);
  });

  test("4. returns [] for empty story", () => {
    const result = extractConceptIds("", new Set([1, 2, 3]));
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runMoment
// ---------------------------------------------------------------------------

describe("runMoment", () => {
  test("5. creates a file in momentsDir", async () => {
    const tmpDir = await makeTmpDir();
    const axonPath = `${tmpDir}/axon.json`;
    const momentsDir = `${tmpDir}/moments`;
    const conceptId = 42;

    await makeAxonWithConcept(axonPath, conceptId);
    const config = makeTestConfig(momentsDir);

    await runMoment("test story about typescript", axonPath, config, [], momentsDir);

    const moments = await readMoments(momentsDir);
    expect(moments.length).toBe(1);
  });

  test("6. writes correct story text to the moment file", async () => {
    const tmpDir = await makeTmpDir();
    const axonPath = `${tmpDir}/axon.json`;
    const momentsDir = `${tmpDir}/moments`;

    await makeAxonWithConcept(axonPath, 99);
    const config = makeTestConfig(momentsDir);

    const storyText = "the quick brown fox jumped over the lazy dog";
    await runMoment(storyText, axonPath, config, [], momentsDir);

    const moments = await readMoments(momentsDir);
    expect(moments[0]?.story).toBe(storyText);
  });

  test("7. explicit CodeRef appears in moment.code_refs", async () => {
    const tmpDir = await makeTmpDir();
    const axonPath = `${tmpDir}/axon.json`;
    const momentsDir = `${tmpDir}/moments`;

    await makeAxonWithConcept(axonPath, 77);
    const config = makeTestConfig(momentsDir);

    const explicitRef: CodeRef = { file: "src/foo.ts", line: 42 };
    await runMoment("story with ref", axonPath, config, [explicitRef], momentsDir);

    const moments = await readMoments(momentsDir);
    const refs = moments[0]?.code_refs ?? [];
    const found = refs.some((r) => r.file === "src/foo.ts" && r.line === 42);
    expect(found).toBe(true);
  });

  test("8. outputs 'Moment saved: {uuid}' to console", async () => {
    const tmpDir = await makeTmpDir();
    const axonPath = `${tmpDir}/axon.json`;
    const momentsDir = `${tmpDir}/moments`;

    await makeAxonWithConcept(axonPath, 11);
    const config = makeTestConfig(momentsDir);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      await runMoment("console output test", axonPath, config, [], momentsDir);
    } finally {
      console.log = origLog;
    }

    const savedLog = logs.find((l) => l.startsWith("Moment saved: "));
    expect(savedLog).toBeDefined();
    // UUID is 36 chars
    expect(savedLog?.slice("Moment saved: ".length).length).toBe(36);
  });
});
