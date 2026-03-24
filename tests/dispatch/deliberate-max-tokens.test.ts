// tests/dispatch/deliberate-max-tokens.test.ts — Verify DispatchTask supports max_tokens override.

import { describe, test, expect } from "bun:test";
import type { DispatchTask } from "../../src/dispatch/worker";

describe("DispatchTask max_tokens", () => {
  test("DispatchTask accepts optional max_tokens field", () => {
    const task: DispatchTask = {
      id: "test-1",
      agent_id: "main",
      task: "summarize trades",
      context_pct: 60,
      query_tokens: 200,
      tags: ["deliberation"],
      created_at: new Date().toISOString(),
      max_tokens: 4096,
    };

    expect(task.max_tokens).toBe(4096);
  });

  test("DispatchTask max_tokens is optional (defaults to undefined)", () => {
    const task: DispatchTask = {
      id: "test-2",
      agent_id: "main",
      task: "summarize trades",
      context_pct: 60,
      query_tokens: 200,
      tags: ["deliberation"],
      created_at: new Date().toISOString(),
    };

    expect(task.max_tokens).toBeUndefined();
  });
});
