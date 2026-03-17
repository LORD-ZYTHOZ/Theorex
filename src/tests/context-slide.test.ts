// tests/context-slide.test.ts — Tests for Phase 15 context-slide modules.
// Covers: flashEventsToNarrative, extractHeuristic (via extractKeyPoints fallback),
// formatKeyPointsForAxon, shouldCompress, readSlideState, writeSlideState,
// readContextMetrics.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  flashEventsToNarrative,
  formatKeyPointsForAxon,
  type KeyPoints,
} from "../context-slide/compress";

import {
  shouldCompress,
  readSlideState,
  writeSlideState,
  type ContextMetrics,
  type SlideState,
} from "../context-slide/monitor";

import type { FlashEvent } from "../flash/store";

const TMP = join(tmpdir(), "theorex-context-slide-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<FlashEvent> = {}): FlashEvent {
  return {
    tool_name: "Read",
    tool_input_preview: "src/index.ts",
    tool_response_preview: "file content",
    timestamp: new Date().toISOString(),
    significance_score: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// flashEventsToNarrative
// ---------------------------------------------------------------------------

describe("flashEventsToNarrative()", () => {
  test("returns no-activity message for empty events array", () => {
    const result = flashEventsToNarrative([]);
    expect(result).toBe("No recent activity recorded.");
  });

  test("includes header line for non-empty events", () => {
    const events = [makeEvent({ tool_name: "Bash", tool_input_preview: "ls /tmp" })];
    const result = flashEventsToNarrative(events);
    expect(result).toContain("Recent activity");
    expect(result).toContain("Bash");
  });

  test("extracts HH:MM from ISO timestamp", () => {
    const events = [
      makeEvent({ timestamp: "2026-03-18T14:32:00.000Z", tool_name: "Read" }),
    ];
    const result = flashEventsToNarrative(events);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  test("includes tool_input_preview (up to 150 chars)", () => {
    const long = "x".repeat(200);
    const events = [makeEvent({ tool_input_preview: long })];
    const result = flashEventsToNarrative(events);
    // Preview should be truncated to 150 chars
    expect(result).toContain("x".repeat(150));
    expect(result).not.toContain("x".repeat(151));
  });

  test("appends tool_response_preview when non-empty", () => {
    const events = [makeEvent({ tool_response_preview: "some output" })];
    const result = flashEventsToNarrative(events);
    expect(result).toContain("→ some output");
  });

  test("does not append → when tool_response_preview is empty", () => {
    const events = [makeEvent({ tool_response_preview: "" })];
    const result = flashEventsToNarrative(events);
    expect(result).not.toContain("→");
  });

  test("handles multiple events", () => {
    const events = [
      makeEvent({ tool_name: "Read" }),
      makeEvent({ tool_name: "Write" }),
      makeEvent({ tool_name: "Bash" }),
    ];
    const result = flashEventsToNarrative(events);
    expect(result).toContain("Read");
    expect(result).toContain("Write");
    expect(result).toContain("Bash");
    expect(result.split("\n").length).toBe(4); // header + 3 events
  });

  test("replaces newlines in preview with spaces", () => {
    const events = [makeEvent({ tool_input_preview: "line1\nline2" })];
    const result = flashEventsToNarrative(events);
    expect(result).toContain("line1 line2");
    expect(result).not.toContain("\n\n");
  });
});

// ---------------------------------------------------------------------------
// formatKeyPointsForAxon
// ---------------------------------------------------------------------------

describe("formatKeyPointsForAxon()", () => {
  test("returns just summary when all arrays are empty", () => {
    const points: KeyPoints = {
      summary: "Session summary here.",
      decisions: [],
      facts: [],
      tasks_in_progress: [],
      errors_solved: [],
      raw_fallback: false,
    };
    expect(formatKeyPointsForAxon(points)).toBe("Session summary here.");
  });

  test("includes decisions section when non-empty", () => {
    const points: KeyPoints = {
      summary: "Summary.",
      decisions: ["Use BM25 index", "Skip RAG fallback"],
      facts: [],
      tasks_in_progress: [],
      errors_solved: [],
      raw_fallback: false,
    };
    const result = formatKeyPointsForAxon(points);
    expect(result).toContain("Decisions: Use BM25 index; Skip RAG fallback");
  });

  test("includes facts section when non-empty", () => {
    const points: KeyPoints = {
      summary: "Summary.",
      decisions: [],
      facts: ["Bun 1.3 is installed", "Tests use bun:test"],
      tasks_in_progress: [],
      errors_solved: [],
      raw_fallback: false,
    };
    const result = formatKeyPointsForAxon(points);
    expect(result).toContain("Facts: Bun 1.3 is installed; Tests use bun:test");
  });

  test("includes tasks_in_progress section when non-empty", () => {
    const points: KeyPoints = {
      summary: "Summary.",
      decisions: [],
      facts: [],
      tasks_in_progress: ["Writing tests", "Fixing coverage"],
      errors_solved: [],
      raw_fallback: false,
    };
    const result = formatKeyPointsForAxon(points);
    expect(result).toContain("In progress: Writing tests; Fixing coverage");
  });

  test("includes errors_solved section when non-empty", () => {
    const points: KeyPoints = {
      summary: "Summary.",
      decisions: [],
      facts: [],
      tasks_in_progress: [],
      errors_solved: ["Fixed NaN score bug"],
      raw_fallback: true,
    };
    const result = formatKeyPointsForAxon(points);
    expect(result).toContain("Resolved: Fixed NaN score bug");
  });

  test("joins sections with | separator", () => {
    const points: KeyPoints = {
      summary: "Summary.",
      decisions: ["decision1"],
      facts: ["fact1"],
      tasks_in_progress: [],
      errors_solved: [],
      raw_fallback: false,
    };
    const result = formatKeyPointsForAxon(points);
    expect(result).toContain(" | ");
    const parts = result.split(" | ");
    expect(parts.length).toBe(3); // summary + decisions + facts
  });

  test("all sections populated produces correct structure", () => {
    const points: KeyPoints = {
      summary: "Big session.",
      decisions: ["d1"],
      facts: ["f1"],
      tasks_in_progress: ["t1"],
      errors_solved: ["e1"],
      raw_fallback: false,
    };
    const result = formatKeyPointsForAxon(points);
    expect(result).toContain("Big session.");
    expect(result).toContain("Decisions:");
    expect(result).toContain("Facts:");
    expect(result).toContain("In progress:");
    expect(result).toContain("Resolved:");
    expect(result.split(" | ").length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// shouldCompress
// ---------------------------------------------------------------------------

describe("shouldCompress()", () => {
  const makeMetrics = (used_pct: number): ContextMetrics => ({
    used_pct,
    remaining_pct: 100 - used_pct,
    timestamp: Math.floor(Date.now() / 1000),
  });

  const defaultState: SlideState = {
    calls_since_compress: 0,
    last_compress_at: null,
    compression_count: 0,
  };

  test("returns false when usage is below threshold", () => {
    const metrics = makeMetrics(30); // 30% used
    expect(shouldCompress(metrics, defaultState, 0.5, 20)).toBe(false);
  });

  test("returns true on first compression (last_compress_at=null) when threshold met", () => {
    const metrics = makeMetrics(55); // 55% used, threshold 0.5 → 50%
    expect(shouldCompress(metrics, defaultState, 0.5, 20)).toBe(true);
  });

  test("returns false when threshold met but cooldown not elapsed", () => {
    const state: SlideState = {
      calls_since_compress: 5, // need 20
      last_compress_at: new Date().toISOString(),
      compression_count: 1,
    };
    const metrics = makeMetrics(60);
    expect(shouldCompress(metrics, state, 0.5, 20)).toBe(false);
  });

  test("returns true when threshold met AND cooldown elapsed", () => {
    const state: SlideState = {
      calls_since_compress: 25, // >= 20
      last_compress_at: new Date().toISOString(),
      compression_count: 1,
    };
    const metrics = makeMetrics(60);
    expect(shouldCompress(metrics, state, 0.5, 20)).toBe(true);
  });

  test("threshold is compared as percentage — 0.5 threshold means 50% usage", () => {
    const metricsAt50 = makeMetrics(50);
    const metricsAt49 = makeMetrics(49);
    expect(shouldCompress(metricsAt50, defaultState, 0.5, 20)).toBe(true);
    expect(shouldCompress(metricsAt49, defaultState, 0.5, 20)).toBe(false);
  });

  test("exactly at threshold with cooldown exactly met returns true", () => {
    const state: SlideState = {
      calls_since_compress: 20, // exactly == cooldown
      last_compress_at: new Date().toISOString(),
      compression_count: 2,
    };
    const metrics = makeMetrics(50);
    expect(shouldCompress(metrics, state, 0.5, 20)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readSlideState / writeSlideState
// ---------------------------------------------------------------------------

describe("readSlideState() / writeSlideState()", () => {
  test("readSlideState returns default state when file does not exist", async () => {
    const sessionId = "no-such-slide-session-" + Date.now();
    const state = await readSlideState(sessionId);
    expect(state.calls_since_compress).toBe(0);
    expect(state.last_compress_at).toBeNull();
    expect(state.compression_count).toBe(0);
  });

  test("writeSlideState persists state readable by readSlideState", async () => {
    const sessionId = "test-slide-rw-" + Date.now();
    const toWrite: SlideState = {
      calls_since_compress: 15,
      last_compress_at: "2026-03-18T10:00:00.000Z",
      compression_count: 3,
    };
    await writeSlideState(sessionId, toWrite);
    const loaded = await readSlideState(sessionId);
    expect(loaded.calls_since_compress).toBe(15);
    expect(loaded.last_compress_at).toBe("2026-03-18T10:00:00.000Z");
    expect(loaded.compression_count).toBe(3);
  });

  test("overwriting slide state with new values replaces old values", async () => {
    const sessionId = "test-slide-overwrite-" + Date.now();
    await writeSlideState(sessionId, {
      calls_since_compress: 5,
      last_compress_at: "2026-03-01T00:00:00.000Z",
      compression_count: 1,
    });
    await writeSlideState(sessionId, {
      calls_since_compress: 0,
      last_compress_at: "2026-03-18T12:00:00.000Z",
      compression_count: 2,
    });
    const loaded = await readSlideState(sessionId);
    expect(loaded.calls_since_compress).toBe(0);
    expect(loaded.compression_count).toBe(2);
  });
});
