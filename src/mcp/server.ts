// mcp/server.ts — MCP (Model Context Protocol) HTTP server for Theorex.
// Exposes axon memory as JSON-RPC 2.0 resources and tools.
// Phase 19: external tools can access memory without direct axon coupling.
// Phase 7.5: Theronexus structural code intelligence tools added inline —
//   all queries run against the local .gitnexus/ index, nothing leaves the machine.

import { AxonStore } from "../axon/store";
import { agentAxonPath } from "../family/paths";
import { loadConfig } from "../config";
import { writeToAgent } from "../family/write";
import { getState } from "../web/state";

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
