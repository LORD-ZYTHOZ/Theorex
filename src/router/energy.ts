// energy.ts — Phase 17 energy-aware dispatch for Apple Silicon (M4 Pro).
// Reads power state via pmset before dispatching to heavy local models.
// All functions are pure or explicitly I/O-labelled; no hidden side effects.

import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnergyReading {
  readonly timestamp: string;
  readonly cpu_watts?: number;
  readonly gpu_watts?: number;
  readonly ane_watts?: number;
  readonly total_watts?: number;
  readonly on_battery: boolean;
  readonly battery_pct?: number;
  readonly source: "powermetrics" | "pmset" | "fallback";
}

export interface EnergyDispatchAdvice {
  readonly allow_large_model: boolean;
  readonly allow_local: boolean;
  readonly reason: string;
  readonly energy_reading: EnergyReading;
}

// ---------------------------------------------------------------------------
// Power state reading
// ---------------------------------------------------------------------------

/** Parse battery percentage from a pmset -g batt line, e.g. "85%; Battery Power" */
function parseBatteryPct(line: string): number | undefined {
  const match = line.match(/(\d+)%/);
  if (!match) return undefined;
  const pct = parseInt(match[1]!, 10);
  return Number.isNaN(pct) ? undefined : pct;
}

/** Parse pmset stdout to determine on_battery and battery_pct. */
function parsePmsetOutput(stdout: string): Pick<EnergyReading, "on_battery" | "battery_pct"> {
  const lines = stdout.split("\n");

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("battery power")) {
      return { on_battery: true, battery_pct: parseBatteryPct(line) };
    }
    if (lower.includes("ac power")) {
      return { on_battery: false, battery_pct: parseBatteryPct(line) };
    }
  }

  // No conclusive line found — default to AC
  return { on_battery: false };
}

/**
 * Read current power state using `pmset -g batt`.
 * Falls back to a safe AC-assumed reading if pmset is unavailable or fails.
 */
export async function readPowerState(): Promise<EnergyReading> {
  const timestamp = new Date().toISOString();

  try {
    const proc = Bun.spawn(["pmset", "-g", "batt"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      return { timestamp, on_battery: false, source: "fallback" };
    }

    const parsed = parsePmsetOutput(stdout);
    return { timestamp, source: "pmset", ...parsed };
  } catch {
    return { timestamp, on_battery: false, source: "fallback" };
  }
}

// ---------------------------------------------------------------------------
// Dispatch advice
// ---------------------------------------------------------------------------

/**
 * Compute dispatch advice from a power reading and task complexity.
 * Returns an immutable advice object — never mutates the reading.
 *
 * Rules (in priority order):
 *  1. on_battery && battery_pct < 20  → block large model (critical battery)
 *  2. on_battery && complexity=low    → block large model (conserve power)
 *  3. complexity=high                 → always allow (quality required)
 *  4. default                         → allow large model
 */
export function getDispatchAdvice(
  reading: EnergyReading,
  taskComplexity: "low" | "medium" | "high",
): EnergyDispatchAdvice {
  const base = { energy_reading: reading, allow_local: true } as const;

  if (reading.on_battery && reading.battery_pct !== undefined && reading.battery_pct < 20) {
    return {
      ...base,
      allow_large_model: false,
      reason: "low battery — conserving power, large model disabled",
    };
  }

  if (reading.on_battery && taskComplexity === "low") {
    return {
      ...base,
      allow_large_model: false,
      reason: "battery power, low complexity — using smaller model",
    };
  }

  if (taskComplexity === "high") {
    return {
      ...base,
      allow_large_model: true,
      reason: "high complexity — large model required for quality",
    };
  }

  return {
    ...base,
    allow_large_model: true,
    reason: "AC power or moderate complexity — large model allowed",
  };
}