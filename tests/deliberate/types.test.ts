// tests/deliberate/types.test.ts — Verify deliberation channel types compile and construct correctly.

import { describe, test, expect } from "bun:test";
import type {
  TradingSession,
  DeliberationStatus,
  SingularityReport,
  DivergentReport,
  HorizonReport,
  PerspectiveReport,
  SessionPacket,
  DeliberationRecord,
} from "../../src/deliberate/types";

describe("deliberation types", () => {
  test("TradingSession values are valid string literals", () => {
    const sessions: TradingSession[] = ["asian", "london", "new_york", "off_hours"];
    expect(sessions).toHaveLength(4);
    expect(sessions).toContain("asian");
  });

  test("DeliberationStatus values are valid string literals", () => {
    const statuses: DeliberationStatus[] = ["pending", "in_progress", "complete", "error"];
    expect(statuses).toHaveLength(4);
  });

  test("SingularityReport constructs with required fields", () => {
    const report: SingularityReport = {
      source: "singularity",
      total_trades: 5,
      winning_trades: 3,
      losing_trades: 2,
      total_pnl: 120.50,
      win_rate: 0.6,
      avg_hold_time_ms: 45000,
      largest_win: 80.0,
      largest_loss: -30.0,
      session_trades: [],
    };
    expect(report.source).toBe("singularity");
    expect(report.win_rate).toBe(0.6);
  });

  test("DivergentReport constructs with required fields", () => {
    const report: DivergentReport = {
      source: "divergent",
      signal_count: 10,
      agreement_rate: 0.8,
      signals: [],
    };
    expect(report.source).toBe("divergent");
  });

  test("HorizonReport constructs with required fields", () => {
    const report: HorizonReport = {
      source: "horizon",
      active_positions: 2,
      total_exposure: 5000,
      unrealized_pnl: 150.0,
      positions: [],
    };
    expect(report.source).toBe("horizon");
  });

  test("PerspectiveReport is a union of all report types", () => {
    const reports: PerspectiveReport[] = [
      { source: "singularity", total_trades: 0, winning_trades: 0, losing_trades: 0, total_pnl: 0, win_rate: 0, avg_hold_time_ms: 0, largest_win: 0, largest_loss: 0, session_trades: [] },
      { source: "divergent", signal_count: 0, agreement_rate: 0, signals: [] },
      { source: "horizon", active_positions: 0, total_exposure: 0, unrealized_pnl: 0, positions: [] },
    ];
    expect(reports).toHaveLength(3);
  });

  test("SessionPacket assembles perspectives into a packet", () => {
    const packet: SessionPacket = {
      date: "2026-03-24",
      session: "london",
      perspectives: [],
      assembled_at: new Date().toISOString(),
    };
    expect(packet.session).toBe("london");
    expect(packet.perspectives).toEqual([]);
  });

  test("DeliberationRecord wraps a full deliberation cycle", () => {
    const record: DeliberationRecord = {
      id: crypto.randomUUID(),
      date: "2026-03-24",
      session: "asian",
      status: "complete",
      packet: {
        date: "2026-03-24",
        session: "asian",
        perspectives: [],
        assembled_at: new Date().toISOString(),
      },
      prompt: "Analyze the asian session",
      response: "Session was quiet.",
      model: "qwen3-32b",
      tokens_used: 500,
      latency_ms: 2000,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
    expect(record.status).toBe("complete");
    expect(record.session).toBe("asian");
  });
});
