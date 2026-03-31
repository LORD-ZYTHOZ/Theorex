/**
 * server-tool-handlers.test.ts — Tool handler integration tests for Stage 3D-2.
 *
 * Verifies that `extract_profile` and `summarize_session` tool handlers:
 *   1. Return a well-formed MCP content envelope on success.
 *   2. Return a JSON-RPC error response (not an unhandled rejection) on failure.
 *
 * All external I/O is mocked; no real DB or LLM calls are made.
 *
 * NOTE: mock.module calls must appear before any imports of the mocked modules
 * so they are resolved first by Bun's module registry. This is why these tests
 * live in a separate file from server.test.ts.
 */

// ---- Mocks must be declared before any import of the mocked modules ----

import { mock, describe, test, expect, beforeEach, afterEach } from "bun:test";

// Mock evolve modules so no LLM or DB calls are made
mock.module("../evolve/profile-extractor", () => ({
  extractAndSaveProfiles: mock(() =>
    Promise.resolve([{ subject: "test_subject", traits: { skill: "breakout" } }])
  ),
}));

mock.module("../evolve/session-summarizer", () => ({
  summarizeAndSaveSession: mock(() =>
    Promise.resolve({ summary: "Productive session.", keyDecisions: ["hold winners"] })
  ),
}));

// Stub PostgresStore so no real DB connection is attempted
mock.module("../axon/postgres-store", () => ({
  PostgresStore: class {
    constructor(_agentId: string) {}
    async close(): Promise<void> {}
    async search() { return []; }
    async getAllProfiles() { return []; }
    async getRecentSessionSummaries() { return []; }
    async mergeNode() { return "node-id"; }
    async mergeEdge() {}
    async pushTask() { return "task-id"; }
    async popTask() { return null; }
  },
  isPostgresEnabled: () => false,
  createStore: (_agentId: string) => ({}),
}));

// Also mock other modules that server.ts imports and may attempt real I/O
mock.module("../config", () => ({
  loadConfig: mock(() => Promise.resolve({ agentAxonDir: "/tmp/test-axon" })),
}));

mock.module("../axon/store", () => ({
  AxonStore: {
    load: mock(() =>
      Promise.resolve({
        graph: {
          nodes: () => [],
          getNodeAttributes: (_k: string) => ({}),
        },
      })
    ),
  },
}));

mock.module("../web/state", () => ({
  getState: mock(() => ({
    touchNode: () => {},
    strengthenEdge: () => {},
  })),
}));

mock.module("../deliberate/mcp", () => ({
  deliberateToolDef: () => ({
    name: "deliberate",
    description: "stub",
    inputSchema: { type: "object", properties: {} },
  }),
  deliberationHistoryToolDef: () => ({
    name: "deliberation_history",
    description: "stub",
    inputSchema: { type: "object", properties: {} },
  }),
  handleDeliberateTool: mock(() => Promise.resolve({})),
  handleDeliberationHistoryTool: mock(() => Promise.resolve({})),
}));

// ---- Ports chosen to avoid conflicts with other test files ----
const EXTRACT_PORT = 19960;
const SUMMARIZE_PORT = 19961;

// ---- Helper ----
async function mcpPost(
  port: number,
  method: string,
  params: Record<string, unknown>,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return resp.json() as Promise<{ result?: unknown; error?: { code: number; message: string } }>;
}

// ---- Tests ----

describe("tool handler: extract_profile via HTTP", () => {
  let server: ReturnType<typeof import("./server").startMcpServer>;

  beforeEach(async () => {
    const { startMcpServer } = await import("./server");
    server = startMcpServer({ port: EXTRACT_PORT, host: "127.0.0.1", agentId: "test" });
  });

  afterEach(() => {
    server.stop(true);
  });

  test("success path returns profiles in MCP content envelope", async () => {
    const body = await mcpPost(EXTRACT_PORT, "tools/call", {
      name: "extract_profile",
      arguments: {
        agentId: "test-agent",
        recentConcepts: [{ label: "breakout", memory_type: "episode" }],
      },
    });

    expect(body.error).toBeUndefined();
    const result = body.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("profiles");
    expect(Array.isArray(parsed.profiles)).toBe(true);
    expect(parsed.profiles[0].subject).toBe("test_subject");
  });

  test("error path returns JSON-RPC -32603 when extractAndSaveProfiles throws", async () => {
    const extractMod = await import("../evolve/profile-extractor");
    (extractMod.extractAndSaveProfiles as ReturnType<typeof mock>).mockImplementationOnce(() =>
      Promise.reject(new Error("Postgres connection refused"))
    );

    const body = await mcpPost(EXTRACT_PORT, "tools/call", {
      name: "extract_profile",
      arguments: { agentId: "test-agent", recentConcepts: [] },
    });

    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe(-32603);
    expect(body.error!.message).toContain("Profile extraction failed");
    expect(body.error!.message).toContain("Postgres connection refused");
  });
});

describe("tool handler: summarize_session via HTTP", () => {
  let server: ReturnType<typeof import("./server").startMcpServer>;

  beforeEach(async () => {
    const { startMcpServer } = await import("./server");
    server = startMcpServer({ port: SUMMARIZE_PORT, host: "127.0.0.1", agentId: "test" });
  });

  afterEach(() => {
    server.stop(true);
  });

  test("success path returns summary and keyDecisions in MCP content envelope", async () => {
    const body = await mcpPost(SUMMARIZE_PORT, "tools/call", {
      name: "summarize_session",
      arguments: {
        sessionId: "sess-test",
        agentId: "test-agent",
        concepts: [{ label: "breakout", memory_type: "episode" }],
      },
    });

    expect(body.error).toBeUndefined();
    const result = body.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("keyDecisions");
    expect(parsed.summary).toBe("Productive session.");
    expect(parsed.keyDecisions).toEqual(["hold winners"]);
  });

  test("error path returns JSON-RPC -32603 when summarizeAndSaveSession throws", async () => {
    const summarizeMod = await import("../evolve/session-summarizer");
    (summarizeMod.summarizeAndSaveSession as ReturnType<typeof mock>).mockImplementationOnce(() =>
      Promise.reject(new Error("DB write failed"))
    );

    const body = await mcpPost(SUMMARIZE_PORT, "tools/call", {
      name: "summarize_session",
      arguments: { sessionId: "sess-err", agentId: "test-agent", concepts: [] },
    });

    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe(-32603);
    expect(body.error!.message).toContain("Session summarization failed");
    expect(body.error!.message).toContain("DB write failed");
  });
});
