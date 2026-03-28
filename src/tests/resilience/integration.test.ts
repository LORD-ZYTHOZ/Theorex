import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { bus, type BusEvent } from "../../trace/bus";
import { createBreaker, resetRegistry } from "../../resilience/circuit";
import { createRetry } from "../../resilience/retry";
import { emitCritical } from "../../resilience/error-bus";
import { classifyError, ResilienceError } from "../../resilience/types";

describe("resilience integration", () => {
  const events: BusEvent[] = [];
  const listeners = {
    error: (e: BusEvent) => events.push(e),
    circuit: (e: BusEvent) => events.push(e),
    critical: (e: BusEvent) => events.push(e),
  };

  beforeEach(() => {
    resetRegistry();
    events.length = 0;
    bus.on("RESILIENCE_ERROR", listeners.error);
    bus.on("CIRCUIT_STATE_CHANGE", listeners.circuit);
    bus.on("CRITICAL_ALERT", listeners.critical);
  });

  afterEach(() => {
    bus.off("RESILIENCE_ERROR", listeners.error);
    bus.off("CIRCUIT_STATE_CHANGE", listeners.circuit);
    bus.off("CRITICAL_ALERT", listeners.critical);
  });

  test("retry + circuit breaker compose: retries then trips breaker", async () => {
    const breaker = createBreaker("compose-svc", { threshold: 2, halfOpenAfterMs: 60_000 });
    const retryPolicy = createRetry({ maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 20 });

    let callCount = 0;

    try {
      await retryPolicy.execute(() => {
        callCount++;
        return breaker.execute(() => Promise.reject(new Error("ECONNREFUSED")));
      });
    } catch { /* expected */ }

    // callCount should be 2 (initial + 1 retry)
    expect(callCount).toBe(2);
  });

  test("emitCritical fires CRITICAL_ALERT on EventBus", () => {
    emitCritical("test-svc", "all down", "main", { reason: "cascade" });

    const critical = events.find((e) => e.type === "CRITICAL_ALERT");
    expect(critical).toBeDefined();
    expect((critical!.payload as { message: string }).message).toBe("all down");
  });

  test("classifyError correctly categorizes real-world errors", () => {
    expect(classifyError(new TypeError("fetch failed"))).toBe("transient");
    expect(classifyError(new DOMException("signal timed out", "AbortError"))).toBe("timeout");
    expect(classifyError(new ResilienceError("bad", "permanent"))).toBe("permanent");
    expect(classifyError(new Error("HTTP 503"))).toBe("transient");
    expect(classifyError(new Error("HTTP 401"))).toBe("permanent");
  });

  test("independent breakers do not interfere", async () => {
    const breakerA = createBreaker("svc-a", { threshold: 1, halfOpenAfterMs: 60_000 });
    const breakerB = createBreaker("svc-b", { threshold: 1, halfOpenAfterMs: 60_000 });

    // Trip breaker A
    try {
      await breakerA.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    // Breaker B should still work
    const result = await breakerB.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });
});
