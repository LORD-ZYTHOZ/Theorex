import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { bus, type BusEvent } from "../../trace/bus";
import {
  createBreaker,
  getBreakerState,
  getAllBreakerStates,
  resetRegistry,
} from "../../resilience/circuit";

// Collect CIRCUIT_STATE_CHANGE events
const stateChanges: BusEvent[] = [];
const listener = (e: BusEvent) => stateChanges.push(e);

beforeEach(() => {
  resetRegistry(); // clean slate per test
  stateChanges.length = 0;
  bus.on("CIRCUIT_STATE_CHANGE", listener);
});

afterEach(() => {
  bus.off("CIRCUIT_STATE_CHANGE", listener);
});

describe("createBreaker", () => {
  test("returns a policy with execute method", () => {
    const breaker = createBreaker("test-service");
    expect(typeof breaker.execute).toBe("function");
  });

  test("is idempotent — same ServiceId returns same instance", () => {
    const a = createBreaker("svc-a");
    const b = createBreaker("svc-a");
    expect(a).toBe(b);
  });

  test("different ServiceIds return different instances", () => {
    const a = createBreaker("svc-a");
    const b = createBreaker("svc-b");
    expect(a).not.toBe(b);
  });
});

describe("circuit breaker behavior", () => {
  test("passes through successful calls", async () => {
    const breaker = createBreaker("success-svc", { threshold: 3 });
    const result = await breaker.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  test("opens after threshold consecutive failures", async () => {
    const breaker = createBreaker("fail-svc", { threshold: 2, halfOpenAfterMs: 60_000 });

    // Fail twice to trip the breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    const state = getBreakerState("fail-svc");
    expect(state?.state).toBe("open");
    expect(state?.failure_count).toBe(2);
  });

  test("emits CIRCUIT_STATE_CHANGE when opening", async () => {
    const breaker = createBreaker("emit-svc", { threshold: 1 });

    try {
      await breaker.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    const change = stateChanges.find(
      (e) => (e.payload as { to: string }).to === "open"
    );
    expect(change).toBeDefined();
  });

  test("rejects immediately when open (circuit_open)", async () => {
    const breaker = createBreaker("reject-svc", { threshold: 1, halfOpenAfterMs: 60_000 });

    // Trip the breaker
    try {
      await breaker.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    // Next call should fail immediately without executing the function
    let called = false;
    try {
      await breaker.execute(() => { called = true; return Promise.resolve("ok"); });
    } catch (err) {
      expect(called).toBe(false); // function was never called
    }
  });
});

describe("getBreakerState / getAllBreakerStates", () => {
  test("returns undefined for unknown service", () => {
    expect(getBreakerState("nonexistent")).toBeUndefined();
  });

  test("getAllBreakerStates returns all registered breakers", () => {
    createBreaker("svc-1");
    createBreaker("svc-2");
    const states = getAllBreakerStates();
    expect(states.length).toBe(2);
  });
});
