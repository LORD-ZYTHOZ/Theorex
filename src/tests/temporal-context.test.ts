// tests/temporal-context.test.ts — Tests for src/temporal/context.ts pure helpers.
// buildTemporalContext is I/O-heavy (reads/writes temporal store) — tested via
// the exported pure classification functions. formatTemporalContext is pure and fully testable.

import { describe, test, expect } from "bun:test";
import {
  formatTemporalContext,
  type TemporalContext,
  type TimeOfDay,
  type GapType,
  type WorkContext,
} from "../temporal/context";

// ---------------------------------------------------------------------------
// Helper: build a minimal TemporalContext
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<TemporalContext> = {}): TemporalContext {
  return {
    current_time: "2026-03-18T10:00:00.000Z",
    timezone: "Australia/Sydney",
    utc_offset_minutes: -660, // UTC+11
    location: "Sydney",
    day_of_week: "Wednesday",
    date: "2026-03-18",
    hour: 10,
    time_of_day: "morning" as TimeOfDay,
    work_context: "work_hours" as WorkContext,
    gap_ms: null,
    gap_human: "first session",
    gap_type: "first_session" as GapType,
    session_count: 1,
    reorientation_needed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatTemporalContext — header and core lines
// ---------------------------------------------------------------------------

describe("formatTemporalContext()", () => {
  test("includes THEOREX TEMPORAL CONTEXT header", () => {
    const result = formatTemporalContext(makeCtx());
    expect(result).toContain("=== THEOREX TEMPORAL CONTEXT ===");
  });

  test("includes day of week and date", () => {
    const result = formatTemporalContext(makeCtx());
    expect(result).toContain("Wednesday");
    expect(result).toContain("2026-03-18");
  });

  test("includes session count", () => {
    const result = formatTemporalContext(makeCtx({ session_count: 5 }));
    expect(result).toContain("Session: #5");
  });

  test("includes gap_human and gap_type", () => {
    const ctx = makeCtx({ gap_human: "8h 30m", gap_type: "sleep" });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("8h 30m");
    expect(result).toContain("[sleep]");
  });

  test("UTC sign is + for UTC+ zone (negative JS offset)", () => {
    const ctx = makeCtx({ utc_offset_minutes: -660 }); // UTC+11
    const result = formatTemporalContext(ctx);
    expect(result).toContain("UTC+11");
  });

  test("UTC sign is - for UTC- zone (positive JS offset)", () => {
    const ctx = makeCtx({ utc_offset_minutes: 300 }); // UTC-5
    const result = formatTemporalContext(ctx);
    expect(result).toContain("UTC-5");
  });

  test("includes location when set", () => {
    const result = formatTemporalContext(makeCtx({ location: "Sydney" }));
    expect(result).toContain("Sydney");
  });

  test("does not append location when location is empty", () => {
    const result = formatTemporalContext(makeCtx({ location: "" }));
    // The Time line should not end with "| " followed by a location
    const timeLine = result.split("\n").find((l) => l.startsWith("Time:")) ?? "";
    expect(timeLine).not.toMatch(/\| \S/);
  });

  test("includes reorientation note when reorientation_needed=true", () => {
    const ctx = makeCtx({ reorientation_needed: true, gap_type: "long_break" });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("reorient");
  });

  test("does not include reorientation note when reorientation_needed=false", () => {
    const ctx = makeCtx({ reorientation_needed: false, gap_type: "continuous" });
    const result = formatTemporalContext(ctx);
    expect(result).not.toContain("reorient");
  });

  test("sleep gap type emits human-slept message", () => {
    const ctx = makeCtx({ gap_type: "sleep", reorientation_needed: true });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("slept");
  });

  test("days gap type emits world-may-have-changed message", () => {
    const ctx = makeCtx({ gap_type: "days", reorientation_needed: true });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("Verify assumptions");
  });

  test("weeks gap type emits full context reset message", () => {
    const ctx = makeCtx({ gap_type: "weeks", reorientation_needed: true });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("context reset");
  });

  test("continuous gap type emits same-thought-stream message", () => {
    const ctx = makeCtx({ gap_type: "continuous", reorientation_needed: false });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("Continuous session");
  });

  test("late_night work context emits keep-responses-tight message", () => {
    const ctx = makeCtx({ work_context: "late_night" });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("Late night session");
  });

  test("after_hours work context emits personal-time message", () => {
    const ctx = makeCtx({ work_context: "after_hours" });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("After hours");
  });

  test("work_hours context emits no late-night message", () => {
    const ctx = makeCtx({ work_context: "work_hours" });
    const result = formatTemporalContext(ctx);
    expect(result).not.toContain("Late night");
    expect(result).not.toContain("After hours");
  });

  test("hour is zero-padded in output", () => {
    const ctx = makeCtx({ hour: 7 });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("07:");
  });
});
