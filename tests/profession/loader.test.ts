// Phase 12: Profession Pack loader tests

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProfessionPack, formatPackContext } from "../../src/profession/loader";
import type { ProfessionPack } from "../../src/profession/loader";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "theorex-p12-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadProfessionPack — built-in packs
// ---------------------------------------------------------------------------

test("loads built-in trading pack", async () => {
  const pack = await loadProfessionPack("trading");
  expect(pack).not.toBeNull();
  expect(pack!.name).toBe("trading");
  expect(pack!.concepts.length).toBeGreaterThan(0);
  expect(pack!.rules.length).toBeGreaterThan(0);
  expect(pack!.boot_context.length).toBeGreaterThan(0);
});

test("loads built-in legal pack", async () => {
  const pack = await loadProfessionPack("legal");
  expect(pack).not.toBeNull();
  expect(pack!.name).toBe("legal");
});

test("loads built-in medical pack", async () => {
  const pack = await loadProfessionPack("medical");
  expect(pack).not.toBeNull();
  expect(pack!.name).toBe("medical");
});

test("loads built-in marketing pack", async () => {
  const pack = await loadProfessionPack("marketing");
  expect(pack).not.toBeNull();
  expect(pack!.name).toBe("marketing");
});

test("returns null for unknown pack name", async () => {
  const pack = await loadProfessionPack("unicorn");
  expect(pack).toBeNull();
});

// ---------------------------------------------------------------------------
// loadProfessionPack — custom packs directory override
// ---------------------------------------------------------------------------

test("custom packsDir takes precedence over built-in", async () => {
  const customPack: ProfessionPack = {
    name: "trading",
    concepts: ["custom concept"],
    rules: ["custom rule"],
    boot_context: "custom boot context",
  };
  await writeFile(join(tmpDir, "trading.json"), JSON.stringify(customPack));

  const pack = await loadProfessionPack("trading", tmpDir);
  expect(pack!.boot_context).toBe("custom boot context");
  expect(pack!.concepts).toEqual(["custom concept"]);
});

test("falls back to built-in if custom dir does not have the pack", async () => {
  // tmpDir has no trading.json — should fall back to built-in
  const pack = await loadProfessionPack("trading", tmpDir);
  expect(pack).not.toBeNull();
  expect(pack!.concepts.length).toBeGreaterThan(1); // built-in has 10 concepts
});

test("loads custom pack not in built-ins", async () => {
  const customPack: ProfessionPack = {
    name: "crypto",
    concepts: ["DeFi", "smart contract"],
    rules: ["never provide financial advice"],
    boot_context: "You are in a crypto environment.",
  };
  await writeFile(join(tmpDir, "crypto.json"), JSON.stringify(customPack));

  const pack = await loadProfessionPack("crypto", tmpDir);
  expect(pack!.name).toBe("crypto");
  expect(pack!.concepts).toContain("DeFi");
});

// ---------------------------------------------------------------------------
// formatPackContext
// ---------------------------------------------------------------------------

test("formatPackContext produces structured output with pack name header", () => {
  const pack: ProfessionPack = {
    name: "trading",
    concepts: ["risk management"],
    rules: ["Never guarantee returns"],
    boot_context: "You are in a trading environment.",
  };

  const output = formatPackContext(pack);

  expect(output).toContain("=== THEOREX PROFESSION PACK: TRADING ===");
  expect(output).toContain("You are in a trading environment.");
  expect(output).toContain("--- Rules ---");
  expect(output).toContain("• Never guarantee returns");
});

test("formatPackContext omits rules section when rules array is empty", () => {
  const pack: ProfessionPack = {
    name: "minimal",
    concepts: [],
    rules: [],
    boot_context: "Minimal boot context.",
  };

  const output = formatPackContext(pack);
  expect(output).not.toContain("--- Rules ---");
  expect(output).toContain("Minimal boot context.");
});
