/**
 * Integration tests: outcomes pipeline — write + read + summary.
 * Requires: live Postgres (10.10.0.2:5432, db=theorex)
 */

import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { resetDb } from "../axon/pg-connection";
import {
  write_trade_outcome,
  upsert_trade_outcome,
  get_outcomes_by_agent,
  get_outcomes_summary,
} from "../axon/outcomes";

const SKIP = true; // requires live Postgres — set SKIP=false to run

const TEST_AGENT = `test-outcomes-${Date.now()}`;
const TEST_TRADE_BASE = `test-trade-${Date.now()}`;

const FAKE_OUTCOMES = [
  {
    trade_id: `${TEST_TRADE_BASE}-1`,
    agent: TEST_AGENT,
    direction: "long" as const,
    entry_price: 1950.5,
    exit_price: 1962.3,
    pnl: 1180.0,
    meta: { symbol: "XAUUSD", timeframe: "H1" },
  },
  {
    trade_id: `${TEST_TRADE_BASE}-2`,
    agent: TEST_AGENT,
    direction: "short" as const,
    entry_price: 1965.0,
    exit_price: 1958.1,
    pnl: 690.0,
    meta: { symbol: "XAUUSD", timeframe: "H1" },
  },
  {
    trade_id: `${TEST_TRADE_BASE}-3`,
    agent: TEST_AGENT,
    direction: "long" as const,
    entry_price: 1960.0,
    exit_price: 1955.2,
    pnl: -480.0,
    meta: { symbol: "XAUUSD", timeframe: "H4" },
  },
];

describe("outcomes pipeline", () => {
  beforeAll(() => {
    if (SKIP) return;
    resetDb();
  });

  afterAll(async () => {
    if (SKIP) return;
    // Clean up test rows
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    await sql`DELETE FROM outcomes WHERE agent = ${TEST_AGENT}`;
  });

  test.skipIf(SKIP)("write_trade_outcome inserts a row", async () => {
    await write_trade_outcome(FAKE_OUTCOMES[0]);
    const rows = await get_outcomes_by_agent(TEST_AGENT, 10);
    const found = rows.find((r) => r.trade_id === FAKE_OUTCOMES[0].trade_id);
    expect(found).toBeDefined();
    expect(found!.pnl).toBeCloseTo(1180.0);
  });

  test.skipIf(SKIP)("upsert_trade_outcome updates existing row", async () => {
    // First write
    await upsert_trade_outcome({ ...FAKE_OUTCOMES[1], pnl: 100.0 });
    // Upsert with new pnl
    await upsert_trade_outcome({ ...FAKE_OUTCOMES[1], pnl: 690.0 });
    const rows = await get_outcomes_by_agent(TEST_AGENT, 10);
    const found = rows.find((r) => r.trade_id === FAKE_OUTCOMES[1].trade_id);
    expect(found).toBeDefined();
    expect(found!.pnl).toBeCloseTo(690.0);
  });

  test.skipIf(SKIP)("get_outcomes_by_agent returns ordered results", async () => {
    await write_trade_outcome(FAKE_OUTCOMES[2]);
    const rows = await get_outcomes_by_agent(TEST_AGENT, 5);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Most recent first
    expect(rows[0].trade_id).toBe(FAKE_OUTCOMES[2].trade_id);
  });

  test.skipIf(SKIP)("get_outcomes_summary aggregates correctly", async () => {
    const summary = await get_outcomes_summary();
    const agentRow = summary.find((s) => s.agent === TEST_AGENT);
    expect(agentRow).toBeDefined();
    expect(agentRow!.total_trades).toBeGreaterThanOrEqual(3);
    expect(agentRow!.win_count).toBeGreaterThanOrEqual(2);
    expect(agentRow!.loss_count).toBeGreaterThanOrEqual(1);
    expect(agentRow!.win_rate).toBeGreaterThan(0);
  });
});