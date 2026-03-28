// trace/bus.ts — EventBus for non-invasive pub/sub trace collection.
// Phase 15.5 distributed inference foundations: captures LM inference, tool calls, and
// routing decisions as structured trace records without touching call sites.
//
// Pattern: emit() events at instrumented boundaries → bus auto-assembles
// LM_INFERENCE_START/END pairs into TraceRecord → writes to data/traces/{uuid}.json

import { mkdir, rename } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import type { TradingSession, DeliberationStatus } from "../deliberate/types";

// ---------------------------------------------------------------------------
// Event type literals
// ---------------------------------------------------------------------------

export type BusEventType =
  | "LM_INFERENCE_START"
  | "LM_INFERENCE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_END"
  | "ROUTING_DECISION"
  | "OUTCOME_RECORDED"
  | "DELIBERATION_START"
  | "DELIBERATION_ROUND"
  | "DELIBERATION_COMPLETE"
  | "RESILIENCE_ERROR"
  | "CIRCUIT_STATE_CHANGE"
  | "CRITICAL_ALERT";

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface LmInferenceStartPayload {
  readonly agent_id: string;
  readonly model: string;
  readonly prompt_tokens: number;
  readonly query_type: string;
  readonly trace_id?: string; // caller-supplied — if set, EventBus uses this ID instead of randomUUID
}

export interface LmInferenceEndPayload {
  readonly agent_id: string;
  readonly model: string;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly latency_ms: number;
  readonly success: boolean;
  readonly error?: string;
}

export interface ToolCallStartPayload {
  readonly agent_id: string;
  readonly tool_name: string;
}

export interface ToolCallEndPayload {
  readonly agent_id: string;
  readonly tool_name: string;
  readonly latency_ms: number;
  readonly success: boolean;
}

export interface RoutingDecisionPayload {
  readonly agent_id: string;
  readonly chosen_model: string;
  readonly reason: string;
  readonly context_pct: number;
  readonly query_tokens: number;
}

export interface OutcomeRecordedPayload {
  readonly agent_id: string;
  readonly outcome_id: string;
  readonly success: boolean;
}

export interface DeliberationStartPayload {
  readonly date: string;
  readonly session: TradingSession;
}

export interface DeliberationRoundPayload {
  readonly date: string;
  readonly session: TradingSession;
  readonly round: number;
  readonly perspective: string;
}

export interface DeliberationCompletePayload {
  readonly date: string;
  readonly session: TradingSession;
  readonly status: DeliberationStatus;
  readonly latency_ms: number;
  readonly perspectives_collected: number;
  readonly error?: string;
}

export interface ResilienceErrorPayload {
  readonly service: string;
  readonly category: string;
  readonly severity: string;
  readonly message: string;
  readonly agent_id: string;
  readonly context: Record<string, unknown>;
}

export interface CircuitStateChangePayload {
  readonly service: string;
  readonly from: "closed" | "half_open" | "open";
  readonly to: "closed" | "half_open" | "open";
  readonly failure_count: number;
}

export interface CriticalAlertPayload {
  readonly service: string;
  readonly message: string;
  readonly agent_id: string;
  readonly context: Record<string, unknown>;
}

// Discriminated union mapping event type → payload
export type BusEventPayloadMap = {
  LM_INFERENCE_START: LmInferenceStartPayload;
  LM_INFERENCE_END: LmInferenceEndPayload;
  TOOL_CALL_START: ToolCallStartPayload;
  TOOL_CALL_END: ToolCallEndPayload;
  ROUTING_DECISION: RoutingDecisionPayload;
  OUTCOME_RECORDED: OutcomeRecordedPayload;
  DELIBERATION_START: DeliberationStartPayload;
  DELIBERATION_ROUND: DeliberationRoundPayload;
  DELIBERATION_COMPLETE: DeliberationCompletePayload;
  RESILIENCE_ERROR: ResilienceErrorPayload;
  CIRCUIT_STATE_CHANGE: CircuitStateChangePayload;
  CRITICAL_ALERT: CriticalAlertPayload;
};

export interface BusEvent<T extends BusEventType = BusEventType> {
  readonly type: T;
  readonly timestamp: string; // ISO 8601
  readonly payload: BusEventPayloadMap[T];
}

// ---------------------------------------------------------------------------
// TraceRecord — a full assembled inference session
// ---------------------------------------------------------------------------

export interface TraceRecord {
  readonly id: string;                         // crypto.randomUUID()
  readonly agent_id: string;
  readonly model: string;
  readonly start_time: string;                 // ISO 8601
  readonly end_time: string;                   // ISO 8601
  readonly total_tokens: number;               // prompt + completion
  readonly latency_ms: number;
  readonly success: boolean;
  readonly error?: string;
  readonly tags: readonly string[];
  readonly events: readonly BusEvent[];        // full ordered event sequence
}

// ---------------------------------------------------------------------------
// TraceStore
// ---------------------------------------------------------------------------

export const DEFAULT_TRACES_DIR = "data/traces";

/**
 * Write a TraceRecord atomically to {dir}/{trace.id}.json.
 * Uses tmp→rename for durability, same pattern as outcomes.
 */
async function writeTrace(
  trace: TraceRecord,
  dir: string = DEFAULT_TRACES_DIR
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${trace.id}.json`;
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(trace, null, 2));
  await rename(tmpPath, filePath);
}

/**
 * Read all TraceRecord files from the given directory.
 * Silently skips files that fail to parse.
 */
export async function readTraces(
  dir: string = DEFAULT_TRACES_DIR
): Promise<TraceRecord[]> {
  try {
    const entries = await readdir(dir);
    const jsonFiles = entries.filter(
      (e) => e.endsWith(".json") && !e.endsWith(".tmp")
    );
    const results = await Promise.allSettled(
      jsonFiles.map(async (file) => {
        const raw = await Bun.file(`${dir}/${file}`).json();
        return raw as TraceRecord;
      })
    );
    return results
      .filter((r): r is PromiseFulfilledResult<TraceRecord> => r.status === "fulfilled")
      .map((r) => r.value);
  } catch {
    return [];
  }
}

/**
 * Read traces recorded after a given ISO 8601 timestamp.
 */
export async function readTracesSince(
  since: string,
  dir: string = DEFAULT_TRACES_DIR
): Promise<TraceRecord[]> {
  const all = await readTraces(dir);
  const sinceMs = new Date(since).getTime();
  return all.filter((t) => new Date(t.start_time).getTime() >= sinceMs);
}

// ---------------------------------------------------------------------------
// In-flight session state (mutable internal only — never exposed)
// ---------------------------------------------------------------------------

interface InFlightSession {
  readonly agent_id: string;
  readonly model: string;
  readonly start_time: string;
  readonly prompt_tokens: number;
  readonly query_type: string;
  readonly events: BusEvent[];
  readonly trace_id?: string; // caller-supplied trace ID (from LM_INFERENCE_START payload)
}

// ---------------------------------------------------------------------------
// EventBus — singleton pub/sub
// ---------------------------------------------------------------------------

type Listener<T extends BusEventType> = (event: BusEvent<T>) => void;
type AnyListener = (event: BusEvent) => void;

export class EventBus {
  // listener map: eventType → Set<listener>
  private readonly listeners = new Map<BusEventType, Set<AnyListener>>();
  // in-flight inference sessions keyed by agent_id (one active session per agent)
  private readonly inFlight = new Map<string, InFlightSession>();
  // configurable traces directory — set via setTracesDir()
  private tracesDir: string = DEFAULT_TRACES_DIR;

  // ---------------------------------------------------------------------------
  // Subscribe / unsubscribe
  // ---------------------------------------------------------------------------

  on<T extends BusEventType>(type: T, listener: Listener<T>): void {
    const set = this.listeners.get(type) ?? new Set<AnyListener>();
    set.add(listener as AnyListener);
    this.listeners.set(type, set);
  }

  off<T extends BusEventType>(type: T, listener: Listener<T>): void {
    this.listeners.get(type)?.delete(listener as AnyListener);
  }

  // ---------------------------------------------------------------------------
  // Emit — dispatches to subscribers then runs internal trace assembler
  // ---------------------------------------------------------------------------

  emit<T extends BusEventType>(type: T, payload: BusEventPayloadMap[T]): void {
    const event: BusEvent<T> = {
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    // Dispatch to external subscribers
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        listener(event as BusEvent);
      } catch {
        // listeners must not crash the bus
      }
    }
    // Internal trace assembly (fire-and-forget)
    void this.handleForTrace(event as BusEvent);
  }

  // ---------------------------------------------------------------------------
  // Trace assembly — pairs START/END into TraceRecord
  // ---------------------------------------------------------------------------

  private handleForTrace(event: BusEvent): Promise<void> {
    if (event.type === "LM_INFERENCE_START") {
      return this.handleInferenceStart(event as BusEvent<"LM_INFERENCE_START">);
    }
    if (event.type === "LM_INFERENCE_END") {
      return this.handleInferenceEnd(event as BusEvent<"LM_INFERENCE_END">);
    }
    // Append other events to active session if one exists for this agent
    const agentId = this.extractAgentId(event);
    if (agentId) {
      const session = this.inFlight.get(agentId);
      if (session) {
        this.inFlight.set(agentId, appendEvent(session, event));
      }
    }
    return Promise.resolve();
  }

  private handleInferenceStart(event: BusEvent<"LM_INFERENCE_START">): Promise<void> {
    const { agent_id, model, prompt_tokens, query_type, trace_id } = event.payload;
    const session: InFlightSession = {
      agent_id,
      model,
      start_time: event.timestamp,
      prompt_tokens,
      query_type,
      events: [event as BusEvent],
      ...(trace_id ? { trace_id } : {}),
    };
    this.inFlight.set(agent_id, session);
    return Promise.resolve();
  }

  private async handleInferenceEnd(event: BusEvent<"LM_INFERENCE_END">): Promise<void> {
    const { agent_id, completion_tokens, latency_ms, success, error } = event.payload;
    const session = this.inFlight.get(agent_id);
    if (!session) return;

    this.inFlight.delete(agent_id);
    const finalEvents = [...appendEvent(session, event).events];

    const trace: TraceRecord = {
      // Use caller-supplied trace_id if present, otherwise generate a new one.
      // This allows dispatch() to know the trace_id before the trace is written.
      id: session.trace_id ?? crypto.randomUUID(),
      agent_id,
      model: session.model,
      start_time: session.start_time,
      end_time: event.timestamp,
      total_tokens: session.prompt_tokens + completion_tokens,
      latency_ms,
      success,
      ...(error ? { error } : {}),
      tags: [session.query_type, session.model].filter(Boolean),
      events: finalEvents,
    };

    await writeTrace(trace, this.tracesDir).catch(() => {
      // storage failures must not crash the bus
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractAgentId(event: BusEvent): string | undefined {
    const p = event.payload as unknown as Record<string, unknown>;
    return typeof p["agent_id"] === "string" ? p["agent_id"] : undefined;
  }

  /** Override the default traces directory (useful for tests). */
  setTracesDir(dir: string): void {
    this.tracesDir = dir;
  }
}

// ---------------------------------------------------------------------------
// Immutable append helper — never mutates InFlightSession
// ---------------------------------------------------------------------------

function appendEvent(session: InFlightSession, event: BusEvent): InFlightSession {
  return {
    ...session,
    events: [...session.events, event],
  };
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const bus = new EventBus();

/**
 * Convenience wrapper — emit an event on the singleton bus.
 */
export function emit<T extends BusEventType>(
  type: T,
  payload: BusEventPayloadMap[T]
): void {
  bus.emit(type, payload);
}

/**
 * Convenience wrapper — subscribe to the singleton bus.
 */
export function on<T extends BusEventType>(
  type: T,
  listener: Listener<T>
): void {
  bus.on(type, listener);
}

/**
 * Convenience wrapper — unsubscribe from the singleton bus.
 */
export function off<T extends BusEventType>(
  type: T,
  listener: Listener<T>
): void {
  bus.off(type, listener);
}
