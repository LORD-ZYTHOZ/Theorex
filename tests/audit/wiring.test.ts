// tests/audit/wiring.test.ts — Integration tests verifying each mutation site
// actually writes the correct event to events.jsonl.
//
// Each test uses fresh tmp file paths to avoid cross-test interference.

import { describe, test, expect, afterEach } from "bun:test";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AxonStore } from "../../src/axon/store";
import { scanAxon } from "../../src/axon/scan";
import { pruneAxon } from "../../src/axon/prune";
import { createMoment, type MomentNode } from "../../src/moments/store";
import { graduateToLongTerm } from "../../src/short-term/graduate";
import { readAuditEvents } from "../../src/audit/reader";
import type { Config } from "../../src/config";
import type { ConceptEvent } from "../../src/types";
import type { ShortTermEntry } from "../../src/short-term/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const BASE_CFG: Config = {
  halfLifeDays: 14,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
  pruneThresholdDays: 30,
  edgePruneThreshold: 0.01,
  stmRetentionDays: 14,
  stmGraduateDays: 7,
  lmStudioUrl: "http://localhost:1234",
  lmStudioEmbedModel: "nomic-embed-text-v1.5",
  lmStudioTimeoutMs: 3000,
  ragBootstrapK: 5,
  ragBootstrapMinSimilarity: 0.4,
  ragSeedDissolutionDays: 7,
  ragEmbeddingStorePath: "data/concept-embeddings.json",
  ragOnnxModel: "Xenova/all-MiniLM-L6-v2",
  momentsDir: "data/moments",
  driftWindowDays: 7,
  eventsPath: "data/events.jsonl",
};

function tmpBase(): string {
  return join(tmpdir(), `theorex-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeConceptEvent(overrides: Partial<ConceptEvent> = {}): ConceptEvent {
  return {
    concept_id: 1,
    surface_form: "machine learning",
    importance_score: 1.0,
    frequency_count: 5,
    composite_score: 0.9,
    source_weight: 1.0,
    node_type: "concept",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// Minimal MEMORY.md content for graduateToLongTerm
const EMPTY_MEMORY = "# Memory\n\n## System\n\nTest system.\n";

// Cleanup tracking
const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ---------------------------------------------------------------------------
// Test 1: scanAxon tier_change event
// ---------------------------------------------------------------------------

describe("wiring: scanAxon → events.jsonl", () => {
  test("emits tier_change event when node tier changes from ACTIVE to LESS", async () => {
    const base = tmpBase();
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = join(base, "axon.json");
    const eventsPath = join(base, "events.jsonl");

    // Create a store with a node that starts at ACTIVE tier
    const store = await AxonStore.load(axonPath);
    const event = makeConceptEvent({ concept_id: 42, surface_form: "neural nets" });
    store.mergeNode(event);
    // Force node to ACTIVE tier in graph
    const nodeKey = store.graph.nodes()[0]!;
    store.graph.setNodeAttribute(nodeKey, "relevance_tier", "ACTIVE");
    // last_seen is far in the past — will score very low → LESS tier
    store.graph.setNodeAttribute(nodeKey, "last_seen", new Date(Date.now() - 365 * DAY_MS).toISOString());
    store.graph.setNodeAttribute(nodeKey, "frequency_count", 1);
    await store.save(axonPath);

    const cfg: Config = { ...BASE_CFG, eventsPath };

    // nowMs is "now" — last_seen 365 days ago will produce LESS tier score
    await scanAxon(axonPath, cfg, Date.now());

    // Give fire-and-forget a chance to flush
    await new Promise((r) => setTimeout(r, 50));

    const events = await readAuditEvents(eventsPath, { type: "tier_change" });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const tierEvent = events.find(
      (e) => e.type === "tier_change" && (e as any).concept_id === 42
    );
    expect(tierEvent).toBeDefined();
    expect((tierEvent as any).from).toBe("ACTIVE");
    expect((tierEvent as any).to).toBe("LESS");
    expect((tierEvent as any).source).toBe("scan");
  });

  test("does NOT emit tier_change event when tier is unchanged", async () => {
    const base = tmpBase();
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = join(base, "axon.json");
    const eventsPath = join(base, "events.jsonl");

    // Create a node that is already LESS and will stay LESS
    const store = await AxonStore.load(axonPath);
    const event = makeConceptEvent({ concept_id: 99, surface_form: "static concept" });
    store.mergeNode(event);
    const nodeKey = store.graph.nodes()[0]!;
    store.graph.setNodeAttribute(nodeKey, "relevance_tier", "LESS");
    store.graph.setNodeAttribute(nodeKey, "last_seen", new Date(Date.now() - 365 * DAY_MS).toISOString());
    store.graph.setNodeAttribute(nodeKey, "frequency_count", 1);
    await store.save(axonPath);

    const cfg: Config = { ...BASE_CFG, eventsPath };
    await scanAxon(axonPath, cfg, Date.now());

    await new Promise((r) => setTimeout(r, 50));

    const events = await readAuditEvents(eventsPath, { type: "tier_change" });
    const noOpEvent = events.find(
      (e) => (e as any).concept_id === 99
    );
    expect(noOpEvent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2: pruneAxon prune event
// ---------------------------------------------------------------------------

describe("wiring: pruneAxon → events.jsonl", () => {
  test("emits prune event for each dropped LESS-tier node", async () => {
    const base = tmpBase();
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const axonPath = join(base, "axon.json");
    const archiveDir = join(base, "archive");
    const eventsPath = join(base, "events.jsonl");

    // Create a store with one LESS-tier node old enough to prune
    const store = await AxonStore.load(axonPath);
    const event = makeConceptEvent({ concept_id: 77, surface_form: "old concept" });
    store.mergeNode(event);
    const nodeKey = store.graph.nodes()[0]!;
    store.graph.setNodeAttribute(nodeKey, "relevance_tier", "LESS");
    // 40 days old — past the 30-day threshold
    store.graph.setNodeAttribute(nodeKey, "last_seen", new Date(Date.now() - 40 * DAY_MS).toISOString());
    await store.save(axonPath);

    const cfg: Config = { ...BASE_CFG, eventsPath };
    await pruneAxon(axonPath, archiveDir, cfg, Date.now());

    // Give fire-and-forget a chance to flush
    await new Promise((r) => setTimeout(r, 50));

    const events = await readAuditEvents(eventsPath, { type: "prune" });
    expect(events.length).toBe(1);
    const pruneEvent = events[0] as any;
    expect(pruneEvent.concept_id).toBe(77);
    expect(pruneEvent.surface_form).toBe("old concept");
    expect(pruneEvent.source).toBe("prune");
  });
});

// ---------------------------------------------------------------------------
// Test 3: createMoment moment_capture event
// ---------------------------------------------------------------------------

describe("wiring: createMoment → events.jsonl", () => {
  test("emits moment_capture event after successful atomic write", async () => {
    const base = tmpBase();
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const momentsDir = join(base, "moments");
    const eventsPath = join(base, "events.jsonl");

    // Override the default EVENTS_PATH by mocking — but appendAuditEvent uses
    // default EVENTS_PATH. To test wiring, we temporarily override via config pattern.
    // Since createMoment has no config param, we test with the real EVENTS_PATH
    // by using a workaround: write the event to a custom path by passing it.
    //
    // The plan spec says createMoment uses default EVENTS_PATH (no config override).
    // So we use the real data/events.jsonl path, but read from it post-write.
    // For isolation, we instead verify by reading from the actual EVENTS_PATH.
    // We accept that other tests might have written there — filter by moment_id.

    const momentId = crypto.randomUUID();
    const story = "Integration test: verifying moment_capture wiring works correctly in Theorex";
    const moment: MomentNode = {
      id: momentId,
      timestamp: new Date().toISOString(),
      story,
      code_refs: [],
      concept_ids: [1, 2, 3],
    };

    await createMoment(moment, momentsDir);

    // Give fire-and-forget a chance to flush to data/events.jsonl
    await new Promise((r) => setTimeout(r, 100));

    // Read from the real events path (createMoment has no override param)
    const events = await readAuditEvents("data/events.jsonl", { type: "moment_capture" });
    const captureEvent = events.find((e) => (e as any).moment_id === momentId);
    expect(captureEvent).toBeDefined();
    expect((captureEvent as any).source).toBe("moment");
    expect((captureEvent as any).story_preview).toBe(story.slice(0, 60));
    expect((captureEvent as any).concept_ids).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Test 4: graduateToLongTerm graduation event
// ---------------------------------------------------------------------------

describe("wiring: graduateToLongTerm → events.jsonl", () => {
  test("emits graduation event for each graduated candidate", async () => {
    const base = tmpBase();
    cleanupDirs.push(base);
    await mkdir(base, { recursive: true });

    const memoryPath = join(base, "MEMORY.md");
    await writeFile(memoryPath, EMPTY_MEMORY, "utf-8");

    const candidate: ShortTermEntry = {
      id: crypto.randomUUID(),
      concept_id: 55,
      surface_form: "gradient descent",
      composite_score: 0.75,
      source_weight: 1.0,
      timestamp: "2026-01-08T12:00:00.000Z",
      date: "2026-01-08",
    };

    await graduateToLongTerm([candidate], memoryPath);

    // Give fire-and-forget a chance to flush to data/events.jsonl
    await new Promise((r) => setTimeout(r, 100));

    // graduateToLongTerm uses default EVENTS_PATH — filter by concept_id
    const events = await readAuditEvents("data/events.jsonl", { type: "graduation" });
    const graduationEvent = events.find((e) => (e as any).concept_id === 55);
    expect(graduationEvent).toBeDefined();
    expect((graduationEvent as any).surface_form).toBe("gradient descent");
    expect((graduationEvent as any).source).toBe("graduate");
  });
});
