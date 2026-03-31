/**
 * PostgresStore — Postgres-backed concept store.
 * Drop-in replacement for AxonStore for read/write operations.
 * Uses Bun.sql for native Postgres support.
 *
 * Feature flag: THEOREX_STORAGE=postgres enables this store.
 * Default: file (AxonStore) — set flag to switch.
 */

import type { ConceptEvent } from "../types";
import { embedText } from "../rag/ollama-embedder";

export interface PgConceptRow {
  id: string;
  label: string;
  body: string | null;
  memory_type: string;
  agent_id: string;
  meta: Record<string, unknown>;
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface PgSearchResult extends PgConceptRow {
  score: number;
}

// ---------------------------------------------------------------------------
// Connection (singleton)
// ---------------------------------------------------------------------------

let _sql: ReturnType<typeof Bun.sql> | null = null;

function getDb() {
  if (!_sql) {
    _sql = new Bun.SQL({
      host: process.env.THEOREX_PG_HOST || '100.95.91.32',
      port: Number(process.env.THEOREX_PG_PORT || 5432),
      user: process.env.THEOREX_PG_USER || 'claw',
      database: process.env.THEOREX_PG_DB || 'theorex',
      max: 5,
    });
  }
  return _sql;
}

// ---------------------------------------------------------------------------
// PostgresStore
// ---------------------------------------------------------------------------

export class PostgresStore {
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /**
   * Upsert a concept from a ConceptEvent.
   * Returns the UUID of the inserted/updated concept.
   */
  async mergeNode(event: ConceptEvent, observationType = ""): Promise<string> {
    const sql = getDb();

    const memType = classifyMemoryType(event.surface_form, observationType);
    const meta = {
      concept_id: event.concept_id,
      importance_weight: event.importance_score,
      frequency_count: event.frequency_count,
      source_weight: event.source_weight,
      observation_type: observationType,
      node_type: event.node_type ?? "",
    };

    const rows = await sql`
      INSERT INTO concepts (label, memory_type, agent_id, meta, created_at, updated_at)
      VALUES (
        ${event.surface_form},
        ${memType}::memory_type,
        ${this.agentId},
        ${JSON.stringify(meta)},
        ${event.timestamp},
        ${event.timestamp}
      )
      ON CONFLICT (label, agent_id) DO UPDATE SET
        meta = concepts.meta || jsonb_build_object(
          'importance_weight', ${event.importance_score},
          'frequency_count', (concepts.meta->>'frequency_count')::int + ${event.frequency_count},
          'observation_type', COALESCE(NULLIF(${observationType}, ''), concepts.meta->>'observation_type')
        ),
        updated_at = ${event.timestamp}
      RETURNING id
    `;

    const id = rows[0].id as string;
    this._autoEmbed(id, event.surface_form);
    return id;
  }

  /**
   * Simple upsert — just label + agent, no ConceptEvent needed.
   */
  async upsertConcept(label: string, memoryType = 'fact', body?: string, meta?: Record<string, unknown>): Promise<string> {
    const sql = getDb();

    const rows = await sql`
      INSERT INTO concepts (label, body, memory_type, agent_id, meta)
      VALUES (
        ${label},
        ${body ?? null},
        ${memoryType}::memory_type,
        ${this.agentId},
        ${JSON.stringify(meta ?? {})}
      )
      ON CONFLICT (label, agent_id) DO UPDATE SET
        updated_at = now(),
        body = COALESCE(EXCLUDED.body, concepts.body)
      RETURNING id
    `;

    const id = rows[0].id as string;
    this._autoEmbed(id, label);
    return id;
  }

  /**
   * Upsert a co-occurrence edge between two concept UUIDs.
   */
  async mergeEdge(sourceId: string, targetId: string, relation = 'co-occurrence', weight = 1.0): Promise<void> {
    const sql = getDb();

    await sql`
      INSERT INTO concept_edges (source_id, target_id, relation, weight)
      VALUES (${sourceId}, ${targetId}, ${relation}, ${weight})
      ON CONFLICT DO NOTHING
    `;
  }

  /**
   * Hybrid search: FTS + vector similarity via RRF.
   * Returns top-N concepts ranked by combined score.
   */
  async search(
    queryText: string,
    queryEmbedding?: number[],
    opts: {
      agentFilter?: string;
      typeFilter?: string;
      limit?: number;
      ftsWeight?: number;
      vecWeight?: number;
    } = {}
  ): Promise<PgSearchResult[]> {
    const sql = getDb();
    const { limit = 10, ftsWeight = 0.5, vecWeight = 0.5, agentFilter, typeFilter } = opts;

    if (queryEmbedding) {
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      return await sql`
        SELECT * FROM hybrid_search(
          ${queryText},
          ${embeddingStr}::vector(768),
          ${agentFilter ?? null},
          ${typeFilter ?? null}::memory_type,
          ${limit},
          ${ftsWeight},
          ${vecWeight}
        )
      ` as PgSearchResult[];
    }

    // FTS only fallback
    if (agentFilter) {
      return await sql`
        SELECT id, label, body, memory_type, agent_id, meta,
          ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
        FROM concepts
        WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
          AND agent_id = ${agentFilter}
        ORDER BY score DESC
        LIMIT ${limit}
      ` as PgSearchResult[];
    }
    return await sql`
      SELECT id, label, body, memory_type, agent_id, meta,
        ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
      FROM concepts
      WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
      ORDER BY score DESC
      LIMIT ${limit}
    ` as PgSearchResult[];
  }

  /**
   * Get concepts by memory type for a given agent.
   */
  async getByType(memoryType: string, limit = 50): Promise<PgConceptRow[]> {
    const sql = getDb();
    return await sql`
      SELECT id, label, body, memory_type, agent_id, meta, created_at, updated_at
      FROM concepts
      WHERE memory_type = ${memoryType}::memory_type
        AND agent_id = ${this.agentId}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    ` as PgConceptRow[];
  }

  /**
   * Store an embedding vector for a concept.
   */
  async setEmbedding(conceptId: string, embedding: number[]): Promise<void> {
    const sql = getDb();
    const embeddingStr = `[${embedding.join(',')}]`;
    await sql`
      UPDATE concepts
      SET embedding = ${embeddingStr}::vector(768)
      WHERE id = ${conceptId}
    `;
  }

  /**
   * Upsert a living profile for an agent/subject pair.
   */
  async upsertProfile(subject: string, traits: Record<string, unknown>): Promise<void> {
    const sql = getDb();
    await sql`
      INSERT INTO profiles (agent_id, subject, traits, updated_at)
      VALUES (${this.agentId}, ${subject}, ${JSON.stringify(traits)}, now())
      ON CONFLICT (agent_id, subject) DO UPDATE SET
        traits = profiles.traits || ${JSON.stringify(traits)}::jsonb,
        updated_at = now()
    `;
  }

  /**
   * Get profile for this agent.
   */
  async getProfile(subject: string): Promise<Record<string, unknown> | null> {
    const sql = getDb();
    const rows = await sql`
      SELECT traits FROM profiles
      WHERE agent_id = ${this.agentId} AND subject = ${subject}
    `;
    return rows[0]?.traits ?? null;
  }

  /**
   * Get all profiles for this agent.
   */
  async getAllProfiles(): Promise<Array<{ subject: string; traits: Record<string, unknown> }>> {
    const sql = getDb();
    const rows = await sql`
      SELECT subject, traits FROM profiles
      WHERE agent_id = ${this.agentId}
      ORDER BY updated_at DESC
    `;
    return rows.map((r) => ({
      subject: r.subject as string,
      traits: r.traits as Record<string, unknown>,
    }));
  }

  /**
   * Get the N most recent session summaries for this agent.
   */
  async getRecentSessionSummaries(limit = 3): Promise<Array<{ sessionId: string; summary: string; keyDecisions: unknown[] }>> {
    const sql = getDb();
    const rows = await sql`
      SELECT session_id, summary, key_decisions
      FROM session_summaries
      WHERE agent = ${this.agentId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      summary: r.summary as string,
      keyDecisions: (r.key_decisions as unknown[]) ?? [],
    }));
  }

  /**
   * Store a session summary.
   */
  async saveSessionSummary(sessionId: string, summary: string, keyDecisions: unknown[] = []): Promise<void> {
    const sql = getDb();
    await sql`
      INSERT INTO session_summaries (session_id, agent, summary, key_decisions)
      VALUES (${sessionId}, ${this.agentId}, ${summary}, ${JSON.stringify(keyDecisions)})
      ON CONFLICT (session_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        key_decisions = EXCLUDED.key_decisions
    `;
  }

  /**
   * Update agent heartbeat.
   */
  async heartbeat(status = 'online', meta?: Record<string, unknown>): Promise<void> {
    const sql = getDb();
    await sql`
      INSERT INTO agent_heartbeats (agent_id, status, last_seen, meta)
      VALUES (${this.agentId}, ${status}, now(), ${JSON.stringify(meta ?? {})})
      ON CONFLICT (agent_id) DO UPDATE SET
        status = EXCLUDED.status,
        last_seen = now(),
        meta = EXCLUDED.meta
    `;
  }

  // ---------------------------------------------------------------------------
  // Agent task queue (Stage 3C)
  // ---------------------------------------------------------------------------

  /**
   * Push a task onto a named queue for a target agent.
   */
  async pushTask(queue: string, taskType: string, payload: Record<string, unknown> = {}): Promise<string> {
    const sql = getDb();
    const rows = await sql`
      INSERT INTO agent_tasks (queue, agent_id, task_type, payload)
      VALUES (${queue}, ${this.agentId}, ${taskType}, ${JSON.stringify(payload)})
      RETURNING id
    `;
    return rows[0].id as string;
  }

  /**
   * Pop the next pending task from a queue (marks as processing).
   */
  async popTask(queue: string): Promise<{ id: string; taskType: string; payload: Record<string, unknown> } | null> {
    const sql = getDb();
    const rows = await sql`
      UPDATE agent_tasks
      SET status = 'processing', processed_at = now()
      WHERE id = (
        SELECT id FROM agent_tasks
        WHERE queue = ${queue} AND status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, task_type, payload
    `;
    if (rows.length === 0) return null;
    return {
      id: rows[0].id as string,
      taskType: rows[0].task_type as string,
      payload: rows[0].payload as Record<string, unknown>,
    };
  }

  /**
   * Mark a task as done or failed.
   */
  async ackTask(taskId: string, status: 'done' | 'failed' = 'done'): Promise<void> {
    const sql = getDb();
    await sql`
      UPDATE agent_tasks SET status = ${status}, processed_at = now()
      WHERE id = ${taskId}
    `;
  }

  /**
   * Broadcast a regime_shift notification to all listeners.
   */
  async notifyRegimeShift(payload: Record<string, unknown>): Promise<void> {
    const sql = getDb();
    await sql`SELECT pg_notify('regime_shift', ${JSON.stringify(payload)})`;
  }

  // ---------------------------------------------------------------------------

  /**
   * Fire-and-forget: generate embedding and store it if not already present.
   * Skips silently if Ollama is unavailable.
   */
  private _autoEmbed(conceptId: string, text: string): void {
    embedText(text).then((vec) => {
      if (vec) this.setEmbedding(conceptId, vec).catch(() => {});
    }).catch(() => {});
  }

  async close(): Promise<void> {
    if (_sql) {
      await _sql.end();
      _sql = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyMemoryType(surface: string, observationType: string): string {
  const s = surface.toLowerCase();
  const o = observationType.toLowerCase();

  if (o === 'preference' || s.includes('prefer') || s.includes('setting')) return 'preference';
  if (o === 'relationship' || s.includes('relationship')) return 'relationship';
  if (o === 'episode' || s.includes('session') || s.includes('trade') || s.includes('outcome')) return 'episode';
  if (o === 'procedure' || s.includes('how to') || s.includes('process') || s.includes('pipeline')) return 'procedure';
  return 'fact';
}

// ---------------------------------------------------------------------------
// Feature flag helper
// ---------------------------------------------------------------------------

export function isPostgresEnabled(): boolean {
  return process.env.THEOREX_STORAGE === 'postgres';
}

export function createStore(agentId: string): PostgresStore {
  return new PostgresStore(agentId);
}
