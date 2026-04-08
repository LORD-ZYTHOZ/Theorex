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
import { resilientQuery, isConnectionError, getCircuitBreaker } from "./pg-resilience";

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

function resetDb(): void {
  _sql = null;
}

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

  // ---------------------------------------------------------------------------
  // RLS context helper (Stage 7)
  // ---------------------------------------------------------------------------

  /**
   * Execute a callback inside a transaction with the RLS session variable set.
   * All queries within `fn` are scoped to this.agentId via
   * `theorex.current_agent_id`. Wrapped in circuit breaker + retry.
   */
  private async withAgentContext<T>(
    fn: (tx: ReturnType<typeof Bun.sql>) => Promise<T>,
  ): Promise<T> {
    return resilientQuery(getDb, resetDb, async (sql) =>
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE theorex_app");
        await tx`SELECT set_config('theorex.current_agent_id', ${this.agentId}, true)`;
        return fn(tx);
      }),
    );
  }

  /**
   * Upsert a concept from a ConceptEvent.
   * Returns the UUID of the inserted/updated concept.
   */
  async mergeNode(event: ConceptEvent, observationType = ""): Promise<string> {
    const memType = classifyMemoryType(event.surface_form, observationType);
    const meta = {
      concept_id: event.concept_id,
      importance_weight: event.importance_score,
      frequency_count: event.frequency_count,
      source_weight: event.source_weight,
      observation_type: observationType,
      node_type: event.node_type ?? "",
    };

    const rows = await this.withAgentContext((tx) => tx`
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
    `);

    const id = rows[0].id as string;
    this._autoEmbed(id, event.surface_form);
    return id;
  }

  /**
   * Simple upsert — just label + agent, no ConceptEvent needed.
   */
  async upsertConcept(label: string, memoryType = 'fact', body?: string, meta?: Record<string, unknown>): Promise<string> {
    const rows = await this.withAgentContext((tx) => tx`
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
    `);

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
   *
   * Optional wing/room filters scope results to a palace location.
   * Room filter is only applied when wing is also provided.
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
      wing?: string;
      room?: string;
    } = {}
  ): Promise<PgSearchResult[]> {
    const { limit = 10, ftsWeight = 0.5, vecWeight = 0.5, agentFilter, typeFilter, wing, room } = opts;
    // room is only valid alongside wing
    const effectiveRoom = wing ? room : undefined;

    return this.withAgentContext(async (tx) => {
      if (queryEmbedding) {
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        // hybrid_search() is a stored function — we post-filter by wing/room in a wrapper CTE
        if (wing) {
          if (effectiveRoom) {
            return await tx`
              SELECT hs.* FROM hybrid_search(
                ${queryText},
                ${embeddingStr}::vector(768),
                ${agentFilter ?? null},
                ${typeFilter ?? null}::memory_type,
                ${limit},
                ${ftsWeight},
                ${vecWeight}
              ) hs
              JOIN concepts c ON c.id = hs.id
              WHERE c.wing = ${wing}
                AND c.room = ${effectiveRoom}
            ` as PgSearchResult[];
          }
          return await tx`
            SELECT hs.* FROM hybrid_search(
              ${queryText},
              ${embeddingStr}::vector(768),
              ${agentFilter ?? null},
              ${typeFilter ?? null}::memory_type,
              ${limit},
              ${ftsWeight},
              ${vecWeight}
            ) hs
            JOIN concepts c ON c.id = hs.id
            WHERE c.wing = ${wing}
          ` as PgSearchResult[];
        }
        return await tx`
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

      // FTS-only path
      if (agentFilter) {
        if (wing) {
          if (effectiveRoom) {
            // Lines where wing+room filters are added to FTS+agentFilter query
            return await tx`
              SELECT id, label, body, memory_type, agent_id, meta,
                ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
              FROM concepts
              WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
                AND agent_id = ${agentFilter}
                AND wing = ${wing}
                AND room = ${effectiveRoom}
              ORDER BY score DESC
              LIMIT ${limit}
            ` as PgSearchResult[];
          }
          return await tx`
            SELECT id, label, body, memory_type, agent_id, meta,
              ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
            FROM concepts
            WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
              AND agent_id = ${agentFilter}
              AND wing = ${wing}
            ORDER BY score DESC
            LIMIT ${limit}
          ` as PgSearchResult[];
        }
        return await tx`
          SELECT id, label, body, memory_type, agent_id, meta,
            ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
          FROM concepts
          WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
            AND agent_id = ${agentFilter}
          ORDER BY score DESC
          LIMIT ${limit}
        ` as PgSearchResult[];
      }

      if (wing) {
        if (effectiveRoom) {
          // Lines where wing+room filters are added to FTS-only query (no agentFilter)
          return await tx`
            SELECT id, label, body, memory_type, agent_id, meta,
              ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
            FROM concepts
            WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
              AND wing = ${wing}
              AND room = ${effectiveRoom}
            ORDER BY score DESC
            LIMIT ${limit}
          ` as PgSearchResult[];
        }
        return await tx`
          SELECT id, label, body, memory_type, agent_id, meta,
            ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
          FROM concepts
          WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
            AND wing = ${wing}
          ORDER BY score DESC
          LIMIT ${limit}
        ` as PgSearchResult[];
      }

      return await tx`
        SELECT id, label, body, memory_type, agent_id, meta,
          ts_rank(fts_tokens, websearch_to_tsquery('english', ${queryText})) AS score
        FROM concepts
        WHERE fts_tokens @@ websearch_to_tsquery('english', ${queryText})
        ORDER BY score DESC
        LIMIT ${limit}
      ` as PgSearchResult[];
    });
  }

  /**
   * Upsert a concept into a specific palace wing/room.
   * Wraps upsertConcept() and then sets wing, room, compressed_aaak on the row.
   * Returns the conceptId.
   */
  async addPalaceConcept(
    label: string,
    body: string,
    wing: string,
    room: string,
    compressedAaak?: string,
    memoryType = 'fact',
  ): Promise<string> {
    const conceptId = await this.upsertConcept(label, memoryType, body);
    await this.withAgentContext((tx) => tx`
      UPDATE concepts
      SET wing = ${wing},
          room = ${room},
          compressed_aaak = ${compressedAaak ?? null}
      WHERE id = ${conceptId}
    `);
    return conceptId;
  }

  /**
   * Get concepts by memory type for a given agent.
   */
  async getByType(memoryType: string, limit = 50): Promise<PgConceptRow[]> {
    return this.withAgentContext((tx) => tx`
      SELECT id, label, body, memory_type, agent_id, meta, created_at, updated_at
      FROM concepts
      WHERE memory_type = ${memoryType}::memory_type
        AND agent_id = ${this.agentId}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `) as Promise<PgConceptRow[]>;
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
    await this.withAgentContext((tx) => tx`
      INSERT INTO profiles (agent_id, subject, traits, updated_at)
      VALUES (${this.agentId}, ${subject}, ${JSON.stringify(traits)}, now())
      ON CONFLICT (agent_id, subject) DO UPDATE SET
        traits = profiles.traits || ${JSON.stringify(traits)}::jsonb,
        updated_at = now()
    `);
  }

  /**
   * Get profile for this agent.
   */
  async getProfile(subject: string): Promise<Record<string, unknown> | null> {
    const rows = await this.withAgentContext((tx) => tx`
      SELECT traits FROM profiles
      WHERE agent_id = ${this.agentId} AND subject = ${subject}
    `);
    return rows[0]?.traits ?? null;
  }

  /**
   * Get all profiles for this agent.
   */
  async getAllProfiles(): Promise<Array<{ subject: string; traits: Record<string, unknown> }>> {
    const rows = await this.withAgentContext((tx) => tx`
      SELECT subject, traits FROM profiles
      WHERE agent_id = ${this.agentId}
      ORDER BY updated_at DESC
    `);
    return rows.map((r) => ({
      subject: r.subject as string,
      traits: r.traits as Record<string, unknown>,
    }));
  }

  /**
   * Get the N most recent session summaries for this agent.
   */
  async getRecentSessionSummaries(limit = 3): Promise<Array<{ sessionId: string; summary: string; keyDecisions: unknown[] }>> {
    const rows = await this.withAgentContext((tx) => tx`
      SELECT session_id, summary, key_decisions
      FROM session_summaries
      WHERE agent = ${this.agentId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
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
    await this.withAgentContext((tx) => tx`
      INSERT INTO session_summaries (session_id, agent, summary, key_decisions)
      VALUES (${sessionId}, ${this.agentId}, ${summary}, ${JSON.stringify(keyDecisions)})
      ON CONFLICT (session_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        key_decisions = EXCLUDED.key_decisions
    `);
  }

  /**
   * Update agent heartbeat.
   */
  async heartbeat(status = 'online', meta?: Record<string, unknown>): Promise<void> {
    const sql = getDb();
    // Heartbeat uses raw sql (no RLS context) — heartbeats are cross-agent visible
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
    const rows = await this.withAgentContext((tx) => tx`
      INSERT INTO agent_tasks (queue, agent_id, task_type, payload)
      VALUES (${queue}, ${this.agentId}, ${taskType}, ${JSON.stringify(payload)})
      RETURNING id
    `);
    return rows[0].id as string;
  }

  /**
   * Pop the next pending task from a queue (marks as processing).
   */
  async popTask(queue: string): Promise<{ id: string; taskType: string; payload: Record<string, unknown> } | null> {
    const rows = await this.withAgentContext((tx) => tx`
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
    `);
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
    await this.withAgentContext((tx) => tx`
      UPDATE agent_tasks SET status = ${status}, processed_at = now()
      WHERE id = ${taskId}
    `);
  }

  /**
   * Broadcast a regime_shift notification to all listeners.
   */
  async notifyRegimeShift(payload: Record<string, unknown>): Promise<void> {
    const sql = getDb();
    await sql`SELECT pg_notify('regime_shift', ${JSON.stringify(payload)})`;
  }

  // ---------------------------------------------------------------------------
  // Procedures (Stage 6A)
  // ---------------------------------------------------------------------------

  /**
   * Save a procedure as a concept with memory_type = 'procedure'.
   * Steps, conditions, and tools are stored in meta JSONB.
   */
  async saveProcedure(
    name: string,
    steps: string[],
    conditions?: string,
    tools?: string[],
  ): Promise<string> {
    const meta: Record<string, unknown> = { steps };
    if (conditions !== undefined) meta.conditions = conditions;
    if (tools !== undefined) meta.tools = tools;
    const body = steps.join("\n");

    const rows = await this.withAgentContext((tx) => tx`
      INSERT INTO concepts (label, body, memory_type, agent_id, meta)
      VALUES (
        ${name},
        ${body},
        'procedure'::memory_type,
        ${this.agentId},
        ${JSON.stringify(meta)}
      )
      ON CONFLICT (label, agent_id) DO UPDATE SET
        body = EXCLUDED.body,
        meta = EXCLUDED.meta,
        updated_at = now()
      RETURNING id
    `);

    const id = rows[0].id as string;
    this._autoEmbed(id, name);
    return id;
  }

  /**
   * Retrieve a single procedure by name for this agent.
   */
  async getProcedure(name: string): Promise<ProcedureRecord | null> {
    const rows = await this.withAgentContext((tx) => tx`
      SELECT label, meta FROM concepts
      WHERE label = ${name}
        AND memory_type = 'procedure'::memory_type
        AND agent_id = ${this.agentId}
      LIMIT 1
    `);
    if (rows.length === 0) return null;
    return mapRowToProcedure(rows[0]);
  }

  /**
   * Retrieve all procedures for this agent.
   */
  async getAllProcedures(limit = 50): Promise<ProcedureRecord[]> {
    const rows = await this.withAgentContext((tx) => tx`
      SELECT label, meta FROM concepts
      WHERE memory_type = 'procedure'::memory_type
        AND agent_id = ${this.agentId}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
    return rows.map(mapRowToProcedure);
  }

  // ---------------------------------------------------------------------------
  // Flash events (Stage 7 — persist to Postgres)
  // ---------------------------------------------------------------------------

  /**
   * Batch-insert flash events into flash_events partitioned table.
   * Returns count of inserted rows. No RLS — flash is a shared event stream.
   */
  async insertFlashEvents(events: ReadonlyArray<{
    readonly tool_name: string;
    readonly tool_input_preview: string;
    readonly tool_response_preview: string;
    readonly timestamp: string;
    readonly significance_score: number;
  }>): Promise<number> {
    if (events.length === 0) return 0;
    const sql = getDb();

    for (const e of events) {
      await sql`
        INSERT INTO flash_events (id, event_type, agent, payload, created_at)
        VALUES (
          ${crypto.randomUUID()},
          ${e.tool_name},
          ${this.agentId},
          ${JSON.stringify({
            tool_input_preview: e.tool_input_preview,
            tool_response_preview: e.tool_response_preview,
            significance_score: e.significance_score,
          })},
          ${e.timestamp}
        )
      `;
    }

    return events.length;
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

  /**
   * Get all concepts for this agent, ordered by importance_weight descending.
   */
  async getAllConcepts(limit = 5000): Promise<PgConceptRow[]> {
    return this.withAgentContext((tx) => tx`
      SELECT id, label, body, memory_type, agent_id, meta, embedding, created_at, updated_at
      FROM concepts
      WHERE agent_id = ${this.agentId}
      ORDER BY (meta->>'importance_weight')::float DESC NULLS LAST
      LIMIT ${limit}
    `) as Promise<PgConceptRow[]>;
  }

  /**
   * Look up a single concept by label (case-insensitive) or meta.concept_id.
   * Returns null if not found.
   */
  async lookupConcept(labelOrId: string): Promise<PgConceptRow | null> {
    const rows = await this.withAgentContext((tx) => tx`
      SELECT id, label, body, memory_type, agent_id, meta, embedding, created_at, updated_at
      FROM concepts
      WHERE agent_id = ${this.agentId}
        AND (
          lower(label) = lower(${labelOrId})
          OR meta->>'concept_id' = ${labelOrId}
        )
      LIMIT 1
    `) as PgConceptRow[];
    return rows[0] ?? null;
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

export interface ProcedureRecord {
  name: string;
  steps: string[];
  conditions?: string;
  tools?: string[];
}

function mapRowToProcedure(row: Record<string, unknown>): ProcedureRecord {
  const meta = (typeof row.meta === "object" && row.meta !== null ? row.meta : {}) as Record<string, unknown>;
  return {
    name: row.label as string,
    steps: Array.isArray(meta.steps) ? meta.steps as string[] : [],
    conditions: typeof meta.conditions === "string" ? meta.conditions : undefined,
    tools: Array.isArray(meta.tools) ? meta.tools as string[] : undefined,
  };
}

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
