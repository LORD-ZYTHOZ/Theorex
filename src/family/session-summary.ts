// family/session-summary.ts — Structured session capture for Phase 8b.
// Inspired by claude-mem's SessionSummaryRecord pattern.
//
// Maps each summary field to a typed observation so the axon knows WHY
// something was stored, not just what:
//   investigated → "discovery"   (what was explored)
//   learned      → "decision"    (insight or conclusion reached)
//   completed    → "feature"     (work finished this session)
//   next_steps   → "change"      (planned future actions)

import { writeToAgent } from "./write";
import type { Config } from "../config";

export interface SessionSummary {
  readonly investigated?: string;
  readonly learned?: string;
  readonly completed?: string;
  readonly next_steps?: string;
}

export interface SessionSummaryResult {
  readonly agentId: string;
  readonly fieldsWritten: number;
  readonly conceptsAdded: number;
  readonly edgesAdded: number;
}

const FIELD_TO_OBS_TYPE: Record<keyof SessionSummary, string> = {
  investigated: "discovery",
  learned: "decision",
  completed: "feature",
  next_steps: "change",
};

/**
 * Write a structured session summary into an agent's private axon.
 * Each non-empty field is stored as a typed observation.
 */
export async function writeSessionSummary(
  agentId: string,
  summary: SessionSummary,
  config: Config,
  nowMs: number = Date.now(),
): Promise<SessionSummaryResult> {
  let fieldsWritten = 0;
  let totalConcepts = 0;
  let totalEdges = 0;

  for (const [field, obsType] of Object.entries(FIELD_TO_OBS_TYPE) as [keyof SessionSummary, string][]) {
    const text = summary[field];
    if (!text?.trim()) continue;

    const result = await writeToAgent(agentId, text, config, nowMs, obsType);
    totalConcepts += result.conceptsAdded;
    totalEdges += result.edgesAdded;
    fieldsWritten++;
  }

  return { agentId, fieldsWritten, conceptsAdded: totalConcepts, edgesAdded: totalEdges };
}
