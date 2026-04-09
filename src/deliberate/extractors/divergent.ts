// deliberate/extractors/divergent.ts — Extract Divergent signal agreement report.
//
// Reads a pre-computed JSON report file produced by the Divergent engine.
// Returns null if the file does not exist.

import { readJsonReport } from "./read-report.ts";
import type { TradingSession, DivergentReport } from "../types";

/**
 * Extract a DivergentReport from a JSON file on disk.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function extractDivergentReport(
  reportPath: string,
  _session: TradingSession,
  _date: string,
): Promise<DivergentReport | null> {
  return readJsonReport<DivergentReport>(reportPath);
}