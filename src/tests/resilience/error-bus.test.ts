import { describe, test, expect, afterEach } from "bun:test";
import { bus, type BusEvent } from "../../trace/bus";
import { emitError, emitCircuitChange, emitCritical } from "../../resilience/error-bus";
import type { ErrorEvent } from "../../resilience/types";

describe("emitError", () => {
  const received: BusEvent[] = [];
  const listener = (e: BusEvent) => received.push(e);

  afterEach(() => {
    bus.off("RESILIENCE_ERROR", listener);
    received.length = 0;
  });

  test("pipes ErrorEvent to RESILIENCE_ERROR on EventBus", () => {
    bus.on("RESILIENCE_ERROR", listener);

    const event: ErrorEvent = {
      id: crypto.randomUUID(),
      service: "lmstudio:8082",
      category: "transient",
      severity: "medium",
      message: "connection refused",
      context: { endpoint: "http://localhost:8082" },
      timestamp: new Date().toISOString(),
      agent_id: "main",
    };

    emitError(event);
    expect(received.length).toBe(1);
    expect(received[0]!.type).toBe("RESILIENCE_ERROR");
  });

  test("payload contains service, category, severity, message", () => {
    bus.on("RESILIENCE_ERROR", listener);

    emitError({
      id: crypto.randomUUID(),
      service: "grok",
      category: "timeout",
      severity: "high",
      message: "timed out after 120s",
      context: {},
      timestamp: new Date().toISOString(),
      agent_id: "main",
    });

    const payload = received[0]!.payload as { service: string; severity: string };
    expect(payload.service).toBe("grok");
    expect(payload.severity).toBe("high");
  });
});

describe("emitCircuitChange", () => {
  const received: BusEvent[] = [];
  const listener = (e: BusEvent) => received.push(e);

  afterEach(() => {
    bus.off("CIRCUIT_STATE_CHANGE", listener);
    received.length = 0;
  });

  test("emits CIRCUIT_STATE_CHANGE with from/to states", () => {
    bus.on("CIRCUIT_STATE_CHANGE", listener);
    emitCircuitChange("lmstudio:8082", "closed", "open", 3);

    expect(received.length).toBe(1);
    const payload = received[0]!.payload as { from: string; to: string; failure_count: number };
    expect(payload.from).toBe("closed");
    expect(payload.to).toBe("open");
    expect(payload.failure_count).toBe(3);
  });
});

describe("emitCritical", () => {
  const received: BusEvent[] = [];
  const listener = (e: BusEvent) => received.push(e);

  afterEach(() => {
    bus.off("CRITICAL_ALERT", listener);
    received.length = 0;
  });

  test("emits CRITICAL_ALERT with service and message", () => {
    bus.on("CRITICAL_ALERT", listener);
    emitCritical("lmstudio:8082", "all providers down", "main", { affected: ["dispatch"] });

    expect(received.length).toBe(1);
    expect(received[0]!.type).toBe("CRITICAL_ALERT");
    const payload = received[0]!.payload as { message: string };
    expect(payload.message).toBe("all providers down");
  });
});
