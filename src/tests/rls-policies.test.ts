/**
 * Integration tests for Row-Level Security policies.
 * Requires: RLS migration applied (bun scripts/apply-rls.ts).
 * Connects to real Postgres — skipped if THEOREX_STORAGE !== 'postgres'.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const SKIP = process.env.THEOREX_STORAGE !== "postgres";

function getTestDb() {
  return new Bun.SQL({
    host: process.env.THEOREX_PG_HOST || "100.95.91.32",
    port: Number(process.env.THEOREX_PG_PORT || 5432),
    user: process.env.THEOREX_PG_USER || "claw",
    database: process.env.THEOREX_PG_DB || "theorex",
    max: 3,
  });
}

// Unique labels so parallel runs don't collide
const RUN_ID = `rls_test_${Date.now()}`;
const ALPHA_LABEL = `${RUN_ID}_alpha`;
const BETA_LABEL = `${RUN_ID}_beta`;

describe("RLS policies", () => {
  let sql: ReturnType<typeof Bun.SQL>;

  beforeAll(async () => {
    if (SKIP) return;
    sql = getTestDb();

    // Insert test rows without agent context (admin bypass)
    await sql`
      INSERT INTO concepts (label, memory_type, agent_id, meta)
      VALUES (${ALPHA_LABEL}, 'fact'::memory_type, ${"alpha"}, '{}')
      ON CONFLICT (label, agent_id) DO NOTHING
    `;
    await sql`
      INSERT INTO concepts (label, memory_type, agent_id, meta)
      VALUES (${BETA_LABEL}, 'fact'::memory_type, ${"beta"}, '{}')
      ON CONFLICT (label, agent_id) DO NOTHING
    `;
  });

  afterAll(async () => {
    if (SKIP) return;
    // Clean up test rows (no agent context = admin bypass)
    await sql`DELETE FROM concepts WHERE label IN (${ALPHA_LABEL}, ${BETA_LABEL})`;
    await sql.end();
  });

  test.skipIf(SKIP)("admin (no context) can read all rows", async () => {
    const rows = await sql`
      SELECT label, agent_id FROM concepts
      WHERE label IN (${ALPHA_LABEL}, ${BETA_LABEL})
      ORDER BY label
    `;
    expect(rows.length).toBe(2);
    const agents = rows.map((r: Record<string, unknown>) => r.agent_id).sort();
    expect(agents).toEqual(["alpha", "beta"]);
  });

  test.skipIf(SKIP)("agent alpha sees only its own concepts", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE theorex_app");
      await tx`SELECT set_config('theorex.current_agent_id', 'alpha', true)`;
      return tx`
        SELECT label, agent_id FROM concepts
        WHERE label IN (${ALPHA_LABEL}, ${BETA_LABEL})
      `;
    });

    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe(ALPHA_LABEL);
    expect(rows[0].agent_id).toBe("alpha");
  });

  test.skipIf(SKIP)("agent alpha cannot read beta concepts", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE theorex_app");
      await tx`SELECT set_config('theorex.current_agent_id', 'alpha', true)`;
      return tx`
        SELECT label FROM concepts
        WHERE label = ${BETA_LABEL}
      `;
    });

    expect(rows.length).toBe(0);
  });

  test.skipIf(SKIP)("agent beta sees only its own concepts", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE theorex_app");
      await tx`SELECT set_config('theorex.current_agent_id', 'beta', true)`;
      return tx`
        SELECT label, agent_id FROM concepts
        WHERE label IN (${ALPHA_LABEL}, ${BETA_LABEL})
      `;
    });

    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe(BETA_LABEL);
    expect(rows[0].agent_id).toBe("beta");
  });
});
