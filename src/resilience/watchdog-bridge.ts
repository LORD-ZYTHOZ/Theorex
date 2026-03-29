// src/resilience/watchdog-bridge.ts — Bridges watchdog shell events into Theorex ErrorEvent bus.

import type { ErrorEvent, Severity } from "./types";
import { emitError, emitCritical } from "./error-bus";
import { randomUUID } from "crypto";

export interface WatchdogEvent {
  readonly type: "panic" | "oc_mismatch" | "thermal";
  readonly severity: Severity;
  readonly message: string;
  readonly timestamp: string;
  readonly context: Record<string, unknown>;
}

const SEVERITY_MAP: Record<string, Severity> = {
  panic: "critical",
  oc_mismatch: "critical",
  thermal: "high",
};

export function parseWatchdogEvent(raw: Record<string, unknown>): WatchdogEvent {
  const type = raw.type as string;
  const severity = SEVERITY_MAP[type] ?? "medium";
  const timestamp = (raw.timestamp as string) ?? new Date().toISOString();

  return {
    type: type as WatchdogEvent["type"],
    severity,
    message: (raw.message as string) ?? `Watchdog ${type} event`,
    timestamp,
    context: { ...raw },
  };
}

export function toErrorEvent(event: WatchdogEvent): ErrorEvent {
  return {
    id: randomUUID(),
    service: `watchdog:${event.type}`,
    category: "permanent",
    severity: event.severity,
    message: event.message,
    context: event.context,
    timestamp: event.timestamp,
    agent_id: "hades",
  };
}

export function bridgeWatchdogEvent(raw: Record<string, unknown>): void {
  const event = parseWatchdogEvent(raw);
  const errorEvent = toErrorEvent(event);

  emitError(errorEvent);

  if (event.severity === "critical") {
    emitCritical(errorEvent.service, errorEvent.message, "hades", errorEvent.context);
  }
}
