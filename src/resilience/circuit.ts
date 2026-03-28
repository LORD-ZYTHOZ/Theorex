// src/resilience/circuit.ts — Circuit breaker factory backed by cockatiel.
// One breaker per ServiceId, idempotent. Hooks wired at construction time.

import {
  circuitBreaker,
  handleAll,
  ConsecutiveBreaker,
  type CircuitBreakerPolicy,
} from "cockatiel";
import { emitCircuitChange } from "./error-bus";
import type { ServiceId, CircuitState } from "./types";

// ---------------------------------------------------------------------------
// Internal registry — immutable replacement on state change
// ---------------------------------------------------------------------------

interface BreakerEntry {
  readonly policy: CircuitBreakerPolicy;
  readonly state: CircuitState;
}

const registry = new Map<ServiceId, BreakerEntry>();

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBreaker(
  service: ServiceId,
  opts?: {
    readonly threshold?: number;
    readonly halfOpenAfterMs?: number;
  },
): CircuitBreakerPolicy {
  const existing = registry.get(service);
  if (existing) return existing.policy;

  const threshold = opts?.threshold ?? 3;
  const halfOpenAfterMs = opts?.halfOpenAfterMs ?? 30_000;

  const policy = circuitBreaker(handleAll, {
    breaker: new ConsecutiveBreaker(threshold),
    halfOpenAfter: halfOpenAfterMs,
  });

  const initialState: CircuitState = {
    service,
    state: "closed",
    failure_count: 0,
    last_failure: null,
    opened_at: null,
  };

  registry.set(service, { policy, state: initialState });

  // Wire cockatiel hooks — all event emission happens here, not by caller.
  // onBreak fires when circuit opens (threshold failures reached).
  // We set failure_count = threshold since that's what triggered the break.
  policy.onBreak(() => {
    const current = registry.get(service)!;
    const prev = current.state;
    const now = new Date().toISOString();
    const newState: CircuitState = {
      ...prev,
      state: "open",
      failure_count: threshold,
      last_failure: now,
      opened_at: prev.opened_at ?? now,
    };
    registry.set(service, { ...current, state: newState });
    emitCircuitChange(service, prev.state, "open", newState.failure_count);
  });

  policy.onReset(() => {
    const current = registry.get(service)!;
    const prev = current.state;
    const newState: CircuitState = {
      ...prev,
      state: "closed",
      failure_count: 0,
      opened_at: null,
    };
    registry.set(service, { ...current, state: newState });
    emitCircuitChange(service, prev.state, "closed", 0);
  });

  policy.onHalfOpen(() => {
    const current = registry.get(service)!;
    const prev = current.state;
    const newState: CircuitState = { ...prev, state: "half_open" };
    registry.set(service, { ...current, state: newState });
    emitCircuitChange(service, prev.state, "half_open", prev.failure_count);
  });

  return policy;
}

// ---------------------------------------------------------------------------
// State queries
// ---------------------------------------------------------------------------

export function getBreakerState(service: ServiceId): CircuitState | undefined {
  return registry.get(service)?.state;
}

export function getAllBreakerStates(): readonly CircuitState[] {
  return [...registry.values()].map((e) => e.state);
}

/** Reset registry — for tests only. */
export function resetRegistry(): void {
  registry.clear();
}
