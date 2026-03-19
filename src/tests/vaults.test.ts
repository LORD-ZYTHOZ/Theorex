// vaults.test.ts — Phase 23: Multi-Vault Shared Memory

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_VAULTS,
  findVault,
  canWrite,
  canRead,
  passesDomainFilter,
  upsertVault,
  removeVault,
  loadVaultRegistry,
  saveVaultRegistry,
  resolveVaultAxonPath,
} from "../vaults/registry";
import type { VaultConfig } from "../vaults/registry";
import { queryVault, mergeVaults } from "../vaults/query";
import { promoteToVault } from "../vaults/promote";
import { DEFAULT_CONFIG } from "../config";
import { AxonStore } from "../axon/store";
import { agentAxonPath } from "../family/paths";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeVault = (name: string, members: string[], domains: string[] = []): VaultConfig => ({
  name,
  path: `/tmp/test-vault-${name}-axon.json`,
  members,
  read_only_members: [],
  domains,
  created_at: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// registry — pure functions
// ---------------------------------------------------------------------------

describe("registry: findVault", () => {
  test("finds existing vault by name", () => {
    const vaults = [makeVault("fleet", ["main"]), makeVault("trading", ["iris"])];
    expect(findVault("fleet", vaults)?.name).toBe("fleet");
    expect(findVault("trading", vaults)?.name).toBe("trading");
  });

  test("returns null for unknown vault", () => {
    expect(findVault("nonexistent", DEFAULT_VAULTS)).toBeNull();
  });
});

describe("registry: canWrite / canRead", () => {
  const vault: VaultConfig = {
    name: "test",
    path: "/tmp/test.json",
    members: ["main", "qwen-sage"],
    read_only_members: ["secretarius"],
    domains: [],
    created_at: new Date().toISOString(),
  };

  test("member can write", () => {
    expect(canWrite("main", vault)).toBe(true);
  });

  test("non-member cannot write", () => {
    expect(canWrite("secretarius", vault)).toBe(false);
    expect(canWrite("unknown-agent", vault)).toBe(false);
  });

  test("member can read", () => {
    expect(canRead("main", vault)).toBe(true);
  });

  test("read_only_member can read but not write", () => {
    expect(canRead("secretarius", vault)).toBe(true);
    expect(canWrite("secretarius", vault)).toBe(false);
  });
});

describe("registry: passesDomainFilter", () => {
  const tradingVault = makeVault("trading", ["iris"], ["trading", "xauusd", "market"]);
  const openVault = makeVault("fleet", ["main"]); // no domains = all pass

  test("all concepts pass when vault has no domain filter", () => {
    expect(passesDomainFilter("typescript", openVault)).toBe(true);
    expect(passesDomainFilter("anything really", openVault)).toBe(true);
  });

  test("concept passes when surface_form contains a domain keyword", () => {
    expect(passesDomainFilter("xauusd", tradingVault)).toBe(true);
    expect(passesDomainFilter("market analysis", tradingVault)).toBe(true);
    expect(passesDomainFilter("trading strategy", tradingVault)).toBe(true);
  });

  test("concept blocked when surface_form has no domain match", () => {
    expect(passesDomainFilter("typescript", tradingVault)).toBe(false);
    expect(passesDomainFilter("graphology", tradingVault)).toBe(false);
  });

  test("domain matching is case-insensitive", () => {
    expect(passesDomainFilter("XAUUSD", tradingVault)).toBe(true);
    expect(passesDomainFilter("Market Session", tradingVault)).toBe(true);
  });
});

describe("registry: upsertVault / removeVault", () => {
  const initial = [makeVault("fleet", ["main"]), makeVault("trading", ["iris"])];

  test("upsert adds new vault", () => {
    const updated = upsertVault(initial, makeVault("coding", ["m4-engineer"]));
    expect(updated.length).toBe(3);
    expect(findVault("coding", updated)).not.toBeNull();
  });

  test("upsert replaces existing vault", () => {
    const newFleet = { ...makeVault("fleet", ["main", "qwen-sage"]) };
    const updated = upsertVault(initial, newFleet);
    expect(updated.length).toBe(2);
    expect(findVault("fleet", updated)!.members).toContain("qwen-sage");
  });

  test("removeVault removes by name", () => {
    const updated = removeVault(initial, "trading");
    expect(updated.length).toBe(1);
    expect(findVault("trading", updated)).toBeNull();
  });

  test("removeVault is no-op for unknown name", () => {
    const updated = removeVault(initial, "nonexistent");
    expect(updated.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// registry: load / save (file I/O)
// ---------------------------------------------------------------------------

describe("registry: loadVaultRegistry / saveVaultRegistry", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "theorex-vault-reg-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns DEFAULT_VAULTS when registry file missing", async () => {
    const vaults = await loadVaultRegistry(join(tmpDir, "missing.json"));
    expect(vaults.length).toBe(DEFAULT_VAULTS.length);
  });

  test("save + load roundtrip", async () => {
    const path = join(tmpDir, "vaults.json");
    const vaults = [makeVault("fleet", ["main"]), makeVault("trading", ["iris"], ["trading"])];
    await saveVaultRegistry(vaults, path);
    const loaded = await loadVaultRegistry(path);
    expect(loaded.length).toBe(2);
    expect(loaded[0]!.name).toBe("fleet");
    expect(loaded[1]!.domains).toContain("trading");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_VAULTS content
// ---------------------------------------------------------------------------

describe("DEFAULT_VAULTS", () => {
  test("fleet vault has all core agents", () => {
    const fleet = findVault("fleet", DEFAULT_VAULTS)!;
    expect(fleet).not.toBeNull();
    expect(fleet.members).toContain("main");
    expect(fleet.members).toContain("qwen-sage");
    expect(fleet.members).toContain("secretarius");
    expect(fleet.domains).toEqual([]); // no filter
  });

  test("trading vault has domain filter", () => {
    const trading = findVault("trading", DEFAULT_VAULTS)!;
    expect(trading.domains.length).toBeGreaterThan(0);
    expect(trading.domains).toContain("trading");
  });

  test("coding vault has coding domains", () => {
    const coding = findVault("coding", DEFAULT_VAULTS)!;
    expect(coding.domains).toContain("code");
    expect(coding.members).toContain("m4-engineer");
  });
});

// ---------------------------------------------------------------------------
// queryVault + mergeVaults (with real AxonStore)
// ---------------------------------------------------------------------------

describe("queryVault + mergeVaults", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "theorex-vault-query-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("queryVault returns empty for missing vault axon", async () => {
    const vault = makeVault("empty", ["main"]);
    const result = await queryVault(vault, DEFAULT_CONFIG);
    expect(result).toEqual([]);
  });

  test("mergeVaults returns empty when all vaults missing", async () => {
    const vaults = [makeVault("v1", ["main"]), makeVault("v2", ["qwen-sage"])];
    const result = await mergeVaults(vaults, DEFAULT_CONFIG);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// promoteToVault membership enforcement
// ---------------------------------------------------------------------------

describe("promoteToVault: membership check", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "theorex-vault-promote-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns denied=true when agent is not a vault member", async () => {
    const vault: VaultConfig = {
      name: "restricted",
      path: join(tmpDir, "restricted-axon.json"),
      members: ["iris"],
      read_only_members: [],
      domains: [],
      created_at: new Date().toISOString(),
    };

    const cfg = {
      ...DEFAULT_CONFIG,
      agentAxonDir: join(tmpDir, "agents"),
      coldStorePath: join(tmpDir, "cold.db"),
    };

    const result = await promoteToVault("main", vault, cfg);
    expect(result.denied).toBe(true);
    expect(result.promoted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveVaultAxonPath
// ---------------------------------------------------------------------------

describe("resolveVaultAxonPath", () => {
  test("bare name resolves to workspace path", () => {
    const path = resolveVaultAxonPath("trading");
    expect(path).toContain("openclaw");
    expect(path).toContain("trading-axon.json");
  });

  test("absolute path passes through unchanged", () => {
    const path = resolveVaultAxonPath("trading", "/custom/path/axon.json");
    expect(path).toBe("/custom/path/axon.json");
  });

  test("tilde path expands home", () => {
    const path = resolveVaultAxonPath("trading", "~/mydir/axon.json");
    expect(path).not.toContain("~");
    expect(path).toContain("mydir/axon.json");
  });
});
