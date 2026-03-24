// deliberate/extractors/horizon.ts — Extract Horizon position exposure report.
//
// Reads a pre-computed JSON report file produced by the Horizon engine.
// Returns null if the file does not exist.

import type { TradingSession, HorizonReport } from "../types";

/**
 * Extract a HorizonReport from a JSON file on disk.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function extractHorizonReport(
  reportPath: string,
  _session: TradingSession,
  _date: string,
): Promise<HorizonReport | null> {
  try {
    const file = Bun.file(reportPath);
    const exists = await file.exists();
    if (!exists) return null;

    const text = await file.text();
    const parsed = JSON.parse(text) as HorizonReport;
    return parsed;
  } catch {
    return null;
  }
}
