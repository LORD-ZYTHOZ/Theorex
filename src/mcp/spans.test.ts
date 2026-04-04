// src/mcp/spans.test.ts
import { describe, test, expect } from "bun:test";
import { handleSpanTool } from "./spans";

describe("handleSpanTool — emit-span", () => {
  test("returns span_id on valid input", async () => {
    const res = await handleSpanTool("emit-span", {
      agent_id: "test-agent",
      task_type: "test",
      prompt_sent: "test prompt",
      output_recv: "test output",
    });
    const body = await res.json() as { result?: { content?: Array<{ text: string }> } };
    const text = body.result?.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(typeof parsed.span_id).toBe("string");
  });

  test("returns error when agent_id missing", async () => {
    const res = await handleSpanTool("emit-span", { task_type: "test" });
    expect(res.status).toBe(200);
    const body = await res.json() as { error?: { message: string } };
    expect(body.error?.message).toContain("agent_id");
  });
});

describe("handleSpanTool — get-spans", () => {
  test("returns array for valid agent_id", async () => {
    const res = await handleSpanTool("get-spans", { agent_id: "test-agent" });
    const body = await res.json() as { result?: { content?: Array<{ text: string }> } };
    const text = body.result?.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed.spans)).toBe(true);
  });
});

describe("handleSpanTool — get-doom-loops", () => {
  test("returns doom loop analysis", async () => {
    const res = await handleSpanTool("get-doom-loops", {
      agent_id: "test-agent",
      task_type: "test",
    });
    const body = await res.json() as { result?: { content?: Array<{ text: string }> } };
    const text = body.result?.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(typeof parsed.is_doom_loop).toBe("boolean");
  });
});
