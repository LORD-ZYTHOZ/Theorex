// system/updates.ts — System update queue.
// Persisted at data/updates.jsonl (one JSON record per line).
// Push an update with `theorex push-update "<message>"`.
// Boot-inject reads the last N updates and injects them into SHARED_CONTEXT.md
// so Nova and Secretarius always boot with current system state.

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const UPDATES_PATH = "data/updates.jsonl";

export interface SystemUpdate {
  readonly id: string;
  readonly timestamp: string; // ISO 8601
  readonly message: string;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function appendUpdate(
  message: string,
  path: string = UPDATES_PATH,
): Promise<SystemUpdate> {
  const update: SystemUpdate = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    message: message.trim(),
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(update) + "\n", "utf-8");
  return update;
}

export async function readUpdates(path: string = UPDATES_PATH): Promise<SystemUpdate[]> {
  try {
    const raw = await readFile(path, "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as SystemUpdate);
  } catch {
    return [];
  }
}

export async function readRecentUpdates(
  n: number = 10,
  path: string = UPDATES_PATH,
): Promise<SystemUpdate[]> {
  const all = await readUpdates(path);
  return all.slice(-n);
}

/**
 * Format recent updates as a markdown block for injection into SHARED_CONTEXT.md.
 * Returns empty string if no updates.
 */
export function formatUpdatesBlock(updates: SystemUpdate[]): string {
  if (updates.length === 0) return "";
  const lines: string[] = [
    "## SYSTEM UPDATES",
    "> Recent changes to the fleet. Review before acting.",
    "",
  ];
  for (const u of [...updates].reverse()) {
    const date = u.timestamp.slice(0, 10);
    const time = u.timestamp.slice(11, 16);
    lines.push(`- **[${date} ${time}]** ${u.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
