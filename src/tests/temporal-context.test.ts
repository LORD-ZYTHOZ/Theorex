// tests/temporal-context.test.ts — Tests for src/temporal/context.ts pure helpers.
// buildTemporalContext is I/O-heavy (reads/writes temporal store) — tested via
// the exported pure classification functions. formatTemporalContext is pure and fully testable.

import { describe, test, expect } from "bun:test";
import {
  formatTemporalContext,
  computeMarketSessions,
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
    market_sessions: [],
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

  // Market session lines in format output
  test("shows open market session with closes_in_min", () => {
    const ctx = makeCtx({
      market_sessions: [{
        name: "london",
        label: "London",
        status: "open",
        opens_in_min: null,
        closes_in_min: 120,
      }],
    });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("London");
    expect(result).toContain("Markets:");
    expect(result).toContain("120m");
  });

  test("shows upcoming session with opens_in_min", () => {
    const ctx = makeCtx({
      market_sessions: [{
        name: "new_york",
        label: "New York",
        status: "open",
        opens_in_min: 45,
        closes_in_min: null,
      }],
    });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("New York opens in 45m");
  });

  test("shows OVERLAP tag for overlapping sessions", () => {
    const ctx = makeCtx({
      market_sessions: [
        { name: "london", label: "London", status: "overlap", opens_in_min: null, closes_in_min: 90 },
        { name: "new_york", label: "New York", status: "overlap", opens_in_min: null, closes_in_min: 300 },
      ],
    });
    const result = formatTemporalContext(ctx);
    expect(result).toContain("[OVERLAP]");
  });

  test("omits Markets line when no sessions active or upcoming", () => {
    const ctx = makeCtx({ market_sessions: [] });
    const result = formatTemporalContext(ctx);
    expect(result).not.toContain("Markets:");
  });
});

// ---------------------------------------------------------------------------
// computeMarketSessions — pure function, fully testable by UTC hour
// ---------------------------------------------------------------------------

describe("computeMarketSessions()", () => {
  test("London is open at 10:00 UTC", () => {
    const sessions = computeMarketSessions(10, 0);
    const london = sessions.find(s => s.name === "london");
    expect(london).toBeDefined();
    expect(london!.opens_in_min).toBeNull(); // already open
    expect(london!.closes_in_min).not.toBeNull();
  });

  test("New York is open at 15:00 UTC", () => {
    const sessions = computeMarketSessions(15, 0);
    const ny = sessions.find(s => s.name === "new_york");
    expect(ny).toBeDefined();
    expect(ny!.opens_in_min).toBeNull();
  });

  test("London/NY overlap at 14:00 UTC — both open, status=overlap", () => {
    const sessions = computeMarketSessions(14, 0);
    const london = sessions.find(s => s.name === "london");
    const ny = sessions.find(s => s.name === "new_york");
    expect(london).toBeDefined();
    expect(ny).toBeDefined();
    expect(london!.status).toBe("overlap");
    expect(ny!.status).toBe("overlap");
  });

  test("Sydney wraps midnight — open at 23:00 UTC", () => {
    const sessions = computeMarketSessions(23, 0);
    const sydney = sessions.find(s => s.name === "sydney");
    expect(sydney).toBeDefined();
    expect(sydney!.opens_in_min).toBeNull(); // open
  });

  test("Sydney open at 02:00 UTC (after midnight)", () => {
    const sessions = computeMarketSessions(2, 0);
    const sydney = sessions.find(s => s.name === "sydney");
    expect(sydney).toBeDefined();
    expect(sydney!.opens_in_min).toBeNull();
  });

  test("Tokyo open at 03:00 UTC", () => {
    const sessions = computeMarketSessions(3, 0);
    const tokyo = sessions.find(s => s.name === "tokyo");
    expect(tokyo).toBeDefined();
    expect(tokyo!.opens_in_min).toBeNull();
  });

  test("New York is open at 20:00 UTC (closes at 22:00)", () => {
    // 20:00 UTC: London closed (17:00), NY open until 22:00
    const sessions = computeMarketSessions(20, 0);
    const ny = sessions.find(s => s.name === "new_york");
    expect(ny).toBeDefined();
    expect(ny!.opens_in_min).toBeNull(); // already open
    // London and Tokyo are closed and not within 2h window
    const london = sessions.find(s => s.name === "london");
    expect(london).toBeUndefined();
  });

  test("upcoming session shown when opening within 2h", () => {
    // Sydney opens at 22:00 UTC. At 20:30 UTC that's 1h30m away = within 2h
    const sessions = computeMarketSessions(20, 30);
    const sydney = sessions.find(s => s.name === "sydney");
    expect(sydney).toBeDefined();
    expect(sydney!.opens_in_min).not.toBeNull();
    expect(sydney!.opens_in_min).toBeLessThanOrEqual(120);
  });

  test("session not shown when more than 2h away", () => {
    // London opens at 08:00 UTC. At 03:00 UTC that's 5h away — not shown
    const sessions = computeMarketSessions(3, 0);
    const london = sessions.find(s => s.name === "london");
    expect(london).toBeUndefined();
  });

  test("closes_in_min is positive when session is open", () => {
    const sessions = computeMarketSessions(10, 0);
    for (const s of sessions.filter(s => s.opens_in_min === null)) {
      expect(s.closes_in_min).toBeGreaterThan(0);
    }
  });
});
