// src/spans/types.ts
// Agent Optimizer — shared types for span capture and reward resolution.

export interface AgentSpan {
  readonly span_id: string;
  readonly agent_id: string;
  readonly parent_span_id: string | null;
  readonly task_type: string;
  readonly created_at: string;
  readonly prompt_axon: string | null;
  readonly prompt_sent: string | null;
  readonly output_recv: string | null;
  readonly raw_thought: string | null;
  readonly tools_called: string[];
  readonly session_id: string | null;
  readonly regime_snapshot: Record<string, unknown>;
  readonly latency_ms: number | null;
  readonly token_usage: number | null;
  readonly metadata: Record<string, unknown>;
  readonly resolved: boolean;
  readonly reward_score: number | null;
  readonly reward_at: string | null;
  readonly optimized: boolean;
  readonly optimized_at: string | null;
}

export interface SpanEmitInput {
  readonly agent_id: string;
  readonly task_type: string;
  readonly prompt_sent?: string;
  readonly output_recv?: string;
  readonly raw_thought?: string;
  readonly tools_called?: string[];
  readonly session_id?: string;
  readonly regime_snapshot?: Record<string, unknown>;
  readonly latency_ms?: number;
  readonly token_usage?: number;
  readonly parent_span_id?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface SpanQuery {
  readonly agent_id: string;
  readonly since?: string;           // ISO 8601
  readonly resolved_only?: boolean;
  readonly unoptimized_only?: boolean;
  readonly task_type?: string;
  readonly limit?: number;
}

export interface ResolvedOutcome {
  readonly span_id: string;
  readonly reward_score: number;
}

export interface DoomLoopResult {
  readonly is_doom_loop: boolean;
  readonly span_ids: string[];
  readonly similarity_score: number;
}
