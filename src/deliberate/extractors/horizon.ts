// deliberate/extractors/horizon.ts — Extract Horizon position exposure report.
//
// Reads a pre-computed JSON report file produced by the Horizon engine.
// Returns null if the file does not exist.

import { readJsonReport } from "./read-report.ts";
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
  return readJsonReport<HorizonReport>(reportPath);
}