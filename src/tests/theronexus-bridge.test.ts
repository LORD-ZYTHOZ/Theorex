// theronexus-bridge.test.ts — Phase 7.5

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeWithTheronexus } from "../code/theronexus-bridge";
import { DEFAULT_CONFIG } from "../config";

describe("analyzeWithTheronexus", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "theorex-theronexus-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns a valid status without throwing", async () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      agentAxonDir: join(tmpDir, "agents"),
      coldStorePath: join(tmpDir, "cold.db"),
    };

    // Use 500ms timeout so it fails fast in CI / offline
    const result = await analyzeWithTheronexus("main", tmpDir, cfg, Date.now(), 500);

    expect(["indexed", "refreshed", "unavailable", "failed"]).toContain(result.status);
    expect(result.dir).toBe(tmpDir);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.message).toBe("string");
  }, 10_000);

  test("writes marker node to agent axon regardless of theronexus outcome", async () => {
    const agentsDir = join(tmpDir, "agents");
    await mkdir(agentsDir, { recursive: true });

    const cfg = {
      ...DEFAULT_CONFIG,
      agentAxonDir: agentsDir,
      coldStorePath: join(tmpDir, "cold.db"),
    };

    // Short timeout so npx doesn't hang
    await analyzeWithTheronexus("main", tmpDir, cfg, Date.now(), 500);

    const { AxonStore } = await import("../axon/store");
    const { agentAxonPath } = await import("../family/paths");
    const axonPath = agentAxonPath("main", agentsDir);

    const store = await AxonStore.load(axonPath);
    const nodes = store.graph.nodes().map((k) => store.graph.getNodeAttributes(k));
    const marker = nodes.find((n) => n.surface_form.startsWith("theronexus:"));

    expect(marker).not.toBeUndefined();
    expect(marker!.node_type).toBe("code_function");
    expect(["theronexus_indexed", "theronexus_failed"]).toContain(marker!.observation_type);
  }, 10_000);
});
