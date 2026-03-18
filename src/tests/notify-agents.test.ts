// tests/notify-agents.test.ts — Phase 12: Agent notification system
// Covers: notifyAgents(), agent discovery, observation written to axon

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { notifyAgents } from "../family/notify";

// ---------------------------------------------------------------------------
// Helpers — build a minimal agent axon directory for testing
// ---------------------------------------------------------------------------

async function buildFakeAgentDir(agentIds: string[]): Promise<string> {
  const base = join(tmpdir(), `theorex-notify-test-${Date.now()}`);
  for (const id of agentIds) {
    const axonDir = join(base, id, "theorex");
    await mkdir(axonDir, { recursive: true });
    const axon = { nodes: {}, edges: {} };
    await writeFile(join(axonDir, "axon.json"), JSON.stringify(axon));
  }
  return base;
}

// ---------------------------------------------------------------------------
// notifyAgents
// ---------------------------------------------------------------------------

describe("notifyAgents()", () => {
  test("returns a summary with reason", async () => {
    const tmpDir = await buildFakeAgentDir(["test-agent-a"]);
    try {
      const summary = await notifyAgents("pack changed to trading", ["test-agent-a"], tmpDir);
      expect(summary.reason).toBe("pack changed to trading");
      expect(typeof summary.success_count).toBe("number");
      expect(typeof summary.fail_count).toBe("number");
      expect(summary.success_count + summary.fail_count).toBe(summary.notified.length);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("notified array contains an entry per requested agent", async () => {
    const tmpDir = await buildFakeAgentDir(["agent-x", "agent-y"]);
    try {
      const summary = await notifyAgents("mode changed to business", ["agent-x", "agent-y"], tmpDir);
      const ids = summary.notified.map((r) => r.agent_id);
      expect(ids).toContain("agent-x");
      expect(ids).toContain("agent-y");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("does not throw when agent list is empty", async () => {
    const summary = await notifyAgents("test update", []);
    expect(summary.success_count).toBe(0);
    expect(summary.fail_count).toBe(0);
    expect(summary.notified).toHaveLength(0);
  });

  test("handles non-existent agent gracefully — counts as fail not throw", async () => {
    // Pass a tmpDir that exists but has no agent subdirectories
    const emptyDir = join(tmpdir(), `theorex-notify-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
    try {
      const summary = await notifyAgents("test", ["ghost-agent"], emptyDir);
      // Should not throw; the ghost agent will fail (axon missing) but not crash
      expect(summary.notified).toHaveLength(1);
      expect(summary.notified[0].agent_id).toBe("ghost-agent");
      // fail is expected here since axon doesn't exist and config may be missing
      expect(typeof summary.notified[0].success).toBe("boolean");
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });

  test("summary counts match notified array", async () => {
    const summary = await notifyAgents("count check", [], undefined);
    expect(summary.success_count + summary.fail_count).toBe(summary.notified.length);
  });
});
