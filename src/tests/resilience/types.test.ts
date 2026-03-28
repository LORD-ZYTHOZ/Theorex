import { describe, test, expect } from "bun:test";
import {
  classifyError,
  ResilienceError,
  type ErrorEvent,
  type ErrorCategory,
} from "../../resilience/types";

describe("ResilienceError", () => {
  test("carries category through to classifyError", () => {
    const err = new ResilienceError("test", "permanent");
    expect(classifyError(err)).toBe("permanent");
  });

  test("is instanceof Error", () => {
    const err = new ResilienceError("msg", "transient");
    expect(err instanceof Error).toBe(true);
    expect(err.message).toBe("msg");
  });
});

describe("classifyError", () => {
  test("AbortError → timeout", () => {
    const err = new DOMException("aborted", "AbortError");
    expect(classifyError(err)).toBe("timeout");
  });

  test("TypeError (fetch failure) → transient", () => {
    expect(classifyError(new TypeError("fetch failed"))).toBe("transient");
  });

  test("ECONNREFUSED → transient", () => {
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:8082"))).toBe("transient");
  });

  test("HTTP 404 in message → permanent", () => {
    expect(classifyError(new Error("LM Studio returned HTTP 404"))).toBe("permanent");
  });

  test("HTTP 502 in message → transient", () => {
    expect(classifyError(new Error("HTTP 502 Bad Gateway"))).toBe("transient");
  });

  test("BrokenCircuitError → circuit_open", () => {
    const err = new Error("circuit is open");
    err.name = "BrokenCircuitError";
    expect(classifyError(err)).toBe("circuit_open");
  });

  test("number containing 4xx does NOT false-positive as permanent", () => {
    expect(classifyError(new Error("timeout after 4000ms"))).toBe("timeout");
  });

  test("unknown error defaults to transient", () => {
    expect(classifyError("something weird")).toBe("transient");
  });
});

describe("ErrorEvent construction", () => {
  test("creates valid ErrorEvent with all fields", () => {
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
    expect(event.service).toBe("lmstudio:8082");
    expect(event.category).toBe("transient");
  });
});
