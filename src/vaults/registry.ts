// vaults/registry.ts — Phase 23: Multi-Vault Shared Memory
// Named shared axons — each vault is an independent concept web with its own
// membership list, optional domain filter, and path.
//
// Default vaults seeded on first access:
//   fleet   — all agents, all domains, replaces the single shared-axon
//   trading — market agents (iris, main, secretarius), trading domains only
//   coding  — engineering agents, code/system domains only

import { rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultConfig {
  readonly name: string;
  readonly path: string;                        // absolute path to axon.json
  readonly members: readonly string[];          // agent_ids that can write
  readonly read_only_members: readonly string[];// agent_ids that can read only
  readonly domains: readonly string[];          // keyword filter on surface_form; [] = all
  readonly created_at: string;                  // ISO 8601
}

export interface VaultRegistry {
  readonly version: number;
  readonly vaults: readonly VaultConfig[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const OPENCLAW_BASE = join(homedir(), ".openclaw");
const WORKSPACE_THEOREX = join(OPENCLAW_BASE, "workspace", "theorex");

export const DEFAULT_VAULT_REGISTRY_PATH = "data/vaults.json";

/** Resolve a vault axon path — absolute paths pass through, bare names resolve to workspace. */
export function resolveVaultAxonPath(vaultName: string, customPath = ""): string {
  if (customPath && (customPath.startsWith("/") || customPath.startsWith("~"))) {
    return customPath.startsWith("~")
      ? customPath.replace(/^~/, homedir())
      : customPath;
  }
  return join(WORKSPACE_THEOREX, `${vaultName}-axon.json`);
}

// ---------------------------------------------------------------------------
// Default vaults
// ---------------------------------------------------------------------------

export const DEFAULT_VAULTS: readonly VaultConfig[] = [
  {
    name: "fleet",
    path: resolveVaultAxonPath("fleet"),
    members: ["main", "qwen-sage", "secretarius", "m4-engineer", "claude-code-agent"],
    read_only_members: [],
    domains: [], // all domains
    created_at: new Date(0).toISOString(),
  },
  {
    name: "trading",
    path: resolveVaultAxonPath("trading"),
    members: ["main", "secretarius"],
    read_only_members: ["qwen-sage"],
    domains: ["trading", "forex", "xauusd", "market", "gold", "trade", "signal", "session"],
    created_at: new Date(0).toISOString(),
  },
  {
    name: "coding",
    path: resolveVaultAxonPath("coding"),
    members: ["m4-engineer", "claude-code-agent", "qwen-sage", "main"],
    read_only_members: [],
    domains: ["code", "typescript", "python", "system", "api", "function", "test", "bun", "node"],
    created_at: new Date(0).toISOString(),
  },
] as const;

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load the vault registry from disk.
 * Returns DEFAULT_VAULTS if the registry file is missing or unreadable.
 */
export async function loadVaultRegistry(
  path: string = DEFAULT_VAULT_REGISTRY_PATH,
): Promise<readonly VaultConfig[]> {
  try {
    const raw = await Bun.file(path).json() as VaultRegistry;
    if (!Array.isArray(raw.vaults) || raw.vaults.length === 0) {
      return DEFAULT_VAULTS;
    }
    return raw.vaults as readonly VaultConfig[];
  } catch {
    return DEFAULT_VAULTS;
  }
}

/**
 * Save the vault registry atomically.
 */
export async function saveVaultRegistry(
  vaults: readonly VaultConfig[],
  path: string = DEFAULT_VAULT_REGISTRY_PATH,
): Promise<void> {
  const registry: VaultRegistry = {
    version: 1,
    vaults,
  };
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, JSON.stringify(registry, null, 2));
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Find a vault by name. Returns null if not found. */
export function findVault(
  name: string,
  vaults: readonly VaultConfig[],
): VaultConfig | null {
  return vaults.find((v) => v.name === name) ?? null;
}

/** Check whether an agent can write to a vault. */
export function canWrite(agentId: string, vault: VaultConfig): boolean {
  return (vault.members as string[]).includes(agentId);
}

/** Check whether an agent can read from a vault. */
export function canRead(agentId: string, vault: VaultConfig): boolean {
  return canWrite(agentId, vault) ||
    (vault.read_only_members as string[]).includes(agentId);
}

/**
 * Check whether a concept's surface_form passes the vault's domain filter.
 * If vault.domains is empty, all concepts pass (no filter).
 */
export function passesDomainFilter(surfaceForm: string, vault: VaultConfig): boolean {
  if (vault.domains.length === 0) return true;
  const lower = surfaceForm.toLowerCase();
  return (vault.domains as string[]).some((d) => lower.includes(d.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Mutation helpers (return new objects — never mutate)
// ---------------------------------------------------------------------------

/** Add a vault to the registry. Replaces existing vault with same name. */
export function upsertVault(
  vaults: readonly VaultConfig[],
  vault: VaultConfig,
): readonly VaultConfig[] {
  const existing = vaults.findIndex((v) => v.name === vault.name);
  if (existing === -1) return [...vaults, vault];
  return vaults.map((v, i) => (i === existing ? vault : v));
}

/** Remove a vault from the registry by name. */
export function removeVault(
  vaults: readonly VaultConfig[],
  name: string,
): readonly VaultConfig[] {
  return vaults.filter((v) => v.name !== name);
}
