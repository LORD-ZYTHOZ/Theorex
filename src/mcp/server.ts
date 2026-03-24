// mcp/server.ts — MCP (Model Context Protocol) HTTP server for Theorex.
// Exposes axon memory as JSON-RPC 2.0 resources and tools.
// Phase 19: external tools can access memory without direct axon coupling.

import { AxonStore } from "../axon/store";
import { agentAxonPath } from "../family/paths";
import { loadConfig } from "../config";
import { writeToAgent } from "../family/write";
import {
  deliberateToolDef,
  deliberationHistoryToolDef,
  handleDeliberateTool,
  handleDeliberationHistoryTool,
} from "../deliberate/mcp";

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
  host: "127.0.0.1",
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
  const config = await loadConfig();
  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  const store = await AxonStore.load(axonPath);

  const activeNodes = store.graph.nodes()
    .map((key) => store.graph.getNodeAttributes(key))
    .filter((attrs) => attrs.relevance_tier === "ACTIVE")
    .sort((a, b) => b.importance_weight - a.importance_weight)
    .slice(0, 30);

  const lines: string[] = [
    `# Theorex Boot Context — Agent: ${agentId}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Active Concepts",
    "",
  ];

  for (const attrs of activeNodes) {
    lines.push(`- **${attrs.surface_form}** (weight: ${attrs.importance_weight.toFixed(2)}, seen: ${attrs.last_seen.slice(0, 10)})`);
  }

  const bootText = lines.join("\n");
  const contents = [{
    uri: `theorex://agent/${agentId}/boot`,
    mimeType: "text/plain",
    text: bootText,
  }];
  return makeResult(id, { contents });
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
      description: "Semantic search over an agent's axon concepts",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent ID (default: main)" },
          query: { type: "string", description: "Search query" },
          top_k: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "status",
      description: "Health check — returns server version",
      inputSchema: { type: "object", properties: {} },
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

  const content = [{
    type: "text",
    text: JSON.stringify(matches, null, 2),
  }];
  return makeResult(id, { content });
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
