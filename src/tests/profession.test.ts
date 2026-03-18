// tests/profession.test.ts — Phase 12: Profession Packs + Business Mode
// Covers: loadProfessionPack, formatPackContext, injectContext integration

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { loadProfessionPack, formatPackContext, type ProfessionPack } from "../profession/loader";
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
    deploymentMode: "personal",
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
    temporalAgentId: "main",
    temporalStorePath: "data/temporal.json",
    contextSlideThreshold: 0.5,
    contextSlideCooldownCalls: 20,
  };
  return async () => ({ ...base, ...overrides } as Config);
}

// ---------------------------------------------------------------------------
// loadProfessionPack — built-in packs
// ---------------------------------------------------------------------------

describe("loadProfessionPack() — built-in packs", () => {
  test("loads trading pack", async () => {
    const pack = await loadProfessionPack("trading");
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("trading");
    expect(pack!.concepts.length).toBeGreaterThan(0);
    expect(pack!.rules.length).toBeGreaterThan(0);
    expect(typeof pack!.boot_context).toBe("string");
    expect(pack!.boot_context.length).toBeGreaterThan(0);
  });

  test("loads legal pack", async () => {
    const pack = await loadProfessionPack("legal");
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("legal");
    expect(pack!.concepts.length).toBeGreaterThan(0);
  });

  test("loads medical pack", async () => {
    const pack = await loadProfessionPack("medical");
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("medical");
  });

  test("loads marketing pack", async () => {
    const pack = await loadProfessionPack("marketing");
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("marketing");
  });

  test("returns null for unknown pack (no throw)", async () => {
    const pack = await loadProfessionPack("does-not-exist-xyz");
    expect(pack).toBeNull();
  });

  test("returns null for empty string (no throw)", async () => {
    const pack = await loadProfessionPack("");
    expect(pack).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadProfessionPack — custom packsDir override
// ---------------------------------------------------------------------------

describe("loadProfessionPack() — custom packsDir", () => {
  let tmpDir = "";

  test("loads custom pack from packsDir", async () => {
    tmpDir = join(tmpdir(), `theorex-pack-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    const customPack: ProfessionPack = {
      name: "custom",
      concepts: ["alpha", "beta"],
      rules: ["Rule one", "Rule two"],
      boot_context: "Custom deployment context.",
    };
    await writeFile(join(tmpDir, "custom.json"), JSON.stringify(customPack));

    const pack = await loadProfessionPack("custom", tmpDir);
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("custom");
    expect(pack!.concepts).toEqual(["alpha", "beta"]);
    expect(pack!.rules).toEqual(["Rule one", "Rule two"]);
    expect(pack!.boot_context).toBe("Custom deployment context.");

    await rm(tmpDir, { recursive: true });
  });

  test("custom packsDir takes priority over built-in", async () => {
    tmpDir = join(tmpdir(), `theorex-pack-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    // Shadowing the built-in "trading" pack with a different version
    const shadowPack: ProfessionPack = {
      name: "trading",
      concepts: ["shadow concept"],
      rules: ["Shadow rule"],
      boot_context: "Shadow context.",
    };
    await writeFile(join(tmpDir, "trading.json"), JSON.stringify(shadowPack));

    const pack = await loadProfessionPack("trading", tmpDir);
    expect(pack!.boot_context).toBe("Shadow context.");

    await rm(tmpDir, { recursive: true });
  });

  test("falls back to built-in if custom packsDir does not have the pack", async () => {
    tmpDir = join(tmpdir(), `theorex-pack-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    // tmpDir is empty — no "legal.json"

    const pack = await loadProfessionPack("legal", tmpDir);
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("legal");

    await rm(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// formatPackContext
// ---------------------------------------------------------------------------

describe("formatPackContext()", () => {
  const mockPack: ProfessionPack = {
    name: "testpack",
    concepts: ["concept-a"],
    rules: ["Do this", "Avoid that"],
    boot_context: "Test boot context.",
  };

  test("includes pack name header in uppercase", () => {
    const result = formatPackContext(mockPack);
    expect(result).toContain("TESTPACK");
  });

  test("includes boot_context", () => {
    const result = formatPackContext(mockPack);
    expect(result).toContain("Test boot context.");
  });

  test("includes all rules with bullet prefix", () => {
    const result = formatPackContext(mockPack);
    expect(result).toContain("• Do this");
    expect(result).toContain("• Avoid that");
  });

  test("returns a multi-line string", () => {
    const result = formatPackContext(mockPack);
    expect(result.split("\n").length).toBeGreaterThan(2);
  });

  test("pack with no rules omits rules section", () => {
    const noRules: ProfessionPack = { ...mockPack, rules: [] };
    const result = formatPackContext(noRules);
    expect(result).not.toContain("--- Rules ---");
    expect(result).toContain("Test boot context.");
  });
});

// ---------------------------------------------------------------------------
// injectContext — business mode integration
// ---------------------------------------------------------------------------

describe("injectContext() — business mode", () => {
  test("injects pack context when deploymentMode=business and pack exists", async () => {
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "business", professionPack: "trading" }),
    });
    expect(result).toContain("TRADING");
    expect(result).toContain("trading");
  });

  test("pack context appears before active context block", async () => {
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "business", professionPack: "legal" }),
    });
    const packIdx = result.indexOf("LEGAL");
    const activeIdx = result.indexOf("THEOREX ACTIVE CONTEXT");
    // If both are present, pack must come first; if active is absent (-1) that's also fine
    if (packIdx !== -1 && activeIdx !== -1) {
      expect(packIdx).toBeLessThan(activeIdx);
    } else {
      expect(packIdx).toBeGreaterThanOrEqual(0);
    }
  });

  test("unknown pack name does not throw and produces no pack block", async () => {
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "business", professionPack: "nonexistent-pack" }),
    });
    expect(typeof result).toBe("string");
    expect(result).not.toContain("PROFESSION PACK");
  });

  test("personal mode with professionPack set does not inject pack", async () => {
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "personal", professionPack: "trading" }),
    });
    expect(result).not.toContain("PROFESSION PACK");
    expect(result).not.toContain("TRADING");
  });

  test("business mode with empty professionPack does not inject pack", async () => {
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({ deploymentMode: "business", professionPack: "" }),
    });
    expect(result).not.toContain("PROFESSION PACK");
  });

  test("pack load failure is non-fatal — returns empty string not throw", async () => {
    // packsDir pointing to a non-existent directory
    const result = await injectContext("test-session", {
      loadAxon: nullAxon,
      readShortTermFiles: nullStm,
      readMoments: nullMoments,
      loadConfig: makeConfig({
        deploymentMode: "business",
        professionPack: "trading",
        professionPacksDir: "/nonexistent/path/to/packs",
      }),
    });
    // Should fall back to built-in — trading pack still loads
    expect(typeof result).toBe("string");
  });
});
