// src/resilience/error-bus.ts — Bridge resilience events to the existing EventBus.
// No direct coupling to alert.ts — alert subscribes to CRITICAL_ALERT independently.

import { emit } from "../trace/bus";
import type { ErrorEvent, ServiceId } from "./types";

export function emitError(event: ErrorEvent): void {
  emit("RESILIENCE_ERROR", {
    service: event.service,
    category: event.category,
    severity: event.severity,
    message: event.message,
    agent_id: event.agent_id,
    context: event.context,
  });
}

export function emitCircuitChange(
  service: ServiceId,
  from: "closed" | "half_open" | "open",
  to: "closed" | "half_open" | "open",
  failureCount: number,
): void {
  emit("CIRCUIT_STATE_CHANGE", {
    service,
    from,
    to,
    failure_count: failureCount,
  });
}

export function emitCritical(
  service: ServiceId,
  message: string,
  agentId: string,
  context: Record<string, unknown>,
): void {
  emit("CRITICAL_ALERT", {
    service,
    message,
    agent_id: agentId,
    context,
  });
}
