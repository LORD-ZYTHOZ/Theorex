// evolve/refine.ts — Write evolution insights back into the axon graph.
// Called after reviewOutcomes(). Writes typed observations so the agent's
// boot context reflects what worked and what didn't — closing the loop.

import { AxonStore } from "../axon/store";
import { processText } from "../compose";
import type { EvolutionReport } from "./review";
import type { Config } from "../config";
import { mkdir } from "node:fs/promises";

export const DEFAULT_EVOLUTION_LOG = "data/evolution.jsonl";

// ---------------------------------------------------------------------------
// EvolutionEntry — persisted record of each nightly refinement
// ---------------------------------------------------------------------------

export interface EvolutionEntry {
  readonly timestamp: string;
  readonly agent_id: string;
  readonly window_days: number;
  readonly total_outcomes: number;
  readonly overall_win_rate: number;
  readonly insights: readonly string[];
  readonly concepts_reinforced: number;
  readonly concepts_decayed: number;
}

// ---------------------------------------------------------------------------
// refineFromReport
// ---------------------------------------------------------------------------

/**
 * Ingest the EvolutionReport back into the axon graph for `agentId`.
 * - Writes each insight as a typed "feature" observation (reinforcement signal)
 * - Directly reinforces concepts tied to successful outcomes
 * - Decays concepts tied exclusively to failed outcomes
 * - Appends a summary to evolution.jsonl for audit trail
 *
 * Returns an EvolutionEntry summary.
 */
export async function refineFromReport(
  report: EvolutionReport,
  config: Config,
  axonPath: string
): Promise<EvolutionEntry> {
  let conceptsReinforced = 0;
  let conceptsDecayed = 0;

  // Load the agent's axon
  const store = await AxonStore.load(axonPath);

  // 1. Write each insight as a "feature" typed observation node
  //    so the agent picks it up at next boot-inject
  if (report.insights.length > 0) {
    const insightText = report.insights.join(". ");
    const events = processText(insightText, 1.0, "concept", report.timestamp);
    for (const event of events) {
      store.mergeNode(event, report.agent_id, "feature");
      conceptsReinforced++;
    }
  }

  // 2. Boost nodes tied to successful top patterns
  //    We extract concept events from the top pattern names and strengthen them
  for (const p of report.top_patterns) {
    if (p.win_rate < 0.6) continue;
    const events = processText(p.pattern, 1.0, "concept", report.timestamp);
    for (const event of events) {
      store.mergeNode(event, report.agent_id, "feature");
      conceptsReinforced++;
    }
  }

  // 3. Add a decay signal for weak patterns — write as "change" observations
  //    (the scanner will naturally decay these further over time)
  for (const p of report.weak_patterns) {
    if (p.win_rate > 0.4) continue;
    const events = processText(`avoid ${p.pattern}`, 0.3, "concept", report.timestamp);
    for (const event of events) {
      store.mergeNode(event, report.agent_id, "change");
      conceptsDecayed++;
    }
  }

  // Save axon
  await store.save(axonPath);

  // 4. Append to evolution log
  const entry: EvolutionEntry = {
    timestamp: report.timestamp,
    agent_id: report.agent_id,
    window_days: report.window_days,
    total_outcomes: report.total_outcomes,
    overall_win_rate: report.overall_win_rate,
    insights: report.insights,
    concepts_reinforced: conceptsReinforced,
    concepts_decayed: conceptsDecayed,
  };

  const logPath = config.evolutionLogPath ?? DEFAULT_EVOLUTION_LOG;
  await appendEvolutionEntry(entry, logPath);

  return entry;
}

// ---------------------------------------------------------------------------
// appendEvolutionEntry
// ---------------------------------------------------------------------------

async function appendEvolutionEntry(entry: EvolutionEntry, logPath: string): Promise<void> {
  try {
    const dir = logPath.split("/").slice(0, -1).join("/");
    if (dir) await mkdir(dir, { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await Bun.write(
      Bun.file(logPath),
      (await Bun.file(logPath).text().catch(() => "")) + line
    );
  } catch {
    // Non-fatal — evolution still happened even if log write fails
  }
}

// ---------------------------------------------------------------------------
// readEvolutionLog
// ---------------------------------------------------------------------------

/**
 * Read all EvolutionEntry records from the evolution log.
 * Returns empty array if the file does not exist.
 */
export async function readEvolutionLog(logPath: string = DEFAULT_EVOLUTION_LOG): Promise<EvolutionEntry[]> {
  try {
    const text = await Bun.file(logPath).text();
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as EvolutionEntry);
  } catch {
    return [];
  }
}
