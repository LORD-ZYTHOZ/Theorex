// src/axon/learnings.ts — Nova/Minder learning system.
// Stores lessons from significant events so Nova gets smarter over time.

import { getDb } from "./pg-connection";

export type EventType = "trade" | "escalation" | "decision" | "prediction" | "health_check" | "general";
export type Outcome = "positive" | "negative" | "neutral";

export interface Learning {
  id?: number;
  agent: string;
  event_type: EventType;
  context: string;
  pattern: string;
  outcome: Outcome;
  confidence: number;
  meta?: Record<string, unknown>;
  created_at?: string;
}

export interface LearningFilter {
  agent?: string;
  event_type?: EventType;
  context_contains?: string;
  outcome?: Outcome;
  min_confidence?: number;
  limit?: number;
  offset?: number;
}

/** Write a learning entry to the learnings table. */
export async function write_learning(learning: Learning): Promise<number> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO learnings (agent, event_type, context, pattern, outcome, confidence, meta)
    VALUES (
      ${learning.agent},
      ${learning.event_type},
      ${learning.context},
      ${learning.pattern},
      ${learning.outcome}::text,
      ${learning.confidence ?? 0.5},
      ${learning.meta ?? {}}
    )
    RETURNING id
  `;
  return rows[0]?.id ?? 0;
}

/** Query learnings with optional filters. */
export async function get_learnings(filter: LearningFilter = {}): Promise<Learning[]> {
  const sql = getDb();
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  // Build where clause dynamically
  let query = sql`
    SELECT id, agent, event_type, context, pattern, outcome, confidence, meta, created_at
    FROM learnings
    WHERE 1=1
  `;

  if (filter.agent) {
    query = sql`${query} AND agent = ${filter.agent}`;
  }
  if (filter.event_type) {
    query = sql`${query} AND event_type = ${filter.event_type}`;
  }
  if (filter.outcome) {
    query = sql`${query} AND outcome = ${filter.outcome}::text`;
  }
  if (filter.min_confidence !== undefined) {
    query = sql`${query} AND confidence >= ${filter.min_confidence}`;
  }
  if (filter.context_contains) {
    query = sql`${query} AND context ILIKE ${"%" + filter.context_contains + "%"}`;
  }

  query = sql`${query} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

  const rows = await query;
  return rows.map((r) => ({
    id: r.id as number,
    agent: r.agent as string,
    event_type: r.event_type as EventType,
    context: r.context as string,
    pattern: r.pattern as string,
    outcome: r.outcome as Outcome,
    confidence: Number(r.confidence),
    meta: (r.meta as Record<string, unknown>) ?? {},
    created_at: r.created_at as string,
  }));
}

/** Get learnings relevant to a specific agent and context keyword. */
export async function get_relevant_learnings(
  agent: string,
  context_kw: string,
  limit = 10
): Promise<Learning[]> {
  return get_learnings({
    agent,
    context_contains: context_kw,
    min_confidence: 0.5,
    limit,
  });
}

/** Get aggregated learning summary per agent. */
export async function get_learning_summary(): Promise<Record<string, {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  avg_confidence: number;
}>> {
  const sql = getDb();
  const rows = await sql`
    SELECT
      agent,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE outcome = 'positive') as positive,
      COUNT(*) FILTER (WHERE outcome = 'negative') as negative,
      COUNT(*) FILTER (WHERE outcome = 'neutral') as neutral,
      AVG(confidence) as avg_confidence
    FROM learnings
    GROUP BY agent
  `;

  const result: Record<string, { total: number; positive: number; negative: number; neutral: number; avg_confidence: number }> = {};
  for (const r of rows) {
    result[r.agent as string] = {
      total: Number(r.total),
      positive: Number(r.positive),
      negative: Number(r.negative),
      neutral: Number(r.neutral),
      avg_confidence: Number(r.avg_confidence),
    };
  }
  return result;
}

/** Update confidence on existing learnings based on new outcomes. */
export async function reinforce_learning(id: number, delta: number): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE learnings
    SET confidence = LEAST(1.0, GREATEST(0.0, confidence + ${delta}))
    WHERE id = ${id}
  `;
}

/** Create learnings table if it doesn't exist. */
export async function ensure_learnings_table(): Promise<void> {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS learnings (
      id          BIGSERIAL PRIMARY KEY,
      agent       TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      context     TEXT NOT NULL,
      pattern     TEXT NOT NULL,
      outcome     TEXT NOT NULL,
      confidence  REAL DEFAULT 0.5,
      meta        JSONB DEFAULT '{}',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_learnings_agent_event ON learnings (agent, event_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learnings_context ON learnings USING gin (to_tsvector('english', context))`;
}