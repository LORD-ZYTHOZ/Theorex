// tests/deliberate/telegram.test.ts — Tests for Telegram summary formatter.

import { test, expect, describe } from "bun:test";
import { formatTelegramSummary } from "../../src/deliberate/telegram";
import type {
  DeliberationRecord,
  SingularityReport,
  DivergentReport,
  HorizonReport,
  SessionPacket,
} from "../../src/deliberate/types";

// ---------------------------------------------------------------------------
// Helpers: build test fixtures immutably
// ---------------------------------------------------------------------------

function makeSingularityReport(overrides?: Partial<Omit<SingularityReport, "source">>): SingularityReport {
  return {
    source: "singularity",
    total_trades: 4,
    winning_trades: 3,
    losing_trades: 1,
    total_pnl: 2.4,
    win_rate: 0.75,
    avg_hold_time_ms: 30000,
    largest_win: 1.2,
    largest_loss: -0.5,
    session_trades: [],
    ...overrides,
  };
}

function makeDivergentReport(overrides?: Partial<Omit<DivergentReport, "source">>): DivergentReport {
  return {
    source: "divergent",
    signal_count: 5,
    agreement_rate: 0.8,
    signals: [],
    ...overrides,
  };
}

function makeHorizonReport(overrides?: Partial<Omit<HorizonReport, "source">>): HorizonReport {
  return {
    source: "horizon",
    active_positions: 2,
    total_exposure: 5000,
    unrealized_pnl: 150,
    positions: [],
    ...overrides,
  };
}

function makePacket(perspectives: readonly (SingularityReport | DivergentReport | HorizonReport)[]): SessionPacket {
  return {
    date: "2026-03-24",
    session: "london",
    perspectives,
    assembled_at: "2026-03-24T12:00:00.000Z",
  };
}

function makeRecord(overrides?: Partial<DeliberationRecord>): DeliberationRecord {
  const packet = makePacket([
    makeSingularityReport(),
    makeDivergentReport(),
    makeHorizonReport(),
  ]);
  return {
    id: "rec-001",
    date: "2026-03-24",
    session: "london",
    status: "complete",
    packet,
    prompt: "Analyze session performance.",
    response: "All good.",
    model: "qwen3-32b",
    tokens_used: 1200,
    latency_ms: 3400,
    created_at: "2026-03-24T12:00:00.000Z",
    completed_at: "2026-03-24T12:01:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("formatTelegramSummary", () => {
  test("complete record with all 3 perspectives", () => {
    const record = makeRecord();
    const result = formatTelegramSummary(record);

    // Header
    expect(result).toContain("london Debrief");
    expect(result).toContain("2026-03-24");

    // Singularity section
    expect(result).toContain("Singularity");
    expect(result).toContain("3W / 1L");
    expect(result).toContain("+2.4");

    // Divergent section
    expect(result).toContain("Divergent");
    expect(result).toContain("5 signals");
    expect(result).toContain("80%");

    // Horizon section
    expect(result).toContain("Horizon");
    expect(result).toContain("2 positions");
    expect(result).toContain("+150");

    // Footer
    expect(result).toContain("complete");
    expect(result).toContain("qwen3-32b");
  });

  test("partial record with only singularity perspective", () => {
    const record = makeRecord({
      packet: makePacket([makeSingularityReport()]),
    });
    const result = formatTelegramSummary(record);

    expect(result).toContain("Singularity");
    expect(result).not.toContain("Divergent");
    expect(result).not.toContain("Horizon");
  });

  test("partial record with no perspectives", () => {
    const record = makeRecord({
      packet: makePacket([]),
    });
    const result = formatTelegramSummary(record);

    // Should still have header and footer
    expect(result).toContain("london Debrief");
    expect(result).toContain("qwen3-32b");
    expect(result).not.toContain("Singularity");
    expect(result).not.toContain("Divergent");
    expect(result).not.toContain("Horizon");
  });

  test("error status record shows error indicator and message", () => {
    const record = makeRecord({
      status: "error",
      error: "LLM timeout after 30s",
      response: undefined,
      completed_at: undefined,
    });
    const result = formatTelegramSummary(record);

    expect(result).toContain("error");
    expect(result).toContain("LLM timeout after 30s");
  });

  test("in_progress status record", () => {
    const record = makeRecord({
      status: "in_progress",
      response: undefined,
      completed_at: undefined,
    });
    const result = formatTelegramSummary(record);

    expect(result).toContain("in_progress");
  });

  test("negative P&L formatted with minus sign", () => {
    const record = makeRecord({
      packet: makePacket([makeSingularityReport({ total_pnl: -3.7 })]),
    });
    const result = formatTelegramSummary(record);

    expect(result).toContain("-3.7");
  });

  test("negative unrealized P&L in horizon", () => {
    const record = makeRecord({
      packet: makePacket([makeHorizonReport({ unrealized_pnl: -200 })]),
    });
    const result = formatTelegramSummary(record);

    expect(result).toContain("-200");
  });

  test("agreement rate displayed as percentage", () => {
    const record = makeRecord({
      packet: makePacket([makeDivergentReport({ agreement_rate: 0.923 })]),
    });
    const result = formatTelegramSummary(record);

    expect(result).toContain("92%");
  });

  test("output is under 4096 characters (Telegram limit)", () => {
    const record = makeRecord();
    const result = formatTelegramSummary(record);

    expect(result.length).toBeLessThan(4096);
  });

  test("output is under 4096 even with long error message", () => {
    const record = makeRecord({
      status: "error",
      error: "A".repeat(5000),
    });
    const result = formatTelegramSummary(record);

    expect(result.length).toBeLessThan(4096);
  });

  test("status emoji: complete uses check mark", () => {
    const record = makeRecord({ status: "complete" });
    const result = formatTelegramSummary(record);
    expect(result).toMatch(/✅/);
  });

  test("status emoji: error uses cross mark", () => {
    const record = makeRecord({ status: "error", error: "fail" });
    const result = formatTelegramSummary(record);
    expect(result).toMatch(/❌/);
  });

  test("status emoji: in_progress uses warning", () => {
    const record = makeRecord({ status: "in_progress" });
    const result = formatTelegramSummary(record);
    expect(result).toMatch(/⚠️/);
  });
});
