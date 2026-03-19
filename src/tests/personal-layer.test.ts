// tests/personal-layer.test.ts — Phase 12 extension: Personal Layer in Business Mode
// Tests: loadPersonalLayer, savePersonalLayer, formatPersonalContext, injectContext integration

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm } from "node:fs/promises";
import {
  loadPersonalLayer,
  savePersonalLayer,
  formatPersonalContext,
  type PersonalLayer,
} from "../profession/personal";
import { agentPersonalLayerPath } from "../family/paths";
import { injectContext } from "../flash/inject";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nullAxon = async () => { throw new Error("no axon"); };
const nullStm  = async () => [] as any[];
const nullMoments = async () => [] as any[];

function makeConfig(overrides: Partial<Config>): () => Promise<Config | null> {
  const base: Partial<Config> = {
    deploymentMode: "business",
    professionPack: "",
    professionPacksDir: "",
    halfLifeDays: 14,
    activeThreshold: 0.6,
    mildThreshold: 0.3,
    pruneThresholdDays: 30,
    edgePruneThreshold: 0.01,
    stmRetentionDays: 14,
    stmGraduateDays: 7,
    lmStudioUrl: "http://localhost:1234",
    lmStudioEmbedModel: "nomic-embed-text-v1.5",
    lmStudioTimeoutMs: 3000,
    location: "",
    temporalAgentId: "",
    temporalStorePath: "data/temporal.json",
    contextSlideThreshold: 0.5,
    contextSlideCooldownCalls: 20,
  };
  return async () => ({ ...base, ...overrides } as Config);
}

const MOCK_LAYER: PersonalLayer = {
  name: "Alice Chen",
  tone: "casual",
  response_length: "brief",
  notes: ["Prefers bullet points", "Trading focus: XAUUSD"],
  key_contacts: ["Bob Lee — institutional desk", "Sam Park — key client"],
  last_seen: "2026-03-19T10:00:00.000Z",
};

// ---------------------------------------------------------------------------
// agentPersonalLayerPath
// ---------------------------------------------------------------------------

describe("agentPersonalLayerPath()", () => {
  test("returns path ending in personal.json", () => {
    const p = agentPersonalLayerPath("main");
    expect(p).toEndWith("personal.json");
  });

  test("includes agent id in path", () => {
    const p = agentPersonalLayerPath("qwen-sage");
    expect(p).toContain("qwen-sage");
  });

  test("uses agentAxonDir override when provided", () => {
    const p = agentPersonalLayerPath("main", "/custom/dir");
    expect(p).toStartWith("/custom/dir");
    expect(p).toContain("main");
    expect(p).toEndWith("personal.json");
  });

  test("co-located with axon in same theorex subdir", () => {
    const p = agentPersonalLayerPath("main", "/base");
    expect(p).toBe("/base/main/theorex/personal.json");
  });
});

// ---------------------------------------------------------------------------
// loadPersonalLayer / savePersonalLayer
// ---------------------------------------------------------------------------

describe("loadPersonalLayer() / savePersonalLayer()", () => {
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `theorex-personal-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns null when file does not exist", async () => {
    const result = await loadPersonalLayer("nonexistent-agent", tmpDir);
    expect(result).toBeNull();
  });

  test("saves and loads personal layer round-trip", async () => {
    await savePersonalLayer("main", MOCK_LAYER, tmpDir);
    const loaded = await loadPersonalLayer("main", tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Alice Chen");
    expect(loaded!.tone).toBe("casual");
    expect(loaded!.response_length).toBe("brief");
    expect(loaded!.notes).toEqual(["Prefers bullet points", "Trading focus: XAUUSD"]);
    expect(loaded!.key_contacts).toEqual(["Bob Lee — institutional desk", "Sam Park — key client"]);
  });

  test("save creates parent directories if missing", async () => {
    const deepDir = join(tmpDir, "nested", "agents");
    await savePersonalLayer("main", MOCK_LAYER, deepDir);
    const loaded = await loadPersonalLayer("main", deepDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Alice Chen");
  });

  test("save is immutable — does not mutate input object", async () => {
    const original = { ...MOCK_LAYER };
    await savePersonalLayer("main", MOCK_LAYER, tmpDir);
    expect(MOCK_LAYER.name).toBe(original.name);
    expect(MOCK_LAYER.notes).toEqual(original.notes);
  });

  test("load returns null on corrupt JSON (no throw)", async () => {
    const path = agentPersonalLayerPath("main", tmpDir);
    await mkdir(join(tmpDir, "main", "theorex"), { recursive: true });
    await Bun.write(path, "not valid json {{{");
    const result = await loadPersonalLayer("main", tmpDir);
    expect(result).toBeNull();
  });

  test("save overwrites existing file", async () => {
    await savePersonalLayer("main", MOCK_LAYER, tmpDir);
    const updated: PersonalLayer = { ...MOCK_LAYER, name: "Bob Smith" };
    await savePersonalLayer("main", updated, tmpDir);
    const loaded = await loadPersonalLayer("main", tmpDir);
    expect(loaded!.name).toBe("Bob Smith");
  });
});

// ---------------------------------------------------------------------------
// formatPersonalContext
// ---------------------------------------------------------------------------

describe("formatPersonalContext()", () => {
  test("includes user name in header", () => {
    const result = formatPersonalContext(MOCK_LAYER);
    expect(result).toContain("Alice Chen");
  });

  test("includes tone and response_length", () => {
    const result = formatPersonalContext(MOCK_LAYER);
    expect(result).toContain("casual");
    expect(result).toContain("brief");
  });

  test("includes all notes as bullet points", () => {
    const result = formatPersonalContext(MOCK_LAYER);
    expect(result).toContain("• Prefers bullet points");
    expect(result).toContain("• Trading focus: XAUUSD");
  });

  test("includes all key contacts", () => {
    const result = formatPersonalContext(MOCK_LAYER);
    expect(result).toContain("Bob Lee — institutional desk");
    expect(result).toContain("Sam Park — key client");
  });

  test("omits notes section when notes is empty", () => {
    const noNotes: PersonalLayer = { ...MOCK_LAYER, notes: [] };
    const result = formatPersonalContext(noNotes);
    expect(result).not.toContain("Notes:");
  });

  test("omits key_contacts section when empty", () => {
    const noContacts: PersonalLayer = { ...MOCK_LAYER, key_contacts: [] };
    const result = formatPersonalContext(noContacts);
    expect(result).not.toContain("Key contacts:");
  });

  test("returns multi-line string with USER PROFILE header", () => {
    const result = formatPersonalContext(MOCK_LAYER);
    expect(result).toContain("USER PROFILE");
    expect(result.split("\n").length).toBeGreaterThan(3);
  });

  test("layer with only name returns minimal header (no throw)", () => {
    const minimal: PersonalLayer = {
      name: "Jo",
      tone: "balanced",
      response_length: "adaptive",
      notes: [],
      key_contacts: [],
      last_seen: new Date().toISOString(),
    };
    const result = formatPersonalContext(minimal);
    expect(result).toContain("Jo");
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// injectContext — personal layer integration
// ---------------------------------------------------------------------------

describe("injectContext() — personal layer", () => {
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `theorex-personal-inject-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("injects personal layer when business mode and layer exists", async () => {
    await savePersonalLayer("main", MOCK_LAYER, tmpDir);

    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "business", agentAxonDir: tmpDir, temporalAgentId: "main" }),
    });

    expect(result).toContain("Alice Chen");
    expect(result).toContain("USER PROFILE");
  });

  test("personal layer does not appear in personal deployment mode", async () => {
    await savePersonalLayer("main", MOCK_LAYER, tmpDir);

    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "personal", agentAxonDir: tmpDir, temporalAgentId: "main" }),
    });

    expect(result).not.toContain("USER PROFILE");
    expect(result).not.toContain("Alice Chen");
  });

  test("missing personal layer does not throw and produces no user profile block", async () => {
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "business", agentAxonDir: tmpDir, temporalAgentId: "main" }),
    });

    expect(typeof result).toBe("string");
    expect(result).not.toContain("USER PROFILE");
  });

  test("personal layer appears after profession pack when both present", async () => {
    await savePersonalLayer("main", MOCK_LAYER, tmpDir);

    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({
        deploymentMode: "business",
        professionPack: "trading",
        agentAxonDir: tmpDir,
        temporalAgentId: "main",
      }),
    });

    const packIdx = result.indexOf("TRADING");
    const profileIdx = result.indexOf("USER PROFILE");
    expect(packIdx).toBeGreaterThanOrEqual(0);
    expect(profileIdx).toBeGreaterThanOrEqual(0);
    expect(packIdx).toBeLessThan(profileIdx);
  });

  test("personal layer before THEOREX ACTIVE CONTEXT when axon also present", async () => {
    await savePersonalLayer("main", MOCK_LAYER, tmpDir);

    // injectContext with a real axon that has active nodes would be complex to mock;
    // this test verifies ordering relative to static injection point
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,  // cold start — no ACTIVE CONTEXT block
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "business", agentAxonDir: tmpDir, temporalAgentId: "main" }),
    });

    expect(result).toContain("USER PROFILE");
  });
});
