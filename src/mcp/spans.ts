// src/mcp/spans.ts
// MCP tool handlers for the Agent Optimizer span system.

import { SpanStore } from "../spans/store";
import { isDoomLoop } from "../spans/circuit-breaker";
import { processText } from "../compose";
import { PostgresStore } from "../axon/postgres-store";
import type { SpanEmitInput, SpanQuery } from "../spans/types";

const store = new SpanStore();

function ok(result: unknown): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: null,
    result: { content: [{ type: "text", text: JSON.stringify(result) }] },
  });
}

function err(message: string): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32602, message },
  });
}

function err429(message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: 429, message } },
    { status: 429 },
  );
}

export async function handleSpanTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Response> {
  switch (name) {
    case "emit-span": {
      const agent_id = typeof args.agent_id === "string" ? args.agent_id : null;
      const task_type = typeof args.task_type === "string" ? args.task_type : "unknown";
      if (!agent_id) return err("agent_id is required");

      const input: SpanEmitInput = {
        agent_id,
        task_type,
        prompt_sent: typeof args.prompt_sent === "string" ? args.prompt_sent : undefined,
        output_recv: typeof args.output_recv === "string" ? args.output_recv : undefined,
        raw_thought: typeof args.raw_thought === "string" ? args.raw_thought : undefined,
        tools_called: Array.isArray(args.tools_called) ? args.tools_called as string[] : undefined,
        session_id: typeof args.session_id === "string" ? args.session_id : undefined,
        regime_snapshot: typeof args.regime_snapshot === "object" && args.regime_snapshot !== null
          ? args.regime_snapshot as Record<string, unknown>
          : undefined,
        latency_ms: typeof args.latency_ms === "number" ? args.latency_ms : undefined,
        token_usage: typeof args.token_usage === "number" ? args.token_usage : undefined,
        parent_span_id: typeof args.parent_span_id === "string" ? args.parent_span_id : undefined,
        metadata: typeof args.metadata === "object" && args.metadata !== null
          ? args.metadata as Record<string, unknown>
          : undefined,
      };

      // Circuit breaker: check for doom loop before writing
      if (input.output_recv) {
        const recent = await store.getRecentOutputs(agent_id, task_type, 3);
        const loop = isDoomLoop([input.output_recv, ...recent]);
        if (loop.is_doom_loop) {
          return err429(
            `Doom Loop Detected for ${agent_id}/${task_type} ` +
            `(similarity=${loop.similarity_score.toFixed(2)}). ` +
            `Break your reasoning chain and try a different approach.`
          );
        }
      }

      const span_id = await store.emitSpan(input);
      return ok({ span_id });
    }

    case "score-outcome": {
      const span_id = typeof args.span_id === "string" ? args.span_id : null;
      const reward_score = typeof args.reward_score === "number" ? args.reward_score : null;
      if (!span_id) return err("span_id is required");
      if (reward_score === null) return err("reward_score is required");
      await store.resolveSpan(span_id, reward_score);
      return ok({ ok: true });
    }

    case "get-spans": {
      const agent_id = typeof args.agent_id === "string" ? args.agent_id : null;
      if (!agent_id) return err("agent_id is required");

      const query: SpanQuery = {
        agent_id,
        since: typeof args.since === "string" ? args.since : undefined,
        resolved_only: args.resolved_only === true,
        unoptimized_only: args.unoptimized_only === true,
        task_type: typeof args.task_type === "string" ? args.task_type : undefined,
        limit: typeof args.limit === "number" ? args.limit : 50,
      };

      const spans = await store.getSpans(query);
      return ok({ spans, count: spans.length });
    }

    case "get-doom-loops": {
      const agent_id = typeof args.agent_id === "string" ? args.agent_id : null;
      const task_type = typeof args.task_type === "string" ? args.task_type : "unknown";
      if (!agent_id) return err("agent_id is required");

      const recent = await store.getRecentOutputs(agent_id, task_type, 5);
      const result = isDoomLoop(recent);
      return ok(result);
    }

    case "write-optimizer-rationale": {
      const agent_id = typeof args.agent_id === "string" ? args.agent_id : null;
      const summary = typeof args.summary === "string" ? args.summary : null;
      if (!agent_id || !summary) return err("agent_id and summary are required");

      const text = `[OPTIMIZER RATIONALE] ${summary}`;
      const timestamp = new Date().toISOString();
      const events = processText(text, 1.0, "concept", timestamp);
      const pgStore = new PostgresStore(agent_id);
      for (const event of events) {
        await pgStore.mergeNode(event, "optimizer");
      }
      await pgStore.close();

      return ok({ ok: true, agent_id });
    }

    default:
      return Response.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32601, message: `Unknown span tool: ${name}` },
      });
  }
}

// Tool definitions for tools/list endpoint
export const spanToolDefs = [
  {
    name: "emit-span",
    description: "Record an agent interaction span. Called automatically by Theorex MCP tools (tool-as-hook). Also callable manually.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        task_type: { type: "string" },
        prompt_sent: { type: "string" },
        output_recv: { type: "string" },
        raw_thought: { type: "string" },
        tools_called: { type: "array", items: { type: "string" } },
        session_id: { type: "string" },
        regime_snapshot: { type: "object" },
        latency_ms: { type: "number" },
        token_usage: { type: "number" },
        parent_span_id: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["agent_id", "task_type"],
    },
  },
  {
    name: "score-outcome",
    description: "Manually attach a reward score to an existing span.",
    inputSchema: {
      type: "object",
      properties: {
        span_id: { type: "string" },
        reward_score: { type: "number" },
      },
      required: ["span_id", "reward_score"],
    },
  },
  {
    name: "get-spans",
    description: "Read agent spans for qwen-sage analysis. Use resolved_only=true for optimization.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        since: { type: "string" },
        resolved_only: { type: "boolean" },
        unoptimized_only: { type: "boolean" },
        task_type: { type: "string" },
        limit: { type: "number" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "get-doom-loops",
    description: "Check if an agent is in a doom loop for a given task type.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        task_type: { type: "string" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "write-optimizer-rationale",
    description: "Write qwen-sage's optimization rationale as a Theorex concept (audit trail).",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        summary: { type: "string" },
        changes: { type: "object" },
      },
      required: ["agent_id", "summary"],
    },
  },
];
