// src/resilience/index.ts — Public API + wiring.
// Subscribes alert.ts to CRITICAL_ALERT events on import.

export {
  type ErrorEvent,
  type CircuitState,
  type ErrorCategory,
  type Severity,
  type ServiceId,
  ResilienceError,
  classifyError,
} from "./types";
export { createBreaker, getBreakerState, getAllBreakerStates } from "./circuit";
export { createRetry } from "./retry";
export { emitError, emitCircuitChange, emitCritical } from "./error-bus";
export { alertCritical, formatAlertMessage } from "./alert";
export { parseWatchdogEvent, toErrorEvent, bridgeWatchdogEvent, type WatchdogEvent } from "./watchdog-bridge";

// Wire alert subscription — fires on every CRITICAL_ALERT event
import { on, type BusEvent } from "../trace/bus";
import { alertCritical } from "./alert";
import type { ErrorEvent } from "./types";

on("CRITICAL_ALERT", (event: BusEvent<"CRITICAL_ALERT">) => {
  const errorEvent: ErrorEvent = {
    id: crypto.randomUUID(),
    service: event.payload.service,
    category: "permanent",
    severity: "critical",
    message: event.payload.message,
    context: event.payload.context,
    timestamp: event.timestamp,
    agent_id: event.payload.agent_id,
  };
  void alertCritical(errorEvent);
});
