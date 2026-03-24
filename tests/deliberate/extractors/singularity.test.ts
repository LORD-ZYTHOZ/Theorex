// tests/deliberate/extractors/singularity.test.ts — Singularity report extractor tests.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractSingularityReport } from "../../../src/deliberate/extractors/singularity";
import type { TradingSession } from "../../../src/deliberate/types";

const TMP = join(tmpdir(), "theorex-singularity-test-" + Date.now());
const TRADES_PATH = join(TMP, "latent_trades.jsonl");

// Session windows (UTC): asian 00:00-08:00, london 08:00-16:00,
// new_york 13:00-21:00, off_hours 21:00-00:00

const SAMPLE_TRADES = [
  // Asian session trade (03:00 UTC)
  { id: "t1", symbol: "XAUUSD", side: "buy", entry_price: 2000, exit_price: 2010, pnl: 100, entry_time: "2026-03-24T03:00:00Z", exit_time: "2026-03-24T03:30:00Z", hold_time_ms: 1800000, strategy: "momentum" },
  // London session trade (09:00 UTC)
  { id: "t2", symbol: "XAUUSD", side: "sell", entry_price: 2020, exit_price: 2015, pnl: 50, entry_time: "2026-03-24T09:00:00Z", exit_time: "2026-03-24T09:45:00Z", hold_time_ms: 2700000, strategy: "mean_revert" },
  // London session losing trade (10:00 UTC)
  { id: "t3", symbol: "XAUUSD", side: "buy", entry_price: 2030, exit_price: 2020, pnl: -100, entry_time: "2026-03-24T10:00:00Z", exit_time: "2026-03-24T10:15:00Z", hold_time_ms: 900000 },
  // Different date (should be excluded)
  { id: "t4", symbol: "XAUUSD", side: "buy", entry_price: 2000, exit_price: 2005, pnl: 50, entry_time: "2026-03-23T09:00:00Z", exit_time: "2026-03-23T09:30:00Z", hold_time_ms: 1800000 },
];

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
  const lines = SAMPLE_TRADES.map((t) => JSON.stringify(t)).join("\n") + "\n";
  await Bun.write(TRADES_PATH, lines);
});

afterAll(() => rm(TMP, { recursive: true, force: true }));

describe("extractSingularityReport", () => {
  test("filters trades by date and asian session window", async () => {
    const report = await extractSingularityReport(TRADES_PATH, "asian", "2026-03-24");
    expect(report.source).toBe("singularity");
    expect(report.total_trades).toBe(1);
    expect(report.winning_trades).toBe(1);
    expect(report.losing_trades).toBe(0);
    expect(report.total_pnl).toBe(100);
    expect(report.win_rate).toBe(1.0);
    expect(report.session_trades).toHaveLength(1);
    expect(report.session_trades[0]!.id).toBe("t1");
  });

  test("filters trades by date and london session window", async () => {
    const report = await extractSingularityReport(TRADES_PATH, "london", "2026-03-24");
    expect(report.total_trades).toBe(2);
    expect(report.winning_trades).toBe(1);
    expect(report.losing_trades).toBe(1);
    expect(report.total_pnl).toBe(-50);
    expect(report.win_rate).toBe(0.5);
    expect(report.largest_win).toBe(50);
    expect(report.largest_loss).toBe(-100);
  });

  test("returns zero report when no trades match", async () => {
    const report = await extractSingularityReport(TRADES_PATH, "off_hours", "2026-03-24");
    expect(report.total_trades).toBe(0);
    expect(report.win_rate).toBe(0);
    expect(report.total_pnl).toBe(0);
    expect(report.session_trades).toHaveLength(0);
  });

  test("excludes trades from different dates", async () => {
    const report = await extractSingularityReport(TRADES_PATH, "london", "2026-03-23");
    expect(report.total_trades).toBe(1);
    expect(report.session_trades[0]!.id).toBe("t4");
  });

  test("returns zero report for non-existent file", async () => {
    const report = await extractSingularityReport(join(TMP, "nope.jsonl"), "asian", "2026-03-24");
    expect(report.total_trades).toBe(0);
    expect(report.source).toBe("singularity");
  });

  test("computes avg_hold_time_ms correctly", async () => {
    const report = await extractSingularityReport(TRADES_PATH, "london", "2026-03-24");
    // t2: 2700000, t3: 900000 => avg = 1800000
    expect(report.avg_hold_time_ms).toBe(1800000);
  });
});
