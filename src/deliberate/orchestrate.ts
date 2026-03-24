// deliberate/orchestrate.ts — Core deliberation orchestrator.
// Wires together packet building, condensation, prompt construction,
// and LLM dispatch into a single runDeliberation() entry point.

import type {
  TradingSession,
  SessionPacket,
  DeliberationRecord,
  DeliberationStatus,
  PerspectiveReport,
} from "./types";
import { buildSessionPacket, condensePacket } from "./packet";
import { buildOrchestratorPrompt } from "./prompts";
import { emit } from "../trace/bus";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RunDeliberationOpts {
  readonly session: TradingSession;
  readonly date: string;
  readonly paths: {
    readonly singularity: string;
    readonly divergent: string;
    readonly horizon: string;
  };
  readonly outputDir: string;
  readonly model?: string;
  readonly force?: boolean;
  readonly dispatch: (prompt: string, maxTokens?: number) => Promise<string>;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runDeliberation(
  opts: RunDeliberationOpts,
): Promise<DeliberationRecord> {
  const {
    session,
    date,
    paths,
    dispatch,
    model = DEFAULT_MODEL,
  } = opts;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  emit("DELIBERATION_START", { date, session });

  // 1. Build session packet from raw data files
  const packet = await buildSessionPacket({
    session,
    date,
    singularityPath: paths.singularity,
    divergentPath: paths.divergent,
    horizonPath: paths.horizon,
  });

  // 2. Condense packet for LLM context window
  const condensed = condensePacket(packet);

  // 3. Extract perspective reports by source for the orchestrator prompt
  const perspectives = extractPerspectives(condensed.perspectives);

  emit("DELIBERATION_ROUND", {
    date,
    session,
    round: 1,
    perspective: "orchestrator",
  });

  // 4. Build the orchestrator prompt
  const prompt = buildOrchestratorPrompt(condensed, perspectives);

  // 5. Dispatch to LLM and build the record
  const startMs = performance.now();

  try {
    const response = await dispatch(prompt);
    const latencyMs = Math.round(performance.now() - startMs);
    const completedAt = new Date().toISOString();

    const record: DeliberationRecord = {
      id,
      date,
      session,
      status: "complete",
      packet,
      prompt,
      response,
      model,
      latency_ms: latencyMs,
      created_at: createdAt,
      completed_at: completedAt,
    };

    emit("DELIBERATION_COMPLETE", {
      date,
      session,
      status: "complete",
      latency_ms: latencyMs,
      perspectives_collected: condensed.perspectives.length,
    });

    return record;
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startMs);
    const completedAt = new Date().toISOString();
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    const record: DeliberationRecord = {
      id,
      date,
      session,
      status: "error",
      packet,
      prompt,
      model,
      latency_ms: latencyMs,
      created_at: createdAt,
      completed_at: completedAt,
      error: errorMessage,
    };

    emit("DELIBERATION_COMPLETE", {
      date,
      session,
      status: "error",
      latency_ms: latencyMs,
      perspectives_collected: condensed.perspectives.length,
      error: errorMessage,
    });

    return record;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PerspectiveMap {
  readonly singularity: PerspectiveReport | null;
  readonly divergent: PerspectiveReport | null;
  readonly horizon: PerspectiveReport | null;
}

function extractPerspectives(
  reports: readonly PerspectiveReport[],
): PerspectiveMap {
  return {
    singularity: reports.find((r) => r.source === "singularity") ?? null,
    divergent: reports.find((r) => r.source === "divergent") ?? null,
    horizon: reports.find((r) => r.source === "horizon") ?? null,
  };
}
