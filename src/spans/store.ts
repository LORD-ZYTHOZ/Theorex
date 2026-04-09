// src/spans/store.ts
// Agent Optimizer — Postgres CRUD for agent_spans table.

import { resilientQuery } from "../axon/pg-resilience";
import type { AgentSpan, SpanEmitInput, SpanQuery } from "./types";
import { getDb, resetDb } from "../axon/pg-connection";

export class SpanStore {
  async emitSpan(input: SpanEmitInput): Promise<string> {
    const rows = await resilientQuery<{ span_id: string }>(
      getDb,
      resetDb,
      async (sql) =>
        sql`
          INSERT INTO agent_spans (
            agent_id, parent_span_id, task_type,
            prompt_sent, output_recv, raw_thought,
            tools_called, session_id, regime_snapshot,
            latency_ms, token_usage, metadata
          ) VALUES (
            ${input.agent_id},
            ${input.parent_span_id ?? null},
            ${input.task_type},
            ${input.prompt_sent ?? null},
            ${input.output_recv ?? null},
            ${input.raw_thought ?? null},
            ${JSON.stringify(input.tools_called ?? [])},
            ${input.session_id ?? null},
            ${JSON.stringify(input.regime_snapshot ?? {})},
            ${input.latency_ms ?? null},
            ${input.token_usage ?? null},
            ${JSON.stringify(input.metadata ?? {})}
          )
          RETURNING span_id
        `,
    );
    if (!rows[0]?.span_id) {
      throw new Error("emitSpan: INSERT returned no span_id");
    }
    return rows[0].span_id;
  }

  async getSpans(query: SpanQuery): Promise<AgentSpan[]> {
    if (query.resolved_only && query.unoptimized_only) {
      throw new Error("getSpans: resolved_only and unoptimized_only are mutually exclusive");
    }

    const limit = query.limit ?? 50;
    const since = query.since ?? new Date(0).toISOString();

    const rows = await resilientQuery<AgentSpan>(getDb, resetDb, async (sql) => {
      if (query.resolved_only && query.task_type) {
        return sql`
          SELECT * FROM agent_spans
          WHERE agent_id = ${query.agent_id}
            AND created_at >= ${since}
            AND resolved = true
            AND task_type = ${query.task_type}
          ORDER BY created_at DESC LIMIT ${limit}
        `;
      }
      if (query.resolved_only) {
        return sql`
          SELECT * FROM agent_spans
          WHERE agent_id = ${query.agent_id}
            AND created_at >= ${since}
            AND resolved = true
          ORDER BY created_at DESC LIMIT ${limit}
        `;
      }
      if (query.unoptimized_only) {
        return sql`
          SELECT * FROM agent_spans
          WHERE agent_id = ${query.agent_id}
            AND created_at >= ${since}
            AND optimized = false
          ORDER BY created_at DESC LIMIT ${limit}
        `;
      }
      return sql`
        SELECT * FROM agent_spans
        WHERE agent_id = ${query.agent_id}
          AND created_at >= ${since}
        ORDER BY created_at DESC LIMIT ${limit}
      `;
    });
    return rows;
  }

  async resolveSpan(spanId: string, rewardScore: number): Promise<void> {
    await resilientQuery(getDb, resetDb, async (sql) =>
      sql`
        UPDATE agent_spans
        SET resolved = true, reward_score = ${rewardScore}, reward_at = now()
        WHERE span_id = ${spanId}
      `,
    );
  }

  async markOptimized(spanId: string): Promise<void> {
    await resilientQuery(getDb, resetDb, async (sql) =>
      sql`
        UPDATE agent_spans
        SET optimized = true, optimized_at = now()
        WHERE span_id = ${spanId}
      `,
    );
  }

  async getRecentOutputs(
    agentId: string,
    taskType: string,
    n: number,
  ): Promise<string[]> {
    const rows = await resilientQuery<{ output_recv: string | null }>(
      getDb,
      resetDb,
      async (sql) =>
        sql`
          SELECT output_recv FROM agent_spans
          WHERE agent_id = ${agentId}
            AND task_type = ${taskType}
            AND output_recv IS NOT NULL
          ORDER BY created_at DESC
          LIMIT ${n}
        `,
    );
    return rows.map((r) => r.output_recv ?? "");
  }
}
