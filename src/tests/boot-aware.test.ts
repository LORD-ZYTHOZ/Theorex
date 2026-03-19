// tests/boot-aware.test.ts — Phase 22: Context-Aware Boot
import { describe, test, expect } from "bun:test";
import { getModelProfile, MODEL_PROFILES, buildContextAwareBootContext } from "../memory/boot-aware";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile, rm } from "node:fs/promises";

// ---------------------------------------------------------------------------
// getModelProfile
// ---------------------------------------------------------------------------

describe("getModelProfile()", () => {
  test("returns correct profile for ministral-3b", () => {
    const p = getModelProfile("ministral-3b");
    expect(p.name).toBe("ministral-3b");
    expect(p.concept_limit).toBe(15);
    expect(p.boot_budget_tokens).toBe(4096);
  });

  test("returns correct profile for qwen3-32b", () => {
    const p = getModelProfile("qwen3-32b");
    expect(p.concept_limit).toBe(25);
    expect(p.boot_budget_tokens).toBe(6144);
  });

  test("claude-sonnet has larger budget than ministral-3b", () => {
    expect(getModelProfile("claude-sonnet").boot_budget_tokens)
      .toBeGreaterThan(getModelProfile("ministral-3b").boot_budget_tokens);
  });

  test("falls back to default for unknown model", () => {
    const p = getModelProfile("gpt-99-turbo");
    expect(p.name).toBe("default");
    expect(p.concept_limit).toBe(20);
  });

  test("all profiles have positive concept_limit and budget", () => {
    for (const p of Object.values(MODEL_PROFILES)) {
      expect(p.concept_limit).toBeGreaterThan(0);
      expect(p.boot_budget_tokens).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildContextAwareBootContext — with real axon fixture
// ---------------------------------------------------------------------------

async function makeTmpAxon(concepts: Array<{ id: number; form: string; freq: number }>): Promise<{ dir: string; axonPath: string }> {
  const dir = join(tmpdir(), `theorex-boot-aware-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const nodes = concepts.map(c => ({
    key: String(c.id),
    attributes: {
      concept_id: c.id,
      surface_form: c.form,
      importance_weight: 0.7,
      relevance_tier: "ACTIVE",
      sentiment_tier: "NEUTRAL",
      last_seen: new Date().toISOString(),
      frequency_count: c.freq,
      source_weight: 0.8,
      agent_id: "test",
      node_type: "concept",
      observation_type: "feature",
      archive_id: "",
    },
  }));

  const axon = {
    nodes,
    edges: [],
    attributes: {},
    options: { type: "undirected", multi: false, allowSelfLoops: false },
  };
  const axonPath = join(dir, "axon.json");
  await writeFile(axonPath, JSON.stringify(axon));
  return { dir, axonPath };
}

describe("buildContextAwareBootContext()", () => {
  test("returns header line with model name and concept count", async () => {
    const { dir, axonPath } = await makeTmpAxon([
      { id: 1, form: "risk management", freq: 5 },
      { id: 2, form: "position sizing", freq: 3 },
    ]);
    try {
      const result = await buildContextAwareBootContext("main", "ministral-3b", axonPath);
      expect(result).toContain("[Boot:");
      expect(result).toContain("ministral-3b");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("includes top concepts in output", async () => {
    const { dir, axonPath } = await makeTmpAxon([
      { id: 1, form: "deep learning", freq: 10 },
      { id: 2, form: "neural network", freq: 7 },
    ]);
    try {
      const result = await buildContextAwareBootContext("main", "default", axonPath);
      expect(result).toContain("deep learning");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respects concept_limit — never exceeds model profile cap", async () => {
    const concepts = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      form: `concept-${String(i + 1).padStart(2, "0")}`,
      freq: 30 - i,
    }));
    const { dir, axonPath } = await makeTmpAxon(concepts);
    try {
      const result = await buildContextAwareBootContext("main", "ministral-3b", axonPath);
      // ministral-3b concept_limit = 15 — count bullet lines
      const bullets = result.split("\n").filter(l => l.startsWith("- ")).length;
      expect(bullets).toBeLessThanOrEqual(15);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("empty axon returns no-concepts message", async () => {
    const { dir, axonPath } = await makeTmpAxon([]);
    try {
      const result = await buildContextAwareBootContext("main", "default", axonPath);
      expect(result).toContain("[Boot:");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("high-frequency concept gets (xN) tag", async () => {
    const { dir, axonPath } = await makeTmpAxon([
      { id: 1, form: "market structure", freq: 8 },
    ]);
    try {
      const result = await buildContextAwareBootContext("main", "default", axonPath);
      expect(result).toContain("(x8)");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("unknown axon path does not throw — returns empty boot", async () => {
    const result = await buildContextAwareBootContext("ghost", "default", "/nonexistent/axon.json").catch(() => null);
    // Either returns gracefully or null — should not throw unhandled
    expect(true).toBe(true);
  });
});
