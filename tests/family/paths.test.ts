import { test, expect } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentAxonPath, resolvedSharedAxonPath, sourceWeightForAgent, AGENT_SOURCE_WEIGHTS } from "../../src/family/paths";

test("agentAxonPath uses default ~/.openclaw/agents layout", () => {
  const path = agentAxonPath("main");
  expect(path).toBe(join(homedir(), ".openclaw", "agents", "main", "theorex", "axon.json"));
});

test("agentAxonPath respects custom agentAxonDir", () => {
  const path = agentAxonPath("nova", "/tmp/agents");
  expect(path).toBe("/tmp/agents/nova/theorex/axon.json");
});

test("resolvedSharedAxonPath uses default workspace layout", () => {
  const path = resolvedSharedAxonPath();
  expect(path).toBe(join(homedir(), ".openclaw", "workspace", "theorex", "shared-axon.json"));
});

test("resolvedSharedAxonPath respects custom path", () => {
  const path = resolvedSharedAxonPath("/tmp/shared-axon.json");
  expect(path).toBe("/tmp/shared-axon.json");
});

test("sourceWeightForAgent returns correct weights for known agents", () => {
  expect(sourceWeightForAgent("main")).toBe(0.7);
  expect(sourceWeightForAgent("qwen-sage")).toBe(0.8);
  expect(sourceWeightForAgent("claude-code-agent")).toBe(1.0);
  expect(sourceWeightForAgent("secretarius")).toBe(0.7);
});

test("sourceWeightForAgent falls back to 0.7 for unknown agents", () => {
  expect(sourceWeightForAgent("unknown-bot")).toBe(0.7);
  expect(sourceWeightForAgent("")).toBe(0.7);
});

test("AGENT_SOURCE_WEIGHTS covers all known OC agents", () => {
  const knownAgents = ["main", "qwen-sage", "secretarius", "claude-code-agent", "pi-coding-agent", "ag-coding-agent"];
  for (const agent of knownAgents) {
    expect(AGENT_SOURCE_WEIGHTS[agent]).toBeDefined();
  }
});
