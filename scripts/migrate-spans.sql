-- scripts/migrate-spans.sql
-- Agent Optimizer — Phase 1: span capture table

CREATE TABLE IF NOT EXISTS agent_spans (
  span_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  parent_span_id  UUID,
  task_type       TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  prompt_axon     TEXT,
  prompt_sent     TEXT,
  output_recv     TEXT,
  raw_thought     TEXT,
  tools_called    JSONB DEFAULT '[]',
  session_id      TEXT,
  regime_snapshot JSONB DEFAULT '{}',
  latency_ms      INTEGER,
  token_usage     INTEGER,
  metadata        JSONB DEFAULT '{}',
  resolved        BOOLEAN DEFAULT false,
  reward_score    FLOAT,
  reward_at       TIMESTAMPTZ,
  optimized       BOOLEAN DEFAULT false,
  optimized_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_spans_agent_created
  ON agent_spans (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spans_agent_resolved
  ON agent_spans (agent_id, resolved, optimized);

CREATE INDEX IF NOT EXISTS idx_spans_agent_task
  ON agent_spans (agent_id, task_type, created_at DESC);
