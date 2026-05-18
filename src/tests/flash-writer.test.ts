/**
 * Tests for flash-writer.ts — emit_flash_event and typed helpers.
 * Requires: live Postgres (10.10.0.2:5432, db=theorex)
 */

import { test, expect, describe, afterAll } from "bun:test";
import { resetDb } from "../axon/pg-connection";
import {
  emit_flash_event,
  emit_trade_flash,
  emit_kelly_change_flash,
  emit_approval_flash,
  emit_regime_shift_flash,
} from "../axon/flash-writer";

const SKIP = true; // requires live Postgres — set SKIP=false to run

const TEST_AGENT = `test-flash-${Date.now()}`;

describe("flash-writer", () => {
  afterAll(async () => {
    if (SKIP) return;
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    await sql`DELETE FROM flash_events WHERE agent = ${TEST_AGENT}`;
  });

  test.skipIf(SKIP)("emit_flash_event writes to flash_events table", async () => {
    await emit_flash_event("WIN", { pnl: 500, trade_id: "flash-test-1" }, TEST_AGENT);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe("WIN");
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.pnl).toBe(500);
  });

  test.skipIf(SKIP)("emit_trade_flash fires WIN event for positive pnl", async () => {
    await emit_trade_flash("flash-trade-2", TEST_AGENT, "long", 1200, 1950.0, 1962.0);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0].event_type).toBe("WIN");
    expect((rows[0].payload as Record<string, unknown>).pnl).toBe(1200);
  });

  test.skipIf(SKIP)("emit_trade_flash fires LOSS event for negative pnl", async () => {
    await emit_trade_flash("flash-trade-3", TEST_AGENT, "short", -450, 1960.0, 1955.0);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0].event_type).toBe("LOSS");
    expect((rows[0].payload as Record<string, unknown>).pnl).toBe(-450);
  });

  test.skipIf(SKIP)("emit_trade_flash fires TIMEOUT event for zero pnl", async () => {
    await emit_trade_flash("flash-trade-4", TEST_AGENT, "flat", 0, 1960.0, 1960.0);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0].event_type).toBe("TIMEOUT");
  });

  test.skipIf(SKIP)("emit_kelly_change_flash writes KELLY_CHANGE event", async () => {
    await emit_kelly_change_flash(TEST_AGENT, 0.5, 0.75);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0].event_type).toBe("KELLY_CHANGE");
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.kelly_before).toBe(0.5);
    expect(payload.kelly_after).toBe(0.75);
    expect(payload.delta).toBe(0.25);
  });

  test.skipIf(SKIP)("emit_approval_flash fires APPROVAL event", async () => {
    await emit_approval_flash("buy gold", "price_action_confirmed", true, TEST_AGENT);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0].event_type).toBe("APPROVAL");
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.decision).toBe("buy gold");
    expect(payload.approved).toBe(true);
  });

  test.skipIf(SKIP)("emit_approval_flash fires REJECTION event", async () => {
    await emit_approval_flash("buy silver", "low_volume", false, TEST_AGENT);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0].event_type).toBe("REJECTION");
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.approved).toBe(false);
  });

  test.skipIf(SKIP)("emit_regime_shift_flash writes REGIME_SHIFT event", async () => {
    await emit_regime_shift_flash("high_volatility", TEST_AGENT);
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const rows = await sql`SELECT * FROM flash_events WHERE agent = ${TEST_AGENT} ORDER BY created_at DESC LIMIT 1`;
    expect(rows[0].event_type).toBe("REGIME_SHIFT");
    expect((rows[0].payload as Record<string, unknown>).regime_type).toBe("high_volatility");
  });
});