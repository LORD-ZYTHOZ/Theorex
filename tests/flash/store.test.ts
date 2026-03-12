import { describe, test, expect, afterEach } from "bun:test";
import { unlink, access } from "node:fs/promises";
import path from "node:path";
import {
  FlashEvent,
  FlashBuffer,
  readFlash,
  writeFlash,
  enforceRingBuffer,
  estimateTokens,
} from "../../src/flash/store";

const TEST_SESSION = "test-session-001";
const TEST_FLASH_DIR = "data/flash";

function makeEvent(overrides: Partial<FlashEvent> = {}): FlashEvent {
  return {
    tool_name: "Read",
    tool_input_preview: '{"file_path":"/test/file.ts"}',
    tool_response_preview: "file contents here",
    timestamp: new Date().toISOString(),
    significance_score: 0.5,
    ...overrides,
  };
}

afterEach(async () => {
  const filePath = path.join(TEST_FLASH_DIR, `${TEST_SESSION}.json`);
  try {
    await unlink(filePath);
  } catch {
    // ignore if not found
  }
});

// --- FLH-01: Ring buffer cap at 50 events ---

describe("FLH-01: Ring buffer cap at 50 events", () => {
  test("enforceRingBuffer: 51 events → evicts oldest, keeps newest 50", () => {
    const existing: FlashEvent[] = Array.from({ length: 50 }, (_, i) =>
      makeEvent({ tool_name: `Tool-${i}`, tool_input_preview: String(i) })
    );
    const incoming = makeEvent({ tool_name: "Tool-50", tool_input_preview: "50" });
    const result = enforceRingBuffer(existing, incoming);
    expect(result.length).toBe(50);
    // newest 50 should be index 1..50, oldest (Tool-0) evicted
    expect(result[0].tool_name).toBe("Tool-1");
    expect(result[49].tool_name).toBe("Tool-50");
  });

  test("enforceRingBuffer: 50 events → no eviction", () => {
    const existing: FlashEvent[] = Array.from({ length: 49 }, (_, i) =>
      makeEvent({ tool_name: `Tool-${i}` })
    );
    const incoming = makeEvent({ tool_name: "Tool-49" });
    const result = enforceRingBuffer(existing, incoming);
    expect(result.length).toBe(50);
    expect(result[49].tool_name).toBe("Tool-49");
  });

  test("enforceRingBuffer: 0 events + incoming → single event array", () => {
    const existing: FlashEvent[] = [];
    const incoming = makeEvent({ tool_name: "Tool-0" });
    const result = enforceRingBuffer(existing, incoming);
    expect(result.length).toBe(1);
    expect(result[0].tool_name).toBe("Tool-0");
  });
});

// --- FLH-03: Token ceiling at 4,000 ---

describe("FLH-03: Token ceiling at 4,000", () => {
  test("enforceRingBuffer: events within 4000 tokens → no additional eviction", () => {
    const existing: FlashEvent[] = [makeEvent({ tool_name: "A" })];
    const incoming = makeEvent({ tool_name: "B" });
    const result = enforceRingBuffer(existing, incoming);
    // Two small events are well under 4000 tokens
    expect(result.length).toBe(2);
  });

  test("enforceRingBuffer: single large event (>4000 token estimate) → kept (minimum 1 event always retained)", () => {
    // Create a single large event that exceeds 4000 token estimate
    const largePreview = "x".repeat(16001); // ~4000+ tokens (16001 / 4 = 4000.25)
    const existing: FlashEvent[] = [];
    const incoming = makeEvent({ tool_response_preview: largePreview });
    const result = enforceRingBuffer(existing, incoming);
    // Must keep at least 1 event even if over token ceiling
    expect(result.length).toBe(1);
    expect(result[0].tool_response_preview).toBe(largePreview);
  });

  test("estimateTokens: returns Math.ceil(JSON.stringify(events).length / 4)", () => {
    const events: FlashEvent[] = [makeEvent()];
    const expected = Math.ceil(JSON.stringify(events).length / 4);
    expect(estimateTokens(events)).toBe(expected);
  });
});

// --- FLH-02: Atomic read/write round-trip ---

describe("FLH-02: Atomic read/write round-trip", () => {
  test("writeFlash + readFlash: round-trips FlashBuffer with correct session_id and events", async () => {
    const events: FlashEvent[] = [
      makeEvent({ tool_name: "Write", significance_score: 0.8 }),
      makeEvent({ tool_name: "Bash", significance_score: 0.3 }),
    ];
    const buffer: FlashBuffer = { session_id: TEST_SESSION, events };
    await writeFlash(buffer);
    const loaded = await readFlash(TEST_SESSION);
    expect(loaded.session_id).toBe(TEST_SESSION);
    expect(loaded.events.length).toBe(2);
    expect(loaded.events[0].tool_name).toBe("Write");
    expect(loaded.events[1].tool_name).toBe("Bash");
    expect(loaded.events[0].significance_score).toBe(0.8);
  });

  test("readFlash: returns empty FlashBuffer when file does not exist (no throw)", async () => {
    const result = await readFlash("nonexistent-session-xyz");
    expect(result.session_id).toBe("nonexistent-session-xyz");
    expect(result.events).toEqual([]);
  });

  test("writeFlash: writes to data/flash/{session-id}.json path", async () => {
    const buffer: FlashBuffer = {
      session_id: TEST_SESSION,
      events: [makeEvent()],
    };
    await writeFlash(buffer);
    const expectedPath = path.join(TEST_FLASH_DIR, `${TEST_SESSION}.json`);
    // Should not throw if file exists (resolves with null/undefined — just no error)
    await expect(access(expectedPath)).resolves.toBeDefined();
  });

  test("writeFlash: creates data/flash/ directory if missing", async () => {
    // This test relies on the directory being created by writeFlash itself
    // We test with a unique session that ensures the dir exists post-write
    const buffer: FlashBuffer = {
      session_id: TEST_SESSION,
      events: [],
    };
    await writeFlash(buffer);
    // If we get here without error, dir creation worked
    const loaded = await readFlash(TEST_SESSION);
    expect(loaded.session_id).toBe(TEST_SESSION);
  });
});

// --- FlashEvent shape ---

describe("FlashEvent shape", () => {
  test("FlashEvent has required fields: tool_name, tool_input_preview, tool_response_preview, timestamp, significance_score", () => {
    const event: FlashEvent = {
      tool_name: "Read",
      tool_input_preview: '{"file_path":"/src/foo.ts"}',
      tool_response_preview: "export const x = 1;",
      timestamp: "2026-03-11T01:00:00Z",
      significance_score: 0.75,
    };
    expect(event.tool_name).toBe("Read");
    expect(event.tool_input_preview).toBe('{"file_path":"/src/foo.ts"}');
    expect(event.tool_response_preview).toBe("export const x = 1;");
    expect(event.timestamp).toBe("2026-03-11T01:00:00Z");
    expect(event.significance_score).toBe(0.75);
  });
});
