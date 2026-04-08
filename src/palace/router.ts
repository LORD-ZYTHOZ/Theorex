export interface PalaceAddress {
  wing: string;  // e.g. "wing_secretarius", "wing_diary_meridian"
  room: string;  // e.g. "session-2026-04-08", "regime-fade", "diary", "general"
}

export interface RouterOptions {
  isDiary?: boolean;   // if true, wing = wing_diary_{agentId}, room = "diary"
  roomHint?: string;   // explicit room name (slugified if provided)
}

/**
 * Derive wing from agentId
 * e.g. "secretarius" → "wing_secretarius", "meridian" → "wing_meridian"
 * edge case: empty/unknown agentId → "wing_general"
 */
export function wingFromAgent(agentId: string): string {
  const normalized = (agentId || "").trim();
  if (!normalized) return "wing_general";
  return `wing_${normalized}`;
}

/**
 * Derive diary wing from agentId
 * e.g. "secretarius" → "wing_diary_secretarius"
 */
export function diaryWing(agentId: string): string {
  const normalized = (agentId || "").trim();
  const base = normalized || "general";
  return `wing_diary_${base}`;
}

/**
 * Slugify a room hint
 * lowercase, spaces→hyphens, strip special chars except hyphens
 * e.g. "Auth Migration" → "auth-migration", "  foo  bar!  " → "foo-bar"
 */
export function slugifyRoom(hint: string): string {
  if (!hint) return "";

  return (
    hint
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")           // spaces to hyphens
      .replace(/[^a-z0-9-]/g, "")     // strip special chars except hyphens
      .replace(/-+/g, "-")             // collapse multiple hyphens
      .replace(/^-+|-+$/g, "")         // strip leading/trailing hyphens
  );
}

/**
 * Main routing function
 * - If opts?.isDiary: return { wing: diaryWing(agentId), room: "diary" }
 * - If opts?.roomHint: return { wing: wingFromAgent(agentId), room: slugifyRoom(opts.roomHint) }
 * - Otherwise (default): return { wing: wingFromAgent(agentId), room: "general" }
 * Never throw — all edge cases return a valid address
 */
export function routeToAddress(agentId: string, opts?: RouterOptions): PalaceAddress {
  if (opts?.isDiary) {
    return {
      wing: diaryWing(agentId),
      room: "diary",
    };
  }

  if (opts?.roomHint) {
    return {
      wing: wingFromAgent(agentId),
      room: slugifyRoom(opts.roomHint),
    };
  }

  return {
    wing: wingFromAgent(agentId),
    room: "general",
  };
}
