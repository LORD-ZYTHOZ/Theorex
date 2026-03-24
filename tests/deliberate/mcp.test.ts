// tests/deliberate/mcp.test.ts — Tests for deliberation MCP tool definitions and handlers.

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deliberateToolDef,
  deliberationHistoryToolDef,
  handleDeliberateTool,
  handleDeliberationHistoryTool,
} from "../../src/deliberate/mcp";
import type { DeliberationRecord, SessionPacket } from "../../src/deliberate/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(overrides?: Partial<DeliberationRecord>): DeliberationRecord {
  const packet: SessionPacket = {
    date: "2026-03-24",
    session: "asian",
    perspectives: [],
    assembled_at: "2026-03-24T06:00:00Z",
  };
  return {
    id: "test-id-1",
    date: "2026-03-24",
    session: "asian",
    status: "complete",
    packet,
    prompt: "test prompt",
    response: "test response",
    model: "claude-sonnet-4-20250514",
    latency_ms: 500,
    created_at: "2026-03-24T06:00:00Z",
    completed_at: "2026-03-24T06:01:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe("deliberateToolDef", () => {
  test("returns valid tool definition with correct name", () => {
    const def = deliberateToolDef() as {
      name: string;
      description: string;
      inputSchema: { type: string; properties: Record<string, unknown>; required: string[] };
    };
    expect(def.name).toBe("deliberate");
    expect(def.description).toBeTruthy();
    expect(def.inputSchema.type).toBe("object");
  });

  test("has session and date as required inputs", () => {
    const def = deliberateToolDef() as {
      inputSchema: { required: string[] };
    };
    expect(def.inputSchema.required).toContain("session");
    expect(def.inputSchema.required).toContain("date");
  });

  test("has force as optional boolean input", () => {
    const def = deliberateToolDef() as {
      inputSchema: { properties: Record<string, { type: string }> };
    };
    expect(def.inputSchema.properties.force).toBeDefined();
    expect(def.inputSchema.properties.force.type).toBe("boolean");
  });
});

describe("deliberationHistoryToolDef", () => {
  test("returns valid tool definition with correct name", () => {
    const def = deliberationHistoryToolDef() as {
      name: string;
      description: string;
      inputSchema: { type: string };
    };
    expect(def.name).toBe("deliberation_history");
    expect(def.description).toBeTruthy();
    expect(def.inputSchema.type).toBe("object");
  });

  test("has no required inputs", () => {
    const def = deliberationHistoryToolDef() as {
      inputSchema: { required?: string[] };
    };
    // Either no required field or empty array
    expect(def.inputSchema.required ?? []).toEqual([]);
  });

  test("has since and session as optional inputs", () => {
    const def = deliberationHistoryToolDef() as {
      inputSchema: { properties: Record<string, { type: string }> };
    };
    expect(def.inputSchema.properties.since).toBeDefined();
    expect(def.inputSchema.properties.session).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// handleDeliberateTool
// ---------------------------------------------------------------------------

describe("handleDeliberateTool", () => {
  test("returns error for missing session", async () => {
    const result = await handleDeliberateTool({ date: "2026-03-24" });
    expect(result.content[0].text).toContain("session");
  });

  test("returns error for missing date", async () => {
    const result = await handleDeliberateTool({ session: "asian" });
    expect(result.content[0].text).toContain("date");
  });

  test("returns error for invalid session value", async () => {
    const result = await handleDeliberateTool({ session: "invalid", date: "2026-03-24" });
    expect(result.content[0].text).toContain("session");
  });

  test("returns formatted result for valid args", async () => {
    const result = await handleDeliberateTool({ session: "asian", date: "2026-03-24" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// handleDeliberationHistoryTool
// ---------------------------------------------------------------------------

describe("handleDeliberationHistoryTool", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "delib-mcp-test-"));

    // Write mock deliberation files
    const record1 = makeRecord({ date: "2026-03-22", session: "asian" });
    const record2 = makeRecord({ date: "2026-03-23", session: "london" });
    const record3 = makeRecord({ date: "2026-03-24", session: "asian" });

    await Bun.write(join(tmpDir, "2026-03-22-asian.json"), JSON.stringify(record1));
    await Bun.write(join(tmpDir, "2026-03-23-london.json"), JSON.stringify(record2));
    await Bun.write(join(tmpDir, "2026-03-24-asian.json"), JSON.stringify(record3));
    // non-json file should be ignored
    await Bun.write(join(tmpDir, "2026-03-24-asian.md"), "# some markdown");
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns all records when no filters", async () => {
    const result = await handleDeliberationHistoryTool({}, tmpDir);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(3);
  });

  test("filters by session", async () => {
    const result = await handleDeliberationHistoryTool({ session: "asian" }, tmpDir);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((r: { session: string }) => r.session === "asian")).toBe(true);
  });

  test("filters by since date", async () => {
    const result = await handleDeliberationHistoryTool({ since: "2026-03-23" }, tmpDir);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
  });

  test("filters by both since and session", async () => {
    const result = await handleDeliberationHistoryTool(
      { since: "2026-03-23", session: "asian" },
      tmpDir,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].date).toBe("2026-03-24");
  });

  test("returns empty array for empty directory", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "delib-mcp-empty-"));
    const result = await handleDeliberationHistoryTool({}, emptyDir);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(0);
    await rm(emptyDir, { recursive: true, force: true });
  });

  test("returns empty array for non-existent directory", async () => {
    const result = await handleDeliberationHistoryTool({}, "/tmp/nonexistent-delib-dir-xyz");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(0);
  });

  test("returns summaries not full records", async () => {
    const result = await handleDeliberationHistoryTool({}, tmpDir);
    const parsed = JSON.parse(result.content[0].text);
    // Should include summary fields
    expect(parsed[0]).toHaveProperty("date");
    expect(parsed[0]).toHaveProperty("session");
    expect(parsed[0]).toHaveProperty("status");
    // Should NOT include the full prompt/response (too verbose)
    expect(parsed[0]).not.toHaveProperty("prompt");
    expect(parsed[0]).not.toHaveProperty("response");
    expect(parsed[0]).not.toHaveProperty("packet");
  });
});
