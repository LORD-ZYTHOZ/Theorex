import { describe, test, expect } from "bun:test";
import { createRetry } from "../../resilience/retry";
import { ResilienceError } from "../../resilience/types";

describe("createRetry", () => {
  test("returns a policy with execute method", () => {
    const retry = createRetry();
    expect(typeof retry.execute).toBe("function");
  });

  test("passes through successful calls without retry", async () => {
    const retry = createRetry();
    let callCount = 0;
    const result = await retry.execute(() => {
      callCount++;
      return Promise.resolve("ok");
    });
    expect(result).toBe("ok");
    expect(callCount).toBe(1);
  });

  test("retries transient errors up to maxAttempts", async () => {
    const retry = createRetry({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20 });
    let callCount = 0;

    try {
      await retry.execute(() => {
        callCount++;
        throw new Error("connect ECONNREFUSED 127.0.0.1:8082");
      });
    } catch { /* expected — all attempts fail */ }

    expect(callCount).toBe(3);
  });

  test("does NOT retry permanent errors", async () => {
    const retry = createRetry({ maxAttempts: 3, baseDelayMs: 10 });
    let callCount = 0;

    try {
      await retry.execute(() => {
        callCount++;
        throw new ResilienceError("bad request", "permanent");
      });
    } catch { /* expected */ }

    expect(callCount).toBe(1); // no retry
  });

  test("does NOT retry circuit_open errors", async () => {
    const retry = createRetry({ maxAttempts: 3, baseDelayMs: 10 });
    let callCount = 0;

    try {
      await retry.execute(() => {
        callCount++;
        throw new ResilienceError("circuit open", "circuit_open");
      });
    } catch { /* expected */ }

    expect(callCount).toBe(1);
  });

  test("succeeds on retry after transient failure", async () => {
    const retry = createRetry({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20 });
    let callCount = 0;

    const result = await retry.execute(() => {
      callCount++;
      if (callCount < 2) throw new TypeError("fetch failed");
      return Promise.resolve("recovered");
    });

    expect(result).toBe("recovered");
    expect(callCount).toBe(2);
  });
});
