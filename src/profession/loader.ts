// profession/loader.ts — Load profession packs for Business deployment mode (Phase 12).
// Built-in packs are colocated at src/profession/packs/{name}.json.
// Custom packs can override by setting professionPacksDir in config.json.
//
// INVARIANTS:
//   - Returns null on unknown pack name (caller decides how to handle)
//   - Never throws — pack load failures are non-fatal

import { join } from "node:path";

export interface ProfessionPack {
  readonly name: string;
  readonly concepts: readonly string[];   // seed concepts to boost at boot
  readonly rules: readonly string[];      // behavioral rules injected into context
  readonly boot_context: string;          // prepended block in session injection
}

const BUILTIN_PACKS_DIR = join(import.meta.dir, "packs");

/**
 * Load a profession pack by name.
 * Searches packsDir first (if provided), then built-in packs directory.
 * Returns null if not found or unreadable.
 */
export async function loadProfessionPack(
  name: string,
  packsDir?: string,
): Promise<ProfessionPack | null> {
  const candidates: string[] = [];

  if (packsDir) candidates.push(join(packsDir, `${name}.json`));
  candidates.push(join(BUILTIN_PACKS_DIR, `${name}.json`));

  for (const path of candidates) {
    try {
      const raw = await Bun.file(path).json() as ProfessionPack;
      return raw;
    } catch {
      // Not found at this path — try next
    }
  }

  return null;
}

/**
 * Format a profession pack for injection into session context.
 * Returns a multi-line block to prepend to THEOREX ACTIVE CONTEXT.
 */
export function formatPackContext(pack: ProfessionPack): string {
  const lines: string[] = [
    `=== THEOREX PROFESSION PACK: ${pack.name.toUpperCase()} ===`,
    pack.boot_context,
  ];

  if (pack.rules.length > 0) {
    lines.push("--- Rules ---");
    for (const rule of pack.rules) {
      lines.push(`• ${rule}`);
    }
  }

  return lines.join("\n");
}
