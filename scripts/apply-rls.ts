/**
 * apply-rls.ts — Idempotent script to enable Row-Level Security on
 * agent-scoped Theorex tables.
 *
 * Tables with RLS:
 *   concepts, profiles, agent_tasks  (column: agent_id)
 *   session_summaries               (column: agent)
 *
 * Policy design:
 *   - admin_bypass: full access when no agent context is set (migrations, admin)
 *   - agent_isolation: restrict rows to current_setting('theorex.current_agent_id')
 *
 * Usage: bun scripts/apply-rls.ts
 */

interface RlsTarget {
  readonly table: string;
  readonly column: string; // the agent identifier column
}

const RLS_TARGETS: readonly RlsTarget[] = [
  { table: "concepts", column: "agent_id" },
  { table: "profiles", column: "agent_id" },
  { table: "agent_tasks", column: "agent_id" },
  { table: "session_summaries", column: "agent" },
] as const;

async function applyRls(): Promise<void> {
  const sql = new Bun.SQL({
    host: process.env.THEOREX_PG_HOST || "100.95.91.32",
    port: Number(process.env.THEOREX_PG_PORT || 5432),
    user: process.env.THEOREX_PG_USER || "claw",
    database: process.env.THEOREX_PG_DB || "theorex",
    max: 2,
  });

  try {
    // Create non-superuser app role (superusers bypass RLS)
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'theorex_app') THEN
          CREATE ROLE theorex_app LOGIN;
        END IF;
      END $$
    `);
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO theorex_app");
    await sql.unsafe("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO theorex_app");
    await sql.unsafe("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO theorex_app");
    await sql.unsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO theorex_app");
    await sql.unsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO theorex_app");
    await sql.unsafe("GRANT theorex_app TO claw");
    console.log("[rls] theorex_app role ready (non-superuser for RLS enforcement)");

    for (const target of RLS_TARGETS) {
      console.log(`[rls] Applying RLS to ${target.table} (column: ${target.column})`);

      // Enable RLS (idempotent — no-op if already enabled)
      await sql.unsafe(`ALTER TABLE ${target.table} ENABLE ROW LEVEL SECURITY`);
      await sql.unsafe(`ALTER TABLE ${target.table} FORCE ROW LEVEL SECURITY`);

      // Drop existing policies to make re-runs safe
      await sql.unsafe(`DROP POLICY IF EXISTS admin_bypass ON ${target.table}`);
      await sql.unsafe(`DROP POLICY IF EXISTS agent_isolation ON ${target.table}`);

      // Admin bypass: when no agent context is set, allow full access
      await sql.unsafe(`
        CREATE POLICY admin_bypass ON ${target.table}
          FOR ALL
          USING (
            current_setting('theorex.current_agent_id', true) IS NULL
            OR current_setting('theorex.current_agent_id', true) = ''
          )
      `);

      // Agent isolation: restrict to rows matching the session variable
      await sql.unsafe(`
        CREATE POLICY agent_isolation ON ${target.table}
          FOR ALL
          USING (${target.column} = current_setting('theorex.current_agent_id', true))
          WITH CHECK (${target.column} = current_setting('theorex.current_agent_id', true))
      `);

      console.log(`[rls] ✓ ${target.table} — policies applied`);
    }

    console.log("\n[rls] All RLS policies applied successfully.");
  } finally {
    await sql.end();
  }
}

applyRls().catch((err) => {
  console.error("[rls] FAILED:", err);
  process.exit(1);
});
