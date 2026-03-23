// system/deprecated.ts — Deprecated process/agent registry.
// Persisted at data/deprecated.json.
// Boot-inject reads this and injects a hard-block section into SHARED_CONTEXT.md
// so Nova, Secretarius (and all agents) never try to heal or restart deprecated items.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const DEPRECATED_PATH = "data/deprecated.json";

export interface DeprecatedItem {
  readonly name: string;
  readonly reason: string;
  readonly deprecated_at: string; // ISO 8601
}

export interface DeprecatedRegistry {
  readonly updated_at: string;
  readonly items: DeprecatedItem[];
}

const EMPTY: DeprecatedRegistry = { updated_at: new Date().toISOString(), items: [] };

export async function loadDeprecated(path: string = DEPRECATED_PATH): Promise<DeprecatedRegistry> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as DeprecatedRegistry;
  } catch {
    return EMPTY;
  }
}

export async function saveDeprecated(
  registry: DeprecatedRegistry,
  path: string = DEPRECATED_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(registry, null, 2), "utf-8");
}

export async function addDeprecated(
  name: string,
  reason: string,
  path: string = DEPRECATED_PATH,
): Promise<DeprecatedRegistry> {
  const registry = await loadDeprecated(path);
  if (registry.items.some((i) => i.name === name)) {
    // Already deprecated — update reason
    const updated: DeprecatedRegistry = {
      updated_at: new Date().toISOString(),
      items: registry.items.map((i) =>
        i.name === name ? { ...i, reason, deprecated_at: i.deprecated_at } : i,
      ),
    };
    await saveDeprecated(updated, path);
    return updated;
  }
  const updated: DeprecatedRegistry = {
    updated_at: new Date().toISOString(),
    items: [...registry.items, { name, reason, deprecated_at: new Date().toISOString() }],
  };
  await saveDeprecated(updated, path);
  return updated;
}

export async function removeDeprecated(
  name: string,
  path: string = DEPRECATED_PATH,
): Promise<DeprecatedRegistry> {
  const registry = await loadDeprecated(path);
  const updated: DeprecatedRegistry = {
    updated_at: new Date().toISOString(),
    items: registry.items.filter((i) => i.name !== name),
  };
  await saveDeprecated(updated, path);
  return updated;
}

/**
 * Format deprecated list as a markdown block for injection into SHARED_CONTEXT.md.
 * Returns empty string if no deprecated items.
 */
export function formatDeprecatedBlock(registry: DeprecatedRegistry): string {
  if (registry.items.length === 0) return "";
  const lines: string[] = [
    "## DEPRECATED — DO NOT HEAL OR RESTART",
    "> These processes/agents are retired. Never attempt to restart, heal, or reference them.",
    "",
  ];
  for (const item of registry.items) {
    lines.push(`- **${item.name}** — ${item.reason}`);
  }
  lines.push("");
  return lines.join("\n");
}
