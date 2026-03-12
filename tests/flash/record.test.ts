// tests/flash/record.test.ts
// Unit tests for buildFlashEvent and recordFlashEvent.
// RED phase: all tests fail with "Cannot find module" because src/flash/record.ts does not exist yet.

import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { readFlash } from "../../src/flash/store";
import { buildFlashEvent, recordFlashEvent } from "../../src/flash/record";

// Track temp flash files to clean up after each test
const tempFiles: string[] = [];

afterEach(async () => {
  for (const filePath of tempFiles) {
    try {
      await unlink(filePath);
    } catch {
      // ignore missing files
    }
  }
  tempFiles.length = 0;
});

// ---------------------------------------------------------------------------
// buildFlashEvent — field mapping
// ---------------------------------------------------------------------------

describe("buildFlashEvent: field mapping", () => {
  const hookInput = {
    session_id: "sess-abc",
    tool_name: "Read",
    tool_input: { file_path: "/Users/eoh/theorex/src/compose.ts" },
    tool_response: { content: "file contents here" },
    tool_use_id: "toolu_01ABC",
  };

  test("buildFlashEvent: tool_name is taken from hookInput.tool_name", () => {
    const event = buildFlashEvent(hookInput);
    expect(event.tool_name).toBe("Read");
  });

  test("buildFlashEvent: tool_input_preview is truncated to 300 chars", () => {
    const event = buildFlashEvent(hookInput);
    expect(event.tool_input_preview.length).toBeLessThanOrEqual(300);
  });

  test("buildFlashEvent: tool_response_preview is taken from tool_response content, max 500 chars", () => {
    const event = buildFlashEvent(hookInput);
    expect(event.tool_response_preview.length).toBeLessThanOrEqual(500);
    expect(event.tool_response_preview).toContain("file contents here");
  });

  test("buildFlashEvent: timestamp is an ISO 8601 string", () => {
    const event = buildFlashEvent(hookInput);
    expect(typeof event.timestamp).toBe("string");
    // ISO 8601 check: must parse to a valid date
    const parsed = new Date(event.timestamp);
    expect(isNaN(parsed.getTime())).toBe(false);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("buildFlashEvent: significance_score is a number between 0 and 1 inclusive", () => {
    const event = buildFlashEvent(hookInput);
    expect(typeof event.significance_score).toBe("number");
    expect(event.significance_score).toBeGreaterThanOrEqual(0);
    expect(event.significance_score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// buildFlashEvent — significance_score computation
// ---------------------------------------------------------------------------

describe("buildFlashEvent: significance_score computation", () => {
  test("buildFlashEvent: significance_score is 0 when tool_name and tool_input produce no concepts", () => {
    // Empty tool_name + empty object → textToScore=" {}" → significance engine returns []
    const emptyInput = {
      tool_name: "",
      tool_input: {},
      tool_response: {},
    };
    const event = buildFlashEvent(emptyInput);
    expect(event.significance_score).toBe(0);
  });

  test("buildFlashEvent: significance_score is > 0 when tool_input contains meaningful text", () => {
    const meaningfulInput = {
      tool_name: "Write",
      tool_input: {
        file_path: "/src/memory/longterm.ts",
        content:
          "The neural network architecture uses transformer attention mechanisms with reinforcement learning optimization algorithms for natural language processing tasks in the knowledge graph system.",
      },
      tool_response: { success: true },
    };
    const event = buildFlashEvent(meaningfulInput);
    expect(event.significance_score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildFlashEvent — preview truncation
// ---------------------------------------------------------------------------

describe("buildFlashEvent: preview truncation", () => {
  test("buildFlashEvent: tool_input_preview never exceeds 300 chars even for large inputs", () => {
    const largeInput = {
      tool_name: "Write",
      tool_input: { content: "x".repeat(10000) },
      tool_response: {},
    };
    const event = buildFlashEvent(largeInput);
    expect(event.tool_input_preview.length).toBeLessThanOrEqual(300);
  });

  test("buildFlashEvent: tool_response_preview never exceeds 500 chars even for large responses", () => {
    const largeResponse = {
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { stdout: "y".repeat(10000) },
    };
    const event = buildFlashEvent(largeResponse);
    expect(event.tool_response_preview.length).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// recordFlashEvent — ring-buffer round-trip
// ---------------------------------------------------------------------------

describe("recordFlashEvent: ring-buffer round-trip", () => {
  const FLASH_DIR = "data/flash";

  test("recordFlashEvent: after calling with a temp session id, readFlash returns a buffer with 1 event", async () => {
    const sessionId = "rec-test-" + Math.random().toString(36).slice(2);
    tempFiles.push(path.join(FLASH_DIR, `${sessionId}.json`));

    const hookInput = {
      session_id: sessionId,
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test.ts" },
      tool_response: { content: "test content" },
    };

    await recordFlashEvent(sessionId, hookInput);

    const buffer = await readFlash(sessionId, FLASH_DIR);
    expect(buffer.events.length).toBe(1);
    expect(buffer.events[0]!.tool_name).toBe("Read");
  });

  test("recordFlashEvent: calling twice results in a buffer with 2 events", async () => {
    const sessionId = "rec-test-" + Math.random().toString(36).slice(2);
    tempFiles.push(path.join(FLASH_DIR, `${sessionId}.json`));

    const hookInput1 = {
      session_id: sessionId,
      tool_name: "Read",
      tool_input: { file_path: "/tmp/a.ts" },
      tool_response: { content: "first" },
    };

    const hookInput2 = {
      session_id: sessionId,
      tool_name: "Write",
      tool_input: { file_path: "/tmp/b.ts", content: "hello" },
      tool_response: { success: true },
    };

    await recordFlashEvent(sessionId, hookInput1);
    await recordFlashEvent(sessionId, hookInput2);

    const buffer = await readFlash(sessionId, FLASH_DIR);
    expect(buffer.events.length).toBe(2);
    expect(buffer.events[0]!.tool_name).toBe("Read");
    expect(buffer.events[1]!.tool_name).toBe("Write");
  });
});
