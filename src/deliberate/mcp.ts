// deliberate/mcp.ts — MCP tool definitions and handlers for deliberation channel.
// Exposes deliberate + deliberation_history as MCP tools.

import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { TradingSession, DeliberationRecord } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SESSIONS: readonly TradingSession[] = [
  "asian",
  "london",
  "new_york",
  "off_hours",
];

const DEFAULT_DELIBERATIONS_DIR = "data/deliberations";

// ---------------------------------------------------------------------------
// MCP response helpers
// ---------------------------------------------------------------------------

interface McpToolResponse {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text: string }>;
}

function mcpText(text: string): McpToolResponse {
  return { content: [{ type: "text", text }] };
}

function mcpError(message: string): McpToolResponse {
  return mcpText(`Error: ${message}`);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function deliberateToolDef(): object {
  return {
    name: "deliberate",
    description:
      "Run a deliberation analysis for a trading session. Collects perspectives from Singularity, Divergent, and Horizon, then produces an LLM-driven debrief.",
    inputSchema: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description: "Trading session: asian, london, new_york, or off_hours",
          enum: VALID_SESSIONS,
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format",
        },
        force: {
          type: "boolean",
          description: "Overwrite existing deliberation for this session+date (default: false)",
        },
      },
      required: ["session", "date"],
    },
  };
}

export function deliberationHistoryToolDef(): object {
  return {
    name: "deliberation_history",
    description:
      "List past deliberation summaries. Optionally filter by date range or session.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO date (YYYY-MM-DD). Only return deliberations on or after this date.",
        },
        session: {
          type: "string",
          description: "Filter by trading session: asian, london, new_york, or off_hours",
          enum: VALID_SESSIONS,
        },
      },
      required: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleDeliberateTool(
  args: Record<string, unknown>,
  dispatch?: (prompt: string, maxTokens?: number) => Promise<string>,
): Promise<McpToolResponse> {
  const session = typeof args.session === "string" ? args.session : "";
  const date = typeof args.date === "string" ? args.date : "";
  const force = typeof args.force === "boolean" ? args.force : false;

  if (!session) {
    return mcpError("Missing required argument: session");
  }
  if (!date) {
    return mcpError("Missing required argument: date");
  }
  if (!VALID_SESSIONS.includes(session as TradingSession)) {
    return mcpError(
      `Invalid session: ${session}. Must be one of: ${VALID_SESSIONS.join(", ")}`,
    );
  }

  // If no dispatch function provided, return the queued stub (backward compat)
  if (!dispatch) {
    return mcpText(
      JSON.stringify({
        status: "accepted",
        session,
        date,
        force,
        message: `Deliberation queued for ${session} session on ${date}. Use the CLI 'theorex deliberate' for full execution.`,
      }),
    );
  }

  // Full execution via runDeliberation
  const { runDeliberation } = await import("./orchestrate");
  const { writeDeliberation } = await import("./writer");
  const { join: pathJoin } = await import("node:path");

  // Resolve data paths — assumes singularity+divergence+horizon on m4
  const singularityPath = process.env.SINGULARITY_TRADES_PATH ?? "data/singularity/trades.jsonl";
  const divergentPath = pathJoin(process.env.DIVERGENT_DIR ?? "data/divergence", `${date}-${session}.json`);
  const horizonPath = pathJoin(process.env.HORIZON_DIR ?? "data/horizon", `${date}-${session}.json`);
  const outputDir = process.env.DELIBERATIONS_DIR ?? "data/deliberations";

  const record = await runDeliberation({
    session: session as TradingSession,
    date,
    paths: { singularity: singularityPath, divergent: divergentPath, horizon: horizonPath },
    outputDir,
    dispatch,
    force,
  }).catch((e: Error) => {
    return {
      id: crypto.randomUUID(),
      session: session as TradingSession,
      date,
      status: "error" as const,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      model: "unknown",
      latency_ms: 0,
      packet: null,
      debrief: null,
      takeaways: [],
      error: e.message,
    };
  });

  if (record.status === "error") {
    return mcpError(`Deliberation failed: ${record.error}`);
  }

  const { jsonPath } = await writeDeliberation(record, outputDir, { force });

  return mcpText(
    JSON.stringify({
      status: "completed",
      id: record.id,
      session,
      date,
      model: record.model,
      latency_ms: record.latency_ms,
      takeaways_count: record.takeaways?.length ?? 0,
      output: jsonPath,
    }),
  );
}

export async function handleDeliberationHistoryTool(
  args: Record<string, unknown>,
  deliberationsDir?: string,
): Promise<McpToolResponse> {
  const since = typeof args.since === "string" ? args.since : undefined;
  const session = typeof args.session === "string" ? args.session : undefined;

  const dir = deliberationsDir ?? DEFAULT_DELIBERATIONS_DIR;

  const records = await readDeliberationFiles(dir);

  const filtered = records.filter((r) => {
    if (since && r.date < since) return false;
    if (session && r.session !== session) return false;
    return true;
  });

  // Return summaries only — omit verbose fields
  const summaries = filtered.map((r) => ({
    id: r.id,
    date: r.date,
    session: r.session,
    status: r.status,
    model: r.model,
    latency_ms: r.latency_ms,
    created_at: r.created_at,
    completed_at: r.completed_at,
    error: r.error,
  }));

  return mcpText(JSON.stringify(summaries, null, 2));
}

// ---------------------------------------------------------------------------
// File reader
// ---------------------------------------------------------------------------

async function readDeliberationFiles(dir: string): Promise<readonly DeliberationRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = entries
    .filter((f) => f.endsWith(".json"))
    .sort();

  const results: DeliberationRecord[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await Bun.file(join(dir, file)).text();
      const parsed = JSON.parse(content) as DeliberationRecord;
      if (parsed.date && parsed.session && parsed.status) {
        results.push(parsed);
      }
    } catch {
      // Skip malformed files
    }
  }

  return results;
}
