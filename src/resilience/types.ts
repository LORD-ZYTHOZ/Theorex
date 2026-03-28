// src/resilience/types.ts — Resilience layer data model.
// ErrorEvent is the structured event that flows through EventBus.
// classifyError determines retry behavior based on error shape.

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

export type ErrorCategory = "transient" | "permanent" | "timeout" | "circuit_open";
export type Severity = "low" | "medium" | "high" | "critical";
export type ServiceId = string;

// ---------------------------------------------------------------------------
// ErrorEvent — the structured event Nova consumes
// ---------------------------------------------------------------------------

export interface ErrorEvent {
  readonly id: string;
  readonly service: ServiceId;
  readonly category: ErrorCategory;
  readonly severity: Severity;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly timestamp: string; // ISO 8601
  readonly agent_id: string;
}

// ---------------------------------------------------------------------------
// CircuitState — internal per-service tracking
// ---------------------------------------------------------------------------

export interface CircuitState {
  readonly service: ServiceId;
  readonly state: "closed" | "half_open" | "open";
  readonly failure_count: number;
  readonly last_failure: string | null; // ISO 8601
  readonly opened_at: string | null;    // ISO 8601
}

// ---------------------------------------------------------------------------
// ResilienceError — typed error for explicit classification
// ---------------------------------------------------------------------------

export class ResilienceError extends Error {
  readonly category: ErrorCategory;
  constructor(message: string, category: ErrorCategory) {
    super(message);
    this.name = "ResilienceError";
    this.category = category;
  }
}

// ---------------------------------------------------------------------------
// classifyError — determines retry behavior
// ---------------------------------------------------------------------------

export function classifyError(err: unknown): ErrorCategory {
  if (err instanceof ResilienceError) return err.category;
  // cockatiel throws BrokenCircuitError when circuit is open
  if (err instanceof Error && err.name === "BrokenCircuitError") return "circuit_open";
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "transient";
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|socket hang up/i.test(msg)) return "transient";
  if (/timeout|timed out|aborted/i.test(msg)) return "timeout";
  if (/\bHTTP\s+4\d{2}\b/i.test(msg)) return "permanent";
  if (/\bHTTP\s+5\d{2}\b/i.test(msg)) return "transient";
  return "transient";
}
