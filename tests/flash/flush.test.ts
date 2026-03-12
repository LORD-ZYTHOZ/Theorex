// tests/flash/flush.test.ts — Unit tests for flushFlash.
// Covers FLH-04 (significance filter >= 0.5), FLH-05 (clear flash after flush), HKS-02.

import { describe, test, expect, mock } from "bun:test";
import { flushFlash } from "../../src/flash/flush";
import type { FlashBuffer, FlashEvent } from "../../src/flash/store";
import type { ShortTermEntry } from "../../src/short-term/store";

function makeEvent(overrides: Partial<FlashEvent> = {}): FlashEvent {
  return {
    tool_name: "test_tool",
    tool_input_preview: '{"file":"test.ts"}',
    tool_response_preview: "OK",
    timestamp: "2026-03-11T00:00:00Z",
    significance_score: 0.7,
    ...overrides,
  };
}

describe("flushFlash", () => {
  test("events with significance_score >= 0.5 are passed to appendEntry", async () => {
    const events: FlashEvent[] = [
      makeEvent({ significance_score: 0.5, tool_name: "tool_at_threshold" }),
      makeEvent({ significance_score: 0.8, tool_name: "tool_above" }),
      makeEvent({ significance_score: 0.3, tool_name: "tool_below" }),
    ];

    const buffer: FlashBuffer = { session_id: "sess-1", events };
    const writtenEntries: ShortTermEntry[] = [];

    const result = await flushFlash("sess-1", {
      readFlash: async (_id: string) => buffer,
      writeFlash: async (_buf: FlashBuffer) => {},
      appendEntry: async (entry: ShortTermEntry) => {
        writtenEntries.push(entry);
      },
    });

    // Only >= 0.5 should be written
    expect(result).toBe(2);
    expect(writtenEntries).toHaveLength(2);
    const names = writtenEntries.map((e) => e.surface_form);
    expect(names).toContain("tool_at_threshold");
    expect(names).toContain("tool_above");
    expect(names).not.toContain("tool_below");
  });

  test("events with significance_score < 0.5 are not written", async () => {
    const events: FlashEvent[] = [
      makeEvent({ significance_score: 0.49, tool_name: "just_below" }),
      makeEvent({ significance_score: 0.1, tool_name: "very_low" }),
    ];

    const buffer: FlashBuffer = { session_id: "sess-2", events };
    const writtenEntries: ShortTermEntry[] = [];

    const result = await flushFlash("sess-2", {
      readFlash: async (_id: string) => buffer,
      writeFlash: async (_buf: FlashBuffer) => {},
      appendEntry: async (entry: ShortTermEntry) => {
        writtenEntries.push(entry);
      },
    });

    expect(result).toBe(0);
    expect(writtenEntries).toHaveLength(0);
  });

  test("after flush, flash buffer is cleared (writeFlash called with empty events)", async () => {
    const events: FlashEvent[] = [
      makeEvent({ significance_score: 0.9 }),
    ];
    const buffer: FlashBuffer = { session_id: "sess-3", events };

    const writtenBuffers: FlashBuffer[] = [];

    await flushFlash("sess-3", {
      readFlash: async (_id: string) => buffer,
      writeFlash: async (buf: FlashBuffer) => {
        writtenBuffers.push(buf);
      },
      appendEntry: async (_entry: ShortTermEntry) => {},
    });

    // writeFlash must have been called with empty events array
    expect(writtenBuffers).toHaveLength(1);
    expect(writtenBuffers[0].session_id).toBe("sess-3");
    expect(writtenBuffers[0].events).toHaveLength(0);
  });

  test("returns 0 when no events pass significance threshold (no short-term writes)", async () => {
    const buffer: FlashBuffer = {
      session_id: "sess-4",
      events: [
        makeEvent({ significance_score: 0.0 }),
        makeEvent({ significance_score: 0.499 }),
      ],
    };

    const writtenEntries: ShortTermEntry[] = [];

    const result = await flushFlash("sess-4", {
      readFlash: async (_id: string) => buffer,
      writeFlash: async (_buf: FlashBuffer) => {},
      appendEntry: async (entry: ShortTermEntry) => {
        writtenEntries.push(entry);
      },
    });

    expect(result).toBe(0);
    expect(writtenEntries).toHaveLength(0);
  });

  test("returns count of events written to short-term", async () => {
    const events: FlashEvent[] = [
      makeEvent({ significance_score: 0.6 }),
      makeEvent({ significance_score: 0.7 }),
      makeEvent({ significance_score: 0.8 }),
    ];
    const buffer: FlashBuffer = { session_id: "sess-5", events };

    const result = await flushFlash("sess-5", {
      readFlash: async (_id: string) => buffer,
      writeFlash: async (_buf: FlashBuffer) => {},
      appendEntry: async (_entry: ShortTermEntry) => {},
    });

    expect(result).toBe(3);
  });

  test("no-op when flash file does not exist (cold start — no throw)", async () => {
    // readFlash returns empty buffer (ENOENT behavior)
    const emptyBuffer: FlashBuffer = { session_id: "cold-session", events: [] };
    let writeFlashCalled = false;

    const result = await flushFlash("cold-session", {
      readFlash: async (_id: string) => emptyBuffer,
      writeFlash: async (_buf: FlashBuffer) => {
        writeFlashCalled = true;
      },
      appendEntry: async (_entry: ShortTermEntry) => {},
    });

    // Should not throw, should return 0, and writeFlash still clears (empty → empty)
    expect(result).toBe(0);
    // writeFlash IS called to clear — even if already empty
    expect(writeFlashCalled).toBe(true);
  });
});
