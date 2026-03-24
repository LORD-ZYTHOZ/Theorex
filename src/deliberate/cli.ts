// deliberate/cli.ts — CLI arg parser for `theorex deliberate`.
// Maps short session names (LDN/NY/ASIA/OFF) to TradingSession values
// and validates that either --latest or --session + --date is provided.

import type { TradingSession } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeliberateCliArgs {
  readonly session?: TradingSession;
  readonly date?: string;
  readonly latest: boolean;
  readonly force: boolean;
}

// ---------------------------------------------------------------------------
// Session name mapping
// ---------------------------------------------------------------------------

const SESSION_ALIASES: Readonly<Record<string, TradingSession>> = {
  LDN: "london",
  NY: "new_york",
  ASIA: "asian",
  OFF: "off_hours",
  // Allow canonical names directly
  london: "london",
  new_york: "new_york",
  asian: "asian",
  off_hours: "off_hours",
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseDeliberateArgs(args: readonly string[]): DeliberateCliArgs {
  let session: string | undefined;
  let date: string | undefined;
  let latest = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--session":
        session = args[++i];
        break;
      case "--date":
        date = args[++i];
        break;
      case "--latest":
        latest = true;
        break;
      case "--force":
        force = true;
        break;
      default:
        // Ignore unknown args for forward compatibility
        break;
    }
  }

  // Validate: either --latest or both --session + --date
  if (!latest && !session && !date) {
    throw new Error(
      "Either --latest or both --session and --date are required.\n" +
      "Usage: theorex deliberate --session LDN --date 2026-03-24\n" +
      "       theorex deliberate --latest",
    );
  }

  if (!latest && (!session || !date)) {
    throw new Error(
      "Both --session and --date are required when --latest is not used.\n" +
      "Usage: theorex deliberate --session LDN --date 2026-03-24",
    );
  }

  // Map session alias
  let mappedSession: TradingSession | undefined;
  if (session) {
    mappedSession = SESSION_ALIASES[session];
    if (!mappedSession) {
      const valid = Object.keys(SESSION_ALIASES)
        .filter((k) => k === k.toUpperCase())
        .join(", ");
      throw new Error(
        `Unknown session: "${session}". Valid aliases: ${valid}`,
      );
    }
  }

  return {
    session: mappedSession,
    date,
    latest,
    force,
  };
}
