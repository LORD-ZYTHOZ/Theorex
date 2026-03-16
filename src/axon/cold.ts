// cold.ts — SQLite cold storage for sleeping axon nodes (Phase 9).
// Uses bun:sqlite (synchronous) — zero new infrastructure.
//
// INVARIANTS:
//   - archive_id is unique per archived node
//   - data column stores full JSON-serialized AxonNodeAttrs
//   - Operations are synchronous (bun:sqlite guarantee)

import { Database } from "bun:sqlite";

interface ColdRow {
  data: string;
}

interface CountRow {
  n: number;
}

export class ColdStore {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cold_nodes (
        archive_id TEXT PRIMARY KEY,
        data       TEXT NOT NULL
      )
    `);
  }

  /** Persist full node attrs under the given archive_id. Overwrites if exists. */
  archive(archiveId: string, attrs: object): void {
    this.db
      .prepare("INSERT OR REPLACE INTO cold_nodes (archive_id, data) VALUES (?, ?)")
      .run(archiveId, JSON.stringify(attrs));
  }

  /** Retrieve archived attrs by archive_id. Returns null if not found. */
  restore(archiveId: string): object | null {
    const row = this.db
      .prepare("SELECT data FROM cold_nodes WHERE archive_id = ?")
      .get(archiveId) as ColdRow | null;
    return row ? (JSON.parse(row.data) as object) : null;
  }

  /** Remove an archived node (called after successful wake). */
  delete(archiveId: string): void {
    this.db
      .prepare("DELETE FROM cold_nodes WHERE archive_id = ?")
      .run(archiveId);
  }

  /** Total number of sleeping nodes in cold storage. */
  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as n FROM cold_nodes")
      .get() as CountRow;
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
