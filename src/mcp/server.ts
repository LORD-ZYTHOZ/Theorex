// mcp/server.ts — MCP (Model Context Protocol) HTTP server for Theorex.
// Exposes axon memory as JSON-RPC 2.0 resources and tools.
// Phase 19: external tools can access memory without direct axon coupling.
// Phase 7.5: Theronexus structural code intelligence tools added inline —
//   all queries run against the local .gitnexus/ index, nothing leaves the machine.

import { AxonStore } from "../axon/store";
import { PostgresStore, isPostgresEnabled } from "../axon/postgres-store";
import { agentAxonPath } from "../family/paths";
import { loadConfig } from "../config";
import { writeToAgent } from "../family/write";
import { processText } from "../compose";
import { embedText } from "../rag/ollama-embedder";
import { expandQuery } from "../rag/query-expander";
import { compressedSearch } from "../rag/compressed-search";
import { rrfFuse } from "../rag/rrf-fusion";
import type { RankedResult } from "../rag/rrf-fusion";
import { getState } from "../web/state";
import {
  deliberateToolDef,
  deliberationHistoryToolDef,
  handleDeliberateTool,
  handleDeliberationHistoryTool,
} from "../deliberate/mcp";
import { extractAndSaveProfiles } from "../evolve/profile-extractor";
import type { ProfileExtractionInput } from "../evolve/profile-extractor";
import { summarizeAndSaveSession } from "../evolve/session-summarizer";
import type { SessionSummaryInput } from "../evolve/session-summarizer";
import { extractAndSaveProcedures, refineProcedure } from "../evolve/procedure-extractor";
import type { ProcedureExtractionInput } from "../evolve/procedure-extractor";
import { runMetaReview } from "../evolve/meta-review";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  readonly port: number;   // default 18800
  readonly host: string;   // default "127.0.0.1"
  readonly agentId: string; // default "main"
}

const DEFAULT_MCP_CONFIG: McpServerConfig = {
  port: 18800,
  host: "0.0.0.0",
  agentId: "main",
};

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
}

function makeResult(id: string | number | null, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function makeError(id: string | number | null, code: number, message: string): Response {
  const err: JsonRpcError = { code, message };
  return Response.json({ jsonrpc: "2.0", id, error: err });
}

// ---------------------------------------------------------------------------
// Resource handlers
// ---------------------------------------------------------------------------

async function handleResourcesList(id: string | number | null): Promise<Response> {
  const resources = [
    {
      uri: "theorex://agent/{agentId}/concepts",
      name: "Agent concepts",
      description: "Top 20 ACTIVE-tier concepts for an agent",
      mimeType: "application/json",
    },
    {
      uri: "theorex://agent/{agentId}/boot",
      name: "Agent boot context",
      description: "Boot context string for an agent (Markdown)",
      mimeType: "text/plain",
    },
  ];
  return makeResult(id, { resources });
}

async function handleResourcesRead(
  id: string | number | null,
  params: Record<string, unknown>,
): Promise<Response> {
  const uri = typeof params.uri === "string" ? params.uri : "";

  // theorex://agent/{id}/concepts
  const conceptsMatch = uri.match(/^theorex:\/\/agent\/([^/]+)\/concepts$/);
  if (conceptsMatch) {
    const agentId = conceptsMatch[1]!;
    return await readConceptsResource(id, agentId);
  }

  // theorex://agent/{id}/boot
  const bootMatch = uri.match(/^theorex:\/\/agent\/([^/]+)\/boot$/);
  if (bootMatch) {
    const agentId = bootMatch[1]!;
    return await readBootResource(id, agentId);
  }

  return makeError(id, -32602, `Unknown resource URI: ${uri}`);
}

async function readConceptsResource(
  id: string | number | null,
  agentId: string,
): Promise<Response> {
  const config = await loadConfig();
  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  const store = await AxonStore.load(axonPath);

  const nodes = store.graph.nodes()
    .map((key) => store.graph.getNodeAttributes(key))
    .filter((attrs) => attrs.relevance_tier !== "SLEEPING")
    .sort((a, b) => b.importance_weight - a.importance_weight)
    .slice(0, 20)
    .map((attrs) => ({
      concept_id: attrs.concept_id,
      surface_form: attrs.surface_form,
      importance_weight: attrs.importance_weight,
      relevance_tier: attrs.relevance_tier,
      frequency_count: attrs.frequency_count,
      last_seen: attrs.last_seen,
      observation_type: attrs.observation_type,
    }));

  const contents = [{
    uri: `theorex://agent/${agentId}/concepts`,
    mimeType: "application/json",
    text: JSON.stringify(nodes, null, 2),
  }];
  return makeResult(id, { contents });
}

async function readBootResource(
  id: string | number | null,
  agentId: string,
): Promise<Response> {
  const lines: string[] = [
    `# Theorex Boot Context — Agent: ${agentId}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Active Concepts",
    "",
  ];

  if (isPostgresEnabled()) {
    const pgStore = new PostgresStore(agentId);
    try {
      await appendPostgresBootSections(lines, pgStore, agentId);
    } finally {
      await pgStore.close();
    }
  } else {
    await appendFileBootSection(lines, agentId);
  }

  const bootText = lines.join("\n");
  const contents = [{
    uri: `theorex://agent/${agentId}/boot`,
    mimeType: "text/plain",
    text: bootText,
  }];
  return makeResult(id, { contents });
}

async function appendFileBootSection(lines: string[], agentId: string): Promise<void> {
  const config = await loadConfig();
  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  const store = await AxonStore.load(axonPath);

  const activeNodes = store.graph.nodes()
    .map((key) => store.graph.getNodeAttributes(key))
    .filter((attrs) => attrs.relevance_tier === "ACTIVE")
    .sort((a, b) => b.importance_weight - a.importance_weight)
    .slice(0, 30);

  for (const attrs of activeNodes) {
    lines.push(`- **${attrs.surface_form}** (weight: ${attrs.importance_weight.toFixed(2)}, seen: ${attrs.last_seen.slice(0, 10)})`);
  }
}

async function appendPostgresBootSections(
  lines: string[],
  pgStore: PostgresStore,
  agentId: string,
): Promise<void> {
  // Fetch concepts, profiles, sessions in parallel
  const [concepts, profiles, sessions] = await Promise.all([
    pgStore.search("", undefined, { agentFilter: agentId, limit: 30 }),
    pgStore.getAllProfiles(),
    pgStore.getRecentSessionSummaries(3),
  ]);

  for (const c of concepts) {
    lines.push(`- **${c.label}** (type: ${c.memory_type}, weight: ${c.score.toFixed(2)})`);
  }

  if (profiles.length > 0) {
    lines.push("", "## Agent Profiles", "");
    for (const p of profiles) {
      lines.push(`### ${p.subject}`);
      lines.push(JSON.stringify(p.traits, null, 2));
    }
  }

  if (sessions.length > 0) {
    lines.push("", "## Recent Sessions", "");
    for (const s of sessions) {
      const decisions = s.keyDecisions
        .filter((d): d is string => typeof d === "string")
        .join(", ");
      lines.push(`- **${s.sessionId}**: ${s.summary} | Decisions: ${decisions}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Theronexus — local CLI runner
// Shells out to npx gitnexus@latest (reads local .gitnexus/ index only)
// ---------------------------------------------------------------------------

async function runTheronexusCli(args: string[]): Promise<unknown> {
  const proc = Bun.spawn(
    ["npx", "-y", "gitnexus@latest", ...args],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env } },
  );
  const [exitCode, rawOut] = await Promise.all([
    proc.exited,
    new Response(proc.stdout as ReadableStream).text(),
  ]);
  if (exitCode !== 0) {
    const err = await new Response(proc.stderr as ReadableStream).text();
    throw new Error(err.slice(0, 300) || `exited ${exitCode}`);
  }
  try {
    return JSON.parse(rawOut);
  } catch {
    return { text: rawOut.trim() };
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function handleToolsList(id: string | number | null): Response {
  const tools = [
    {
      name: "synthesize",
      description: "Write an observation to an agent's axon",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent ID (default: main)" },
          text: { type: "string", description: "Observation text to write" },
          type: { type: "string", description: "Observation type (optional)" },
        },
        required: ["text"],
      },
    },
    {
      name: "retrieve",
      description: "Semantic search over an agent's axon concepts. Use mode=deep for richer context (query expansion + multi-query RRF fusion).",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent ID (default: main)" },
          query: { type: "string", description: "Search query" },
          top_k: { type: "number", description: "Max results (default: 10)" },
          mode: { type: "string", enum: ["fast", "deep", "compressed"], description: "fast (default), deep (query expansion + RRF fusion), or compressed (TurboQuant two-stage search)" },
        },
        required: ["query"],
      },
    },
    {
      name: "status",
      description: "Health check — returns server version",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "theronexus_query",
      description: "Search Theronexus knowledge graph for execution flows related to a concept",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Concept or keyword to search for" },
        },
        required: ["query"],
      },
    },
    {
      name: "theronexus_context",
      description: "360-degree view of a code symbol — callers, callees, and execution flow participation",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Symbol name (function, class, method)" },
        },
        required: ["name"],
      },
    },
    {
      name: "theronexus_impact",
      description: "Blast radius analysis — what breaks if you change a symbol",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Symbol name to analyse" },
          direction: { type: "string", description: "upstream (callers) or downstream (callees), default: upstream" },
        },
        required: ["target"],
      },
    },
    {
      name: "theronexus_detect_changes",
      description: "Detect which symbols and execution flows are affected by current changes",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", description: "all | staged | compare (default: staged)" },
          base_ref: { type: "string", description: "Base git ref when scope=compare" },
        },
      },
    },
    {
      name: "push_task",
      description: "Push a task onto a named agent queue (singularity-tasks, horizon-tasks, divergence-tasks, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          queue: { type: "string", description: "Queue name (e.g. singularity-tasks)" },
          task_type: { type: "string", description: "Task type (e.g. ingest, review, notify)" },
          payload: { type: "object", description: "Task payload" },
          agent_id: { type: "string", description: "Agent ID (default: main)" },
        },
        required: ["queue", "task_type"],
      },
    },
    {
      name: "pop_task",
      description: "Pop the next pending task from a named queue",
      inputSchema: {
        type: "object",
        properties: {
          queue: { type: "string", description: "Queue name" },
          agent_id: { type: "string", description: "Agent ID (default: main)" },
        },
        required: ["queue"],
      },
    },
    {
      name: "extract_profile",
      description: "Extract and save agent profile traits from session context using LLM. Call after a meaningful session.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          recentConcepts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                memory_type: { type: "string" },
                meta: { type: "object" },
              },
            },
          },
          sessionNote: { type: "string", description: "Optional free-text summary of what happened" },
        },
        required: ["agentId", "recentConcepts"],
      },
    },
    {
      name: "summarize_session",
      description: "Summarize a session and save to session_summaries table.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          agentId: { type: "string" },
          concepts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                memory_type: { type: "string" },
              },
            },
          },
          notes: { type: "string" },
        },
        required: ["sessionId", "agentId", "concepts"],
      },
    },
    {
      name: "extract_procedure",
      description: "Extract step-by-step procedures from session context using LLM. Stores as concepts with memory_type=procedure.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          recentConcepts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                memory_type: { type: "string" },
                meta: { type: "object" },
              },
            },
          },
          sessionNote: { type: "string", description: "Optional free-text summary of what happened" },
        },
        required: ["agentId", "recentConcepts"],
      },
    },
    {
      name: "retrieve_procedure",
      description: "Retrieve saved procedures by name or list all procedures for an agent.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent ID (default: main)" },
          name: { type: "string", description: "Procedure name to retrieve. Omit to list all." },
          limit: { type: "number", description: "Max procedures to return (default: 50)" },
        },
      },
    },
    {
      name: "refine_procedure",
      description: "Refine an existing procedure based on outcome feedback. Compares feedback to current steps and saves improved version.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Procedure name to refine" },
          feedback: { type: "string", description: "Outcome feedback — what worked, what didn't, what to change" },
          agent_id: { type: "string", description: "Agent ID (default: main)" },
        },
        required: ["name", "feedback"],
      },
    },
    {
      name: "meta_review",
      description: "Run a meta-evolution cycle: analyze pipeline performance and propose scorer weight adjustments. Gated by policy system.",
      inputSchema: {
        type: "object",
        properties: {
          outcomes_dir: { type: "string", description: "Outcomes directory (default: data/outcomes)" },
        },
      },
    },
    deliberateToolDef(),
    deliberationHistoryToolDef(),
  ];
  return makeResult(id, { tools });
}

async function handleToolCall(
  id: string | number | null,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = typeof params.name === "string" ? params.name : "";
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  switch (name) {
    case "synthesize":
      return await callSynthesize(id, args);
    case "retrieve":
      return await callRetrieve(id, args);
    case "status":
      return callStatus(id);
    case "theronexus_query":
      return await callTheronexusQuery(id, args);
    case "theronexus_context":
      return await callTheronexusContext(id, args);
    case "theronexus_impact":
      return await callTheronexusImpact(id, args);
    case "theronexus_detect_changes":
      return await callTheronexusDetectChanges(id, args);
    case "push_task":
      return await callPushTask(id, args);
    case "pop_task":
      return await callPopTask(id, args);
    case "extract_profile":
      return await callExtractProfile(id, args);
    case "summarize_session":
      return await callSummarizeSession(id, args);
    case "extract_procedure":
      return await callExtractProcedure(id, args);
    case "retrieve_procedure":
      return await callRetrieveProcedure(id, args);
    case "refine_procedure":
      return await callRefineProcedure(id, args);
    case "meta_review":
      return await callMetaReview(id, args);
    case "deliberate":
      return makeResult(id, await handleDeliberateTool(args));
    case "deliberation_history":
      return makeResult(id, await handleDeliberationHistoryTool(args));
    default:
      return makeError(id, -32602, `Unknown tool: ${name}`);
  }
}

async function callSynthesize(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const text = typeof args.text === "string" ? args.text : "";
  if (!text) {
    return makeError(id, -32602, "Missing required argument: text");
  }
  const agentId = typeof args.agent_id === "string" ? args.agent_id : "main";
  const observationType = typeof args.type === "string" ? args.type : "";

  const config = await loadConfig();
  const result = await writeToAgent(agentId, text, config, Date.now(), observationType);

  // Also write to Postgres when enabled (fire-and-forget per-concept upsert)
  if (isPostgresEnabled()) {
    const timestamp = new Date().toISOString();
    const events = processText(text, 1.0, "concept", timestamp);
    const pgStore = new PostgresStore(agentId);
    const ids: string[] = [];
    for (const event of events) {
      const conceptId = await pgStore.mergeNode(event, observationType);
      ids.push(conceptId);
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await pgStore.mergeEdge(ids[i]!, ids[j]!);
      }
    }
    await pgStore.close();
  }

  const content = [{
    type: "text",
    text: `Written to ${agentId}: +${result.conceptsAdded} concepts, +${result.edgesAdded} edges`,
  }];
  return makeResult(id, { content });
}

async function callRetrieve(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query) {
    return makeError(id, -32602, "Missing required argument: query");
  }
  const agentId = typeof args.agent_id === "string" ? args.agent_id : "main";
  const topK = typeof args.top_k === "number" ? args.top_k : 10;
  const typeFilter = typeof args.type === "string" ? args.type : undefined;
  const mode = typeof args.mode === "string" ? args.mode : "fast";

  // --- Postgres path (THEOREX_STORAGE=postgres) ---
  if (isPostgresEnabled()) {
    if (mode === "compressed") {
      return await callRetrieveCompressed(id, query, agentId, topK);
    }
    const pgStore = new PostgresStore(agentId);
    try {
      if (mode === "deep") {
        return await callRetrieveDeep(id, pgStore, query, agentId, typeFilter, topK);
      }
      return await callRetrieveFast(id, pgStore, query, agentId, typeFilter, topK);
    } finally {
      await pgStore.close();
    }
  }

  // --- File path (fallback) ---
  const config = await loadConfig();
  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  const store = await AxonStore.load(axonPath);

  const queryLower = query.toLowerCase();
  const matches = store.graph.nodes()
    .map((key) => store.graph.getNodeAttributes(key))
    .filter((attrs) => attrs.relevance_tier !== "SLEEPING")
    .map((attrs) => {
      const text = attrs.surface_form.toLowerCase();
      const score = text.includes(queryLower) ? 1.0
        : queryLower.split(" ").some((w) => text.includes(w)) ? 0.5
        : 0;
      return { attrs, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.attrs.importance_weight - a.attrs.importance_weight)
    .slice(0, topK)
    .map((r) => ({
      concept_id: r.attrs.concept_id,
      surface_form: r.attrs.surface_form,
      score: r.score,
      importance_weight: r.attrs.importance_weight,
      relevance_tier: r.attrs.relevance_tier,
    }));

  const content = [{ type: "text", text: JSON.stringify(matches, null, 2) }];
  return makeResult(id, { content });
}

/**
 * Fast retrieval: single query, hybrid FTS+vector search.
 */
async function callRetrieveFast(
  id: string | number | null,
  pgStore: PostgresStore,
  query: string,
  agentId: string,
  typeFilter: string | undefined,
  topK: number,
): Promise<Response> {
  const embedding = await embedText(query);
  const results = await pgStore.search(query, embedding ?? undefined, {
    agentFilter: agentId,
    typeFilter,
    limit: topK,
  });
  const matches = results.map((r) => ({
    id: r.id,
    surface_form: r.label,
    body: r.body,
    memory_type: r.memory_type,
    score: r.score,
    meta: r.meta,
  }));
  return makeResult(id, { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] });
}

/**
 * Deep retrieval: query expansion via MiniMax → parallel multi-query search → RRF fusion.
 * Returns richer, more semantically diverse results at the cost of ~1-3s extra latency.
 */
async function callRetrieveDeep(
  id: string | number | null,
  pgStore: PostgresStore,
  query: string,
  agentId: string,
  typeFilter: string | undefined,
  topK: number,
): Promise<Response> {
  // Expand query + generate embeddings in parallel
  const [queries, baseEmbedding] = await Promise.all([
    expandQuery(query),
    embedText(query),
  ]);

  // Embed expanded queries in parallel (skip if same as base or embedding fails)
  const embeddings = await Promise.all(
    queries.map((q, i) => (i === 0 ? Promise.resolve(baseEmbedding) : embedText(q)))
  );

  // Search all query variants in parallel
  const resultLists = await Promise.all(
    queries.map((q, i) =>
      pgStore.search(q, embeddings[i] ?? undefined, {
        agentFilter: agentId,
        typeFilter,
        limit: topK,
      })
    )
  );

  // Cast to RankedResult and fuse via RRF
  const rankedLists: RankedResult[][] = resultLists.map((list) =>
    list.map((r) => ({
      id: r.id,
      label: r.label,
      body: r.body,
      memory_type: r.memory_type,
      agent_id: r.agent_id,
      meta: r.meta,
      score: r.score,
    }))
  );

  const fused = rrfFuse(rankedLists, topK);
  const matches = fused.map((r) => ({
    id: r.id,
    surface_form: r.label,
    body: r.body,
    memory_type: r.memory_type,
    score: r.score,
    meta: r.meta,
    _expanded_queries: queries,
  }));

  return makeResult(id, { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] });
}

/**
 * Compressed retrieval: TurboQuant two-stage search (Hamming pre-filter + cosine rerank).
 * No pgStore instance needed — compressed-search manages its own DB connection.
 */
async function callRetrieveCompressed(
  id: string | number | null,
  query: string,
  agentId: string,
  topK: number,
): Promise<Response> {
  const embedding = await embedText(query);
  if (!embedding) {
    return makeError(id, -32603, "Embedding failed — Ollama unavailable");
  }

  const queryVec = new Float32Array(embedding);
  const results = await compressedSearch(queryVec, { agentId, topK });

  const matches = results.map((r) => ({
    id: r.id,
    label: r.label,
    memory_type: r.memory_type,
    score: r.cosineScore,
    meta: r.meta,
    _hamming_score: r.hammingScore,
  }));

  return makeResult(id, { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] });
}

async function callPushTask(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const queue = typeof args.queue === "string" ? args.queue : "";
  const taskType = typeof args.task_type === "string" ? args.task_type : "";
  if (!queue || !taskType) return makeError(id, -32602, "Missing required: queue, task_type");
  const agentId = typeof args.agent_id === "string" ? args.agent_id : "main";
  const payload = (typeof args.payload === "object" && args.payload !== null)
    ? args.payload as Record<string, unknown>
    : {};

  const pgStore = new PostgresStore(agentId);
  try {
    const taskId = await pgStore.pushTask(queue, taskType, payload);
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ taskId, queue, taskType }) }] });
  } finally {
    await pgStore.close();
  }
}

async function callPopTask(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const queue = typeof args.queue === "string" ? args.queue : "";
  if (!queue) return makeError(id, -32602, "Missing required: queue");
  const agentId = typeof args.agent_id === "string" ? args.agent_id : "main";

  const pgStore = new PostgresStore(agentId);
  try {
    const task = await pgStore.popTask(queue);
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify(task ?? { empty: true }) }] });
  } finally {
    await pgStore.close();
  }
}

async function callTheronexusQuery(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query) return makeError(id, -32602, "Missing required argument: query");
  try {
    const result = await runTheronexusCli(["query", query]);
    try {
      const state = getState();
      const r = result as any;
      const defs: any[] = r.definitions ?? [];
      const procs: any[] = r.processes ?? [];
      for (const d of defs.slice(0, 20)) {
        if (d.id && d.name) state.touchNode(d.id, d.name, 0.05);
      }
      for (const p of procs) {
        const steps: any[] = p.steps ?? [];
        for (let i = 0; i < steps.length - 1; i++) {
          if (steps[i].id && steps[i + 1].id) state.strengthenEdge(steps[i].id, steps[i + 1].id);
        }
      }
    } catch {}
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    return makeError(id, -32603, `Theronexus query failed: ${String(err)}`);
  }
}

async function callTheronexusContext(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const name = typeof args.name === "string" ? args.name : "";
  if (!name) return makeError(id, -32602, "Missing required argument: name");
  try {
    const result = await runTheronexusCli(["context", name]);
    try {
      const state = getState();
      const r = result as any;
      if (r.status === "found" && r.symbol) {
        state.touchNode(r.symbol.uid ?? name, r.symbol.name, 0.10);
        for (const c of (r.incoming?.calls ?? [])) {
          if (c.uid) state.strengthenEdge(c.uid, r.symbol.uid ?? name);
        }
        for (const c of (r.outgoing?.calls ?? [])) {
          if (c.uid) state.strengthenEdge(r.symbol.uid ?? name, c.uid);
        }
      }
    } catch {}
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    return makeError(id, -32603, `Theronexus context failed: ${String(err)}`);
  }
}

async function callTheronexusImpact(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const target = typeof args.target === "string" ? args.target : "";
  if (!target) return makeError(id, -32602, "Missing required argument: target");
  const direction = typeof args.direction === "string" ? args.direction : "upstream";
  try {
    const result = await runTheronexusCli(["impact", target, "--direction", direction]);
    try {
      const state = getState();
      const r = result as any;
      if (r.target) state.touchNode(r.target.id ?? target, r.target.name ?? target, 0.15);
    } catch {}
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    return makeError(id, -32603, `Theronexus impact failed: ${String(err)}`);
  }
}

async function callTheronexusDetectChanges(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const scope = typeof args.scope === "string" ? args.scope : "staged";
  const cliArgs = ["detect-changes", "--scope", scope];
  if (scope === "compare" && typeof args.base_ref === "string") {
    cliArgs.push("--base-ref", args.base_ref);
  }
  try {
    const result = await runTheronexusCli(cliArgs);
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    return makeError(id, -32603, `Theronexus detect-changes failed: ${String(err)}`);
  }
}

async function callExtractProfile(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const agentId = typeof args.agentId === "string" ? args.agentId : "";
  if (!agentId) return makeError(id, -32602, "Missing required argument: agentId");

  const rawConcepts = Array.isArray(args.recentConcepts) ? args.recentConcepts : [];
  const recentConcepts = rawConcepts.map((c) => {
    const obj = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    return {
      label: typeof obj.label === "string" ? obj.label : "",
      memory_type: typeof obj.memory_type === "string" ? obj.memory_type : "fact",
      meta: (typeof obj.meta === "object" && obj.meta !== null ? obj.meta : {}) as Record<string, unknown>,
    };
  });
  const sessionNote = typeof args.sessionNote === "string" ? args.sessionNote : undefined;

  const input: ProfileExtractionInput = { agentId, recentConcepts, sessionNote };
  const pgStore = new PostgresStore(agentId);
  try {
    const profiles = await extractAndSaveProfiles(input, pgStore);
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ profiles }) }] });
  } catch (err) {
    return makeError(id, -32603, `Profile extraction failed: ${String(err)}`);
  } finally {
    await pgStore.close();
  }
}

async function callSummarizeSession(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
  const agentId = typeof args.agentId === "string" ? args.agentId : "";
  if (!sessionId) return makeError(id, -32602, "Missing required argument: sessionId");
  if (!agentId) return makeError(id, -32602, "Missing required argument: agentId");

  const rawConcepts = Array.isArray(args.concepts) ? args.concepts : [];
  const concepts = rawConcepts.map((c) => {
    const obj = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    return {
      label: typeof obj.label === "string" ? obj.label : "",
      memory_type: typeof obj.memory_type === "string" ? obj.memory_type : "fact",
    };
  });
  const notes = typeof args.notes === "string" ? args.notes : undefined;

  const input: SessionSummaryInput = { sessionId, agentId, concepts, notes };
  const pgStore = new PostgresStore(agentId);
  try {
    const result = await summarizeAndSaveSession(input, pgStore);
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch (err) {
    return makeError(id, -32603, `Session summarization failed: ${String(err)}`);
  } finally {
    await pgStore.close();
  }
}

async function callExtractProcedure(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const agentId = typeof args.agentId === "string" ? args.agentId : "";
  if (!agentId) return makeError(id, -32602, "Missing required argument: agentId");

  const rawConcepts = Array.isArray(args.recentConcepts) ? args.recentConcepts : [];
  const recentConcepts = rawConcepts.map((c) => {
    const obj = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    return {
      label: typeof obj.label === "string" ? obj.label : "",
      memory_type: typeof obj.memory_type === "string" ? obj.memory_type : "fact",
      meta: (typeof obj.meta === "object" && obj.meta !== null ? obj.meta : {}) as Record<string, unknown>,
    };
  });
  const sessionNote = typeof args.sessionNote === "string" ? args.sessionNote : undefined;

  const input: ProcedureExtractionInput = { agentId, recentConcepts, sessionNote };
  const pgStore = new PostgresStore(agentId);
  try {
    const procedures = await extractAndSaveProcedures(input, pgStore);
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ procedures }) }] });
  } catch (err) {
    return makeError(id, -32603, `Procedure extraction failed: ${String(err)}`);
  } finally {
    await pgStore.close();
  }
}

async function callRetrieveProcedure(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const agentId = typeof args.agent_id === "string" ? args.agent_id : "main";
  const name = typeof args.name === "string" ? args.name : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 50;

  const pgStore = new PostgresStore(agentId);
  try {
    if (name) {
      const procedure = await pgStore.getProcedure(name);
      if (!procedure) {
        return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ error: "Procedure not found", name }) }] });
      }
      return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ procedure }) }] });
    }
    const procedures = await pgStore.getAllProcedures(limit);
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ procedures }) }] });
  } catch (err) {
    return makeError(id, -32603, `Procedure retrieval failed: ${String(err)}`);
  } finally {
    await pgStore.close();
  }
}

async function callRefineProcedure(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const name = typeof args.name === "string" ? args.name : "";
  const feedback = typeof args.feedback === "string" ? args.feedback : "";
  if (!name) return makeError(id, -32602, "Missing required argument: name");
  if (!feedback) return makeError(id, -32602, "Missing required argument: feedback");

  const agentId = typeof args.agent_id === "string" ? args.agent_id : "main";
  const pgStore = new PostgresStore(agentId);
  try {
    const refined = await refineProcedure(name, feedback, pgStore);
    if (!refined) {
      return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ error: "Procedure not found or refinement failed", name }) }] });
    }
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ refined }) }] });
  } catch (err) {
    return makeError(id, -32603, `Procedure refinement failed: ${String(err)}`);
  } finally {
    await pgStore.close();
  }
}

async function callMetaReview(
  id: string | number | null,
  args: Record<string, unknown>,
): Promise<Response> {
  const outcomesDir = typeof args.outcomes_dir === "string" ? args.outcomes_dir : undefined;
  try {
    const result = await runMetaReview(outcomesDir);
    if (!result) {
      return makeResult(id, { content: [{ type: "text", text: JSON.stringify({ error: "Meta-review failed (LLM unavailable or parse error)" }) }] });
    }
    return makeResult(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch (err) {
    return makeError(id, -32603, `Meta-review failed: ${String(err)}`);
  }
}

function callStatus(id: string | number | null): Response {
  const content = [{
    type: "text",
    text: JSON.stringify({ ok: true, version: "theorex/1.0" }),
  }];
  return makeResult(id, { content });
}

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

async function handleMcpRequest(body: unknown): Promise<Response> {
  let req: JsonRpcRequest;
  try {
    req = body as JsonRpcRequest;
    if (!req.method) throw new Error("missing method");
  } catch {
    return makeError(null, -32600, "Invalid Request");
  }

  const { id, method, params = {} } = req;

  switch (method) {
    case "resources/list":
      return await handleResourcesList(id);
    case "resources/read":
      return await handleResourcesRead(id, params);
    case "tools/list":
      return handleToolsList(id);
    case "tools/call":
      return await handleToolCall(id, params);
    default:
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export function startMcpServer(
  config?: Partial<McpServerConfig>,
): ReturnType<typeof Bun.serve> {
  const cfg: McpServerConfig = { ...DEFAULT_MCP_CONFIG, ...config };

  return Bun.serve({
    port: cfg.port,
    hostname: cfg.host,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/mcp" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return makeError(null, -32700, "Parse error");
        }
        return await handleMcpRequest(body);
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true, version: "theorex/1.0" });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

// ---------------------------------------------------------------------------
// Stdio transport — used by Claude Code MCP plugin (reads stdin, writes stdout)
// ---------------------------------------------------------------------------

async function handleMcpRequestRaw(body: unknown): Promise<object | null> {
  const req = body as Record<string, unknown>;
  const id = req.id ?? null;

  // MCP handshake
  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "theorex", version: "1.0" },
      },
    };
  }
  // Notification — no response
  if (typeof req.method === "string" && req.method.startsWith("notifications/")) {
    return null;
  }

  const resp = await handleMcpRequest(body);
  return await resp.json() as object;
}

export async function startMcpStdio(): Promise<void> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const body = JSON.parse(trimmed);
        const result = await handleMcpRequestRaw(body);
        if (result !== null) {
          process.stdout.write(JSON.stringify(result) + "\n");
        }
      } catch {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0", id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n");
      }
    }
  }
}
