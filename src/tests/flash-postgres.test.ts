/**
 * Integration test: flash events → Postgres flash_events table.
 * Requires: live Postgres + THEOREX_STORAGE=postgres
 */

import { test, expect, describe, afterAll } from "bun:test";
import { PostgresStore } from "../axon/postgres-store";

const SKIP = process.env.THEOREX_STORAGE !== "postgres";
const AGENT = `test-flash-${Date.now()}`;
const store = new PostgresStore(AGENT);

describe("insertFlashEvents", () => {
  afterAll(async () => {
    if (SKIP) return;
    // Clean up test rows
    const sql = new Bun.SQL({
      host: process.env.THEOREX_PG_HOST || "100.95.91.32",
      port: Number(process.env.THEOREX_PG_PORT || 5432),
      user: process.env.THEOREX_PG_USER || "claw",
      database: process.env.THEOREX_PG_DB || "theorex",
      max: 2,
    });
    await sql`DELETE FROM flash_events WHERE agent = ${AGENT}`;
    await sql.end();
    await store.close();
  });

  test.skipIf(SKIP)("inserts events and returns count", async () => {
    const events = [
      {
        tool_name: "Read",
        tool_input_preview: '{"file_path":"/tmp/test.ts"}',
        tool_response_preview: "const x = 1;",
        timestamp: new Date().toISOString(),
        significance_score: 0.9,
      },
      {
        tool_name: "Edit",
        tool_input_preview: '{"file_path":"/tmp/test.ts"}',
        tool_response_preview: "File updated",
        timestamp: new Date().toISOString(),
        significance_score: 0.7,
      },
    ];

    const count = await store.insertFlashEvents(events);
    expect(count).toBe(2);
  });

  test.skipIf(SKIP)("returns 0 for empty array", async () => {
    const count = await store.insertFlashEvents([]);
    expect(count).toBe(0);
  });

  test.skipIf(SKIP)("persists payload as JSONB", async () => {
    const ts = new Date().toISOString();
    await store.insertFlashEvents([
      {
        tool_name: "Bash",
        tool_input_preview: '{"command":"ls"}',
        tool_response_preview: "file1.ts\nfile2.ts",
        timestamp: ts,
        significance_score: 0.85,
      },
    ]);

    const sql = new Bun.SQL({
      host: process.env.THEOREX_PG_HOST || "100.95.91.32",
      port: Number(process.env.THEOREX_PG_PORT || 5432),
      user: process.env.THEOREX_PG_USER || "claw",
      database: process.env.THEOREX_PG_DB || "theorex",
      max: 2,
    });

    const rows = await sql`
      SELECT event_type, agent, payload
      FROM flash_events
      WHERE agent = ${AGENT} AND event_type = 'Bash'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    await sql.end();

    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe("Bash");
    expect(rows[0].agent).toBe(AGENT);
    const payload = typeof rows[0].payload === "string"
      ? JSON.parse(rows[0].payload)
      : rows[0].payload;
    expect(payload.significance_score).toBe(0.85);
  });
});
