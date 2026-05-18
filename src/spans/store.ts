// src/spans/store.ts
// Agent Optimizer — Postgres CRUD for agent_spans table.

import { resilientQuery } from "../axon/pg-resilience";
import { compressSpanFields } from "../axon/tokenjuice";
import type { AgentSpan, SpanEmitInput, SpanQuery } from "./types";
import { getDb, resetDb } from "../axon/pg-connection";

export class SpanStore {
  /**
   * emitSpan with TokenJuice compression.
   * Compresses prompt_sent, output_recv, raw_thought before insert.
   * Set compress=false to store raw (for testing/debug).
   */
  async emitSpan(input: SpanEmitInput, compress = true): Promise<string> {
    const fieldsToCompress = compressSpanFields({
      prompt_sent: typeof input.prompt_sent === "string" ? input.prompt_sent : null,
      output_recv: typeof input.output_recv === "string" ? input.output_recv : null,
      raw_thought: typeof input.raw_thought === "string" ? input.raw_thought : null,
      tools_called: input.tools_called,
    });

    const compressedInput = {
      ...input,
      prompt_sent: fieldsToCompress.compressed.prompt_sent ?? input.prompt_sent,
      output_recv: fieldsToCompress.compressed.output_recv ?? input.output_recv,
      raw_thought: fieldsToCompress.compressed.raw_thought ?? input.raw_thought,
    };

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
            ${compressedInput.agent_id},
            ${compressedInput.parent_span_id ?? null},
            ${compressedInput.task_type},
            ${compressedInput.prompt_sent ?? null},
            ${compressedInput.output_recv ?? null},
            ${compressedInput.raw_thought ?? null},
            ${JSON.stringify(compressedInput.tools_called ?? [])},
            ${compressedInput.session_id ?? null},
            ${JSON.stringify(compressedInput.regime_snapshot ?? {})},
            ${compressedInput.latency_ms ?? null},
            ${compressedInput.token_usage ?? null},
            ${JSON.stringify(compressedInput.metadata ?? {})}
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

  /**
   * Full-text search across prompt_sent, output_recv, raw_thought using Postgres FTS5.
   * Returns matching spans ordered by relevance (ts_rank).
   */
  async searchSpans(agentId: string, query: string, limit = 20): Promise<AgentSpan[]> {
    if (!query.trim()) return [];
    const rows = await resilientQuery<AgentSpan>(getDb, resetDb, async (sql) =>
      sql`
        SELECT *, ts_rank(fts_content, plainto_tsquery('english', ${query})) AS rank
        FROM agent_spans
        WHERE agent_id = ${agentId}
          AND fts_content @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}
      `,
    );
    return rows;
  }

  /**
   * Update session_summary for a span (set by LLM summarizer pipeline).
   */
  async setSessionSummary(spanId: string, summary: string): Promise<void> {
    await resilientQuery(getDb, resetDb, async (sql) =>
      sql`UPDATE agent_spans SET session_summary = ${summary} WHERE span_id = ${spanId}`,
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
