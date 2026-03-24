// src/web/state.ts — TheronexusState: SQLite-backed living graph state
import { Database } from "bun:sqlite";
import { join } from "node:path";

const DB_PATH = join(import.meta.dir, "../../data/theronexus-state.db");

export interface NodeState {
  readonly symbolId: string;
  readonly name: string;
  familiarity: number;      // 0–1, how often this node has been touched
  tension: number;          // 0–1, composite risk score
  activationCount: number;  // lifetime activations
  queryCount: number;       // times appeared in query results
  gitChurn: number;         // commits touching this file in last 30 days
  todoCount: number;        // TODO/FIXME count in file
  lastActive: string | null;
  churnComputedAt: string | null;
}

export interface EdgeState {
  readonly sourceId: string;
  readonly targetId: string;
  weight: number;           // starts at 1.0, grows with traversals
  traversalCount: number;
  lastTraversed: string | null;
}

export class TheronexusState {
  private db: Database;

  constructor() {
    this.db = new Database(DB_PATH, { create: true });
    this.init();
  }

  private init(): void {
    this.db.run(`CREATE TABLE IF NOT EXISTS node_state (
      symbol_id TEXT PRIMARY KEY,
      name TEXT,
      familiarity REAL DEFAULT 0,
      tension REAL DEFAULT 0,
      activation_count INTEGER DEFAULT 0,
      query_count INTEGER DEFAULT 0,
      git_churn INTEGER DEFAULT 0,
      todo_count INTEGER DEFAULT 0,
      last_active TEXT,
      churn_computed_at TEXT
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS edge_state (
      source_id TEXT,
      target_id TEXT,
      weight REAL DEFAULT 1.0,
      traversal_count INTEGER DEFAULT 0,
      last_traversed TEXT,
      PRIMARY KEY (source_id, target_id)
    )`);
  }

  // Record that a symbol was touched (query result, context pull, impact)
  // delta: 0.05 for query mention, 0.10 for context pull, 0.15 for impact
  touchNode(symbolId: string, name: string, delta: number): void {
    const now = new Date().toISOString();
    this.db.run(`INSERT INTO node_state (symbol_id, name, familiarity, activation_count, query_count, last_active)
      VALUES (?, ?, ?, 1, 1, ?)
      ON CONFLICT(symbol_id) DO UPDATE SET
        familiarity = MIN(1.0, familiarity + ?),
        activation_count = activation_count + 1,
        query_count = query_count + 1,
        last_active = ?,
        name = ?`,
      [symbolId, name, Math.min(1.0, delta), now, delta, now, name]
    );
    this.recomputeTension(symbolId);
  }

  // Strengthen an edge (Hebbian learning)
  strengthenEdge(sourceId: string, targetId: string): void {
    const now = new Date().toISOString();
    this.db.run(`INSERT INTO edge_state (source_id, target_id, weight, traversal_count, last_traversed)
      VALUES (?, ?, 1.0, 1, ?)
      ON CONFLICT(source_id, target_id) DO UPDATE SET
        traversal_count = traversal_count + 1,
        weight = MIN(3.0, 1.0 + LOG(1 + traversal_count + 1) * 0.5),
        last_traversed = ?`,
      [sourceId, targetId, now, now]
    );
  }

  // Update git churn + TODO count for a file path
  updateChurn(symbolId: string, gitChurn: number, todoCount: number): void {
    this.db.run(`INSERT INTO node_state (symbol_id, name, git_churn, todo_count, churn_computed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(symbol_id) DO UPDATE SET
        git_churn = ?,
        todo_count = ?,
        churn_computed_at = ?`,
      [symbolId, symbolId, gitChurn, todoCount, new Date().toISOString(),
       gitChurn, todoCount, new Date().toISOString()]
    );
    this.recomputeTension(symbolId);
  }

  private recomputeTension(symbolId: string): void {
    const row = this.db.query(`SELECT git_churn, todo_count, activation_count, query_count FROM node_state WHERE symbol_id = ?`).get(symbolId) as any;
    if (!row) return;
    const churnScore = Math.min(1, (row.git_churn ?? 0) / 20);
    const todoScore = Math.min(1, (row.todo_count ?? 0) / 10);
    const activationScore = Math.min(1, (row.activation_count ?? 0) / 50);
    const queryScore = Math.min(1, (row.query_count ?? 0) / 20);
    const tension = churnScore * 0.35 + todoScore * 0.25 + activationScore * 0.25 + queryScore * 0.15;
    this.db.run(`UPDATE node_state SET tension = ? WHERE symbol_id = ?`, [tension, symbolId]);
  }

  // Get all node states as a map
  getAllNodeStates(): Map<string, NodeState> {
    const rows = this.db.query(`SELECT * FROM node_state`).all() as any[];
    const map = new Map<string, NodeState>();
    for (const r of rows) {
      map.set(r.symbol_id, {
        symbolId: r.symbol_id,
        name: r.name,
        familiarity: r.familiarity ?? 0,
        tension: r.tension ?? 0,
        activationCount: r.activation_count ?? 0,
        queryCount: r.query_count ?? 0,
        gitChurn: r.git_churn ?? 0,
        todoCount: r.todo_count ?? 0,
        lastActive: r.last_active,
        churnComputedAt: r.churn_computed_at,
      });
    }
    return map;
  }

  // Get all edge weights
  getAllEdgeWeights(): Map<string, number> {
    const rows = this.db.query(`SELECT source_id, target_id, weight FROM edge_state`).all() as any[];
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(`${r.source_id}|${r.target_id}`, r.weight ?? 1.0);
    }
    return map;
  }

  close(): void { this.db.close(); }
}

// Singleton
let _state: TheronexusState | null = null;
export function getState(): TheronexusState {
  if (!_state) _state = new TheronexusState();
  return _state;
}
