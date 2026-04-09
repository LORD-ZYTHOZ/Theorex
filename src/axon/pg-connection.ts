// src/axon/pg-connection.ts — Shared Postgres connection pool for all Theorex stores.
// Single singleton — postgres-store, spans/store, and compressed-search all import from here.

let _sql: ReturnType<typeof Bun.sql> | null = null;

export function getDb(): ReturnType<typeof Bun.sql> {
  if (!_sql) {
    _sql = new Bun.SQL({
      host: process.env.THEOREX_PG_HOST || "100.95.91.32",
      port: Number(process.env.THEOREX_PG_PORT || 5432),
      user: process.env.THEOREX_PG_USER || "claw",
      database: process.env.THEOREX_PG_DB || "theorex",
      max: 5,
    });
  }
  return _sql;
}

/** Reset for test isolation. */
export function resetDb(): void {
  _sql = null;
}
