// tests/flash-fixes.test.ts — Tests for flash eviction and session ID fixes.
//
// FLASH-FIX-01: enforceRingBuffer evicts lowest-significance first (not oldest)
// FLASH-FIX-02: missing/unknown sessionId uses date-based fallback
// FLASH-FIX-03: pruneStaleFlashFiles removes files older than threshold

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enforceRingBuffer } from "../flash/store";
import type { FlashEvent } from "../flash/store";
import { resolveSessionId } from "../flash/record";
import { pruneStaleFlashFiles } from "../flash/flush";

const TMP = join(tmpdir(), "theorex-flash-fixes-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// --- Helpers ---

function makeEvent(overrides: Partial<FlashEvent> = {}): FlashEvent {
  return {
    tool_name: "test_tool",
    tool_input_preview: "{}",
    tool_response_preview: "ok",
    timestamp: new Date().toISOString(),
    significance_score: 0.5,
    ...overrides,
  };
}

// --- FLASH-FIX-01: Significance-biased eviction ---

describe("enforceRingBuffer — significance-biased eviction", () => {
  test("evicts lowest-significance entry, not oldest, when ring is full", () => {
    // Build 49 high-significance events (indices 0..48), oldest first
    const highSig = Array.from({ length: 49 }, (_, i) =>
      makeEvent({
        tool_name: `tool_${i}`,
        significance_score: 0.8,
        timestamp: new Date(Date.now() - (49 - i) * 1000).toISOString(),
      })
    );

    // One low-significance event appended last (most recent among current events)
    const lowSigEvent = makeEvent({
      tool_name: "low_sig_target",
      significance_score: 0.1,
      timestamp: new Date(Date.now() - 0).toISOString(),
    });

    // Total events = 50 (exactly MAX_EVENTS). Adding 1 incoming triggers 1 eviction.
    const events = [...highSig, lowSigEvent];

    const incoming = makeEvent({
      tool_name: "new_tool",
      significance_score: 0.9,
      timestamp: new Date(Date.now() + 1000).toISOString(),
    });
    const result = enforceRingBuffer(events, incoming);

    // Result should have exactly 50 entries
    expect(result.length).toBe(50);

    // The low-significance event must have been evicted (not the oldest high-sig event)
    expect(result.some((e) => e.tool_name === "low_sig_target")).toBe(false);

    // The oldest high-significance event must still be present
    expect(result.some((e) => e.tool_name === "tool_0")).toBe(true);

    // The incoming new event must be present
    expect(result.some((e) => e.tool_name === "new_tool")).toBe(true);
  });

  test("uses timestamp as tiebreak when significance scores are equal", () => {
    // Fill buffer to capacity with equal-significance events at known timestamps
    const base = Array.from({ length: 50 }, (_, i) =>
      makeEvent({
        tool_name: `tool_${i}`,
        significance_score: 0.5,
        timestamp: new Date(Date.now() - (50 - i) * 1000).toISOString(),
      })
    );

    const incoming = makeEvent({
      tool_name: "newest",
      significance_score: 0.5,
      timestamp: new Date().toISOString(),
    });

    const result = enforceRingBuffer(base, incoming);

    expect(result.length).toBe(50);

    // When all scores are equal, the oldest entry (tool_0) should be evicted
    expect(result.some((e) => e.tool_name === "tool_0")).toBe(false);
    expect(result.some((e) => e.tool_name === "newest")).toBe(true);
  });

  test("does not mutate the input array", () => {
    const events: readonly FlashEvent[] = [
      makeEvent({ tool_name: "existing", significance_score: 0.7 }),
    ];
    const incoming = makeEvent({ tool_name: "incoming" });
    enforceRingBuffer(events, incoming);
    expect(events.length).toBe(1);
    expect(events[0].tool_name).toBe("existing");
  });
});

// --- FLASH-FIX-02: Date-based session ID fallback ---

describe("resolveSessionId — date-based fallback", () => {
  test("returns a date-based session ID when sessionId is 'unknown'", () => {
    const result = resolveSessionId("unknown");
    expect(result).toMatch(/^session_\d{4}-\d{2}-\d{2}$/);
  });

  test("returns a date-based session ID when sessionId is empty string", () => {
    const result = resolveSessionId("");
    expect(result).toMatch(/^session_\d{4}-\d{2}-\d{2}$/);
  });

  test("returns a date-based session ID when sessionId is null", () => {
    const result = resolveSessionId(null);
    expect(result).toMatch(/^session_\d{4}-\d{2}-\d{2}$/);
  });

  test("returns a date-based session ID when sessionId is undefined", () => {
    const result = resolveSessionId(undefined);
    expect(result).toMatch(/^session_\d{4}-\d{2}-\d{2}$/);
  });

  test("preserves a valid non-unknown sessionId unchanged", () => {
    const valid = "abc123-session";
    expect(resolveSessionId(valid)).toBe(valid);
  });

  test("date portion matches today's date", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(resolveSessionId("unknown")).toBe(`session_${today}`);
  });
});

// --- FLASH-FIX-03: pruneStaleFlashFiles ---

describe("pruneStaleFlashFiles — removes old date-stamped files", () => {
  test("deletes session files older than threshold", async () => {
    const dir = join(TMP, "flash-prune-1");
    await mkdir(dir, { recursive: true });

    // Create an old file (10 days ago)
    const old = new Date();
    old.setDate(old.getDate() - 10);
    const oldDate = old.toISOString().slice(0, 10);
    const oldFile = join(dir, `session_${oldDate}.json`);
    await writeFile(oldFile, JSON.stringify({ session_id: oldDate, events: [] }));

    const deleted = await pruneStaleFlashFiles(7, dir);

    expect(deleted).toContain(oldFile);
    const remaining = await readdir(dir);
    expect(remaining).not.toContain(`session_${oldDate}.json`);
  });

  test("keeps files within the threshold", async () => {
    const dir = join(TMP, "flash-prune-2");
    await mkdir(dir, { recursive: true });

    // Create a recent file (2 days ago)
    const recent = new Date();
    recent.setDate(recent.getDate() - 2);
    const recentDate = recent.toISOString().slice(0, 10);
    const recentFile = join(dir, `session_${recentDate}.json`);
    await writeFile(recentFile, JSON.stringify({ session_id: recentDate, events: [] }));

    const deleted = await pruneStaleFlashFiles(7, dir);

    expect(deleted).not.toContain(recentFile);
    const remaining = await readdir(dir);
    expect(remaining).toContain(`session_${recentDate}.json`);
  });

  test("does not delete non-date-pattern files", async () => {
    const dir = join(TMP, "flash-prune-3");
    await mkdir(dir, { recursive: true });

    // A named session file that should never be auto-pruned
    const namedFile = join(dir, "my-named-session.json");
    await writeFile(namedFile, JSON.stringify({ session_id: "my-named-session", events: [] }));

    const deleted = await pruneStaleFlashFiles(0, dir); // threshold=0 means everything older than today

    expect(deleted).not.toContain(namedFile);
    const remaining = await readdir(dir);
    expect(remaining).toContain("my-named-session.json");
  });

  test("returns empty array when flash directory does not exist", async () => {
    const missing = join(TMP, "nonexistent-dir");
    const deleted = await pruneStaleFlashFiles(7, missing);
    expect(deleted).toEqual([]);
  });

  test("deletes multiple old files in one call", async () => {
    const dir = join(TMP, "flash-prune-4");
    await mkdir(dir, { recursive: true });

    const filePaths: string[] = [];
    for (let i = 8; i <= 12; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const fp = join(dir, `session_${dateStr}.json`);
      await writeFile(fp, "{}");
      filePaths.push(fp);
    }

    const deleted = await pruneStaleFlashFiles(7, dir);

    expect(deleted.length).toBe(5);
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });
});
