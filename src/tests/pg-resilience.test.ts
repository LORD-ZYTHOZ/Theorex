import { test, expect, describe, beforeEach } from "bun:test";
import {
  withRetry,
  CircuitBreaker,
  CircuitOpenError,
  isConnectionError,
  resetCircuitBreaker,
} from "../axon/pg-resilience";

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe("withRetry", () => {
  test("succeeds on first attempt", async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  test("retries on failure then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return Promise.resolve("ok");
      },
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("throws after max attempts exhausted", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          return Promise.reject(new Error("permanent"));
        },
        { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 },
      ),
    ).rejects.toThrow("permanent");
    expect(calls).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

describe("CircuitBreaker", () => {
  test("starts in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
  });

  test("opens after threshold consecutive failures", () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 30_000,
      monitorWindowMs: 60_000,
    });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  test("checkState throws CircuitOpenError when open", () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
      monitorWindowMs: 60_000,
    });
    cb.recordFailure();
    expect(() => cb.checkState()).toThrow(CircuitOpenError);
  });

  test("transitions to half_open after resetTimeout", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50, // 50ms for fast test
      monitorWindowMs: 60_000,
    });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    await Bun.sleep(60);
    expect(cb.getState()).toBe("half_open");
  });

  test("closes on success after half_open", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
      monitorWindowMs: 60_000,
    });
    cb.recordFailure();
    await Bun.sleep(60);
    expect(cb.getState()).toBe("half_open");
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  test("re-opens on failure during half_open", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
      monitorWindowMs: 60_000,
    });
    cb.recordFailure();
    await Bun.sleep(60);
    expect(cb.getState()).toBe("half_open");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  test("success resets failure count", () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 30_000,
      monitorWindowMs: 60_000,
    });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed"); // only 1 failure since reset
  });
});

// ---------------------------------------------------------------------------
// isConnectionError
// ---------------------------------------------------------------------------

describe("isConnectionError", () => {
  test("detects ECONNREFUSED", () => {
    const err = new Error("connect failed");
    (err as NodeJS.ErrnoException).code = "ECONNREFUSED";
    expect(isConnectionError(err)).toBe(true);
  });

  test("detects connection terminated message", () => {
    expect(isConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
  });

  test("returns false for non-connection errors", () => {
    expect(isConnectionError(new Error("syntax error at position 42"))).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isConnectionError("string error")).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});
