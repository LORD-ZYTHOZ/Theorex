// profession/personal.ts — Personal Layer for Business Mode (Phase 12 extension).
// Per-user preferences and rapport stored alongside the agent axon.
// Injected into session boot context in business mode to make the AI feel human-aware.
//
// Storage: ~/.openclaw/agents/<agent-id>/theorex/personal.json
// (co-located with axon.json in the same theorex subdir)
//
// INVARIANTS:
//   - loadPersonalLayer returns null on missing/corrupt file (never throws)
//   - savePersonalLayer creates parent directories as needed
//   - formatPersonalContext never throws

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { agentPersonalLayerPath } from "../family/paths";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export interface PersonalLayer {
  readonly name: string;
  readonly tone: "formal" | "casual" | "balanced";
  readonly response_length: "brief" | "detailed" | "adaptive";
  readonly notes: readonly string[];        // freeform observations about this user
  readonly key_contacts: readonly string[]; // "Alice Brown — key client, retail portfolio"
  readonly last_seen: string;               // ISO 8601 — updated on each session
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load personal layer for an agent.
 * Returns null if file is absent or unreadable — never throws.
 */
export async function loadPersonalLayer(
  agentId: string,
  agentAxonDir = "",
): Promise<PersonalLayer | null> {
  const path = agentPersonalLayerPath(agentId, agentAxonDir);
  try {
    const raw = await Bun.file(path).json() as PersonalLayer;
    return raw;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save personal layer for an agent.
 * Creates parent directories if missing.
 * Returns a new immutable object — never mutates the input.
 */
export async function savePersonalLayer(
  agentId: string,
  layer: PersonalLayer,
  agentAxonDir = "",
): Promise<void> {
  const path = agentPersonalLayerPath(agentId, agentAxonDir);
  const dir = join(path, "..");
  await mkdir(dir, { recursive: true });
  await Bun.write(path, JSON.stringify({ ...layer }, null, 2));
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Format a personal layer for injection into session boot context.
 * Returns a multi-line block appended after the profession pack block.
 * Never throws — returns a minimal string if fields are empty.
 */
export function formatPersonalContext(layer: PersonalLayer): string {
  const lines: string[] = [
    `=== USER PROFILE: ${layer.name} ===`,
    `Communication: ${layer.tone}, ${layer.response_length} responses`,
  ];

  if (layer.key_contacts.length > 0) {
    lines.push("Key contacts:");
    for (const contact of layer.key_contacts) {
      lines.push(`  ${contact}`);
    }
  }

  if (layer.notes.length > 0) {
    lines.push("Notes:");
    for (const note of layer.notes) {
      lines.push(`• ${note}`);
    }
  }

  return lines.join("\n");
}
