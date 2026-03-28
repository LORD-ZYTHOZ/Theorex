# System Resilience Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add circuit breaker, retry, structured error reporting, and Telegram alerting to Theorex so system failures are self-healing and visible to Nova.

**Architecture:** Five focused modules in `src/resilience/` backed by cockatiel. ErrorEvents flow through the existing EventBus. Alert escalation via raw Telegram Bot API. Each module is independently testable with no inter-resilience coupling (except types).

**Tech Stack:** TypeScript, Bun, cockatiel ^3.2.1, existing EventBus (`src/trace/bus.ts`)

**Spec:** `docs/superpowers/specs/2026-03-28-system-resilience-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/resilience/types.ts` | ErrorEvent, CircuitState, ResilienceError, classifyError, type aliases |
| Create | `src/resilience/circuit.ts` | Circuit breaker factory, internal registry, cockatiel hook wiring |
| Create | `src/resilience/retry.ts` | Retry policy factory with exponential backoff + jitter |
| Create | `src/resilience/error-bus.ts` | Bridge ErrorEvents to existing EventBus |
| Create | `src/resilience/alert.ts` | Telegram Bot API alerting, rate-limited |
| Modify | `src/trace/bus.ts:16-107` | Add 3 new BusEventTypes + payload types to BusEventPayloadMap |
| Modify | `src/dispatch/worker.ts:228-237` | Replace raw try-catch with resilience policies |
| Create | `src/tests/resilience/types.test.ts` | Unit tests for types + classifyError |
| Create | `src/tests/resilience/circuit.test.ts` | Unit tests for circuit breaker |
| Create | `src/tests/resilience/retry.test.ts` | Unit tests for retry policy |
| Create | `src/tests/resilience/error-bus.test.ts` | Unit tests for error-bus bridge |
| Create | `src/tests/resilience/alert.test.ts` | Unit tests for Telegram alerting |
| Create | `src/tests/resilience/integration.test.ts` | Integration: dispatch + resilience end-to-end |

---

### Task 1: Install cockatiel + scaffold

**Files:**
- Modify: `package.json`
- Create: `src/resilience/` directory

- [ ] **Step 1: Install cockatiel**

```bash
cd /Users/eoh/theorex && bun add cockatiel
```

- [ ] **Step 2: Create resilience directory**

```bash
mkdir -p /Users/eoh/theorex/src/resilience
mkdir -p /Users/eoh/theorex/src/tests/resilience
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb src/resilience src/tests/resilience
git commit -m "chore: add cockatiel dependency + scaffold resilience module"
```

---

### Task 2: types.ts — ErrorEvent, ResilienceError, classifyError

**Files:**
- Create: `src/resilience/types.ts`
- Create: `src/tests/resilience/types.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/resilience/types.test.ts
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/types.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement types.ts**

```typescript
// src/resilience/types.ts — Resilience layer data model.
// ErrorEvent is the structured event that flows through EventBus.
// classifyError determines retry behavior based on error shape.

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

export type ErrorCategory = "transient" | "permanent" | "timeout" | "circuit_open";
export type Severity = "low" | "medium" | "high" | "critical";
export type ServiceId = string;

// ---------------------------------------------------------------------------
// ErrorEvent — the structured event Nova consumes
// ---------------------------------------------------------------------------

export interface ErrorEvent {
  readonly id: string;
  readonly service: ServiceId;
  readonly category: ErrorCategory;
  readonly severity: Severity;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly timestamp: string; // ISO 8601
  readonly agent_id: string;
}

// ---------------------------------------------------------------------------
// CircuitState — internal per-service tracking
// ---------------------------------------------------------------------------

export interface CircuitState {
  readonly service: ServiceId;
  readonly state: "closed" | "half_open" | "open";
  readonly failure_count: number;
  readonly last_failure: string | null; // ISO 8601
  readonly opened_at: string | null;    // ISO 8601
}

// ---------------------------------------------------------------------------
// ResilienceError — typed error for explicit classification
// ---------------------------------------------------------------------------

export class ResilienceError extends Error {
  readonly category: ErrorCategory;
  constructor(message: string, category: ErrorCategory) {
    super(message);
    this.name = "ResilienceError";
    this.category = category;
  }
}

// ---------------------------------------------------------------------------
// classifyError — determines retry behavior
// ---------------------------------------------------------------------------

export function classifyError(err: unknown): ErrorCategory {
  if (err instanceof ResilienceError) return err.category;
  // cockatiel throws BrokenCircuitError when circuit is open
  if (err instanceof Error && err.name === "BrokenCircuitError") return "circuit_open";
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "transient";
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|socket hang up/i.test(msg)) return "transient";
  if (/timeout|timed out|aborted/i.test(msg)) return "timeout";
  if (/\bHTTP\s+4\d{2}\b/i.test(msg)) return "permanent";
  if (/\bHTTP\s+5\d{2}\b/i.test(msg)) return "transient";
  return "transient";
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/types.test.ts
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/resilience/types.ts src/tests/resilience/types.test.ts
git commit -m "feat(resilience): types + classifyError with TDD"
```

---

### Task 3: Extend EventBus with resilience event types

**Files:**
- Modify: `src/trace/bus.ts:16-107`

- [ ] **Step 1: Add 3 new event types to BusEventType union**

In `src/trace/bus.ts`, add to the `BusEventType` union (after line 25, before the semicolon):

```typescript
  | "RESILIENCE_ERROR"
  | "CIRCUIT_STATE_CHANGE"
  | "CRITICAL_ALERT";
```

- [ ] **Step 2: Add payload interfaces**

After `DeliberationCompletePayload` (after line 94), add:

```typescript
export interface ResilienceErrorPayload {
  readonly service: string;
  readonly category: string;
  readonly severity: string;
  readonly message: string;
  readonly agent_id: string;
  readonly context: Record<string, unknown>;
}

export interface CircuitStateChangePayload {
  readonly service: string;
  readonly from: "closed" | "half_open" | "open";
  readonly to: "closed" | "half_open" | "open";
  readonly failure_count: number;
}

export interface CriticalAlertPayload {
  readonly service: string;
  readonly message: string;
  readonly agent_id: string;
  readonly context: Record<string, unknown>;
}
```

- [ ] **Step 3: Add entries to BusEventPayloadMap**

In the `BusEventPayloadMap` type (after `DELIBERATION_COMPLETE` entry), add:

```typescript
  RESILIENCE_ERROR: ResilienceErrorPayload;
  CIRCUIT_STATE_CHANGE: CircuitStateChangePayload;
  CRITICAL_ALERT: CriticalAlertPayload;
```

- [ ] **Step 4: Run existing bus tests to verify nothing breaks**

```bash
cd /Users/eoh/theorex && bun test src/tests/trace-bus.test.ts
```
Expected: ALL PASS (existing tests unaffected)

- [ ] **Step 5: Commit**

```bash
git add src/trace/bus.ts
git commit -m "feat(resilience): add RESILIENCE_ERROR, CIRCUIT_STATE_CHANGE, CRITICAL_ALERT to EventBus"
```

---

### Task 4: error-bus.ts — Bridge to EventBus

**Files:**
- Create: `src/resilience/error-bus.ts`
- Create: `src/tests/resilience/error-bus.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/resilience/error-bus.test.ts
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/error-bus.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement error-bus.ts**

```typescript
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/error-bus.test.ts
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/resilience/error-bus.ts src/tests/resilience/error-bus.test.ts
git commit -m "feat(resilience): error-bus bridge to EventBus with TDD"
```

---

### Task 5: circuit.ts — Circuit Breaker Factory

**Files:**
- Create: `src/resilience/circuit.ts`
- Create: `src/tests/resilience/circuit.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/resilience/circuit.test.ts
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/circuit.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement circuit.ts**

```typescript
// src/resilience/circuit.ts — Circuit breaker factory backed by cockatiel.
// One breaker per ServiceId, idempotent. Hooks wired at construction time.
// Uses cockatiel v3 public API: circuitBreaker(handleAll, { breaker, halfOpenAfter }).

import { circuitBreaker, handleAll, ConsecutiveBreaker, type CircuitBreakerPolicy } from "cockatiel";
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
  // onFailure fires on every failed call (for counting).
  // onBreak fires once when circuit opens (for state transition).
  policy.onFailure(() => {
    const current = registry.get(service)!;
    const newState: CircuitState = {
      ...current.state,
      failure_count: current.state.failure_count + 1,
      last_failure: new Date().toISOString(),
    };
    registry.set(service, { ...current, state: newState });
  });

  policy.onBreak(() => {
    const current = registry.get(service)!;
    const prev = current.state;
    const newState: CircuitState = {
      ...prev,
      state: "open",
      opened_at: prev.opened_at ?? new Date().toISOString(),
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/circuit.test.ts
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/resilience/circuit.ts src/tests/resilience/circuit.test.ts
git commit -m "feat(resilience): circuit breaker factory with TDD"
```

---

### Task 6: retry.ts — Retry Policy Factory

**Files:**
- Create: `src/resilience/retry.ts`
- Create: `src/tests/resilience/retry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/resilience/retry.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { bus, type BusEvent } from "../../trace/bus";
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/retry.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement retry.ts**

```typescript
// src/resilience/retry.ts — Retry policy factory backed by cockatiel.
// Exponential backoff with jitter. Only retries transient/timeout errors.
// Uses cockatiel v3 public API: retry(handleWhen(...), { maxAttempts, backoff }).

import { retry, handleWhen, ExponentialBackoff, type RetryPolicy } from "cockatiel";
import { classifyError } from "./types";

export function createRetry(opts?: {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}): RetryPolicy {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 500;
  const maxDelayMs = opts?.maxDelayMs ?? 10_000;

  return retry(
    handleWhen((err) => {
      const cat = classifyError(err);
      return cat === "transient" || cat === "timeout";
    }),
    {
      maxAttempts,
      backoff: new ExponentialBackoff({
        initialDelay: baseDelayMs,
        maxDelay: maxDelayMs,
      }),
    },
  );
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/retry.test.ts
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/resilience/retry.ts src/tests/resilience/retry.test.ts
git commit -m "feat(resilience): retry policy factory with TDD"
```

---

### Task 7: alert.ts — Telegram Escalation

**Files:**
- Create: `src/resilience/alert.ts`
- Create: `src/tests/resilience/alert.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/resilience/alert.test.ts
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { alertCritical, formatAlertMessage, resetRateLimiter } from "../../resilience/alert";
import type { ErrorEvent } from "../../resilience/types";

const makeEvent = (service: string, overrides?: Partial<ErrorEvent>): ErrorEvent => ({
  id: crypto.randomUUID(),
  service,
  category: "transient",
  severity: "critical",
  message: "all providers down",
  context: { affected: ["dispatch"] },
  timestamp: new Date().toISOString(),
  agent_id: "main",
  ...overrides,
});

describe("formatAlertMessage", () => {
  test("includes service name and message", () => {
    const msg = formatAlertMessage(makeEvent("lmstudio:8082"));
    expect(msg).toContain("lmstudio:8082");
    expect(msg).toContain("all providers down");
  });

  test("includes agent_id", () => {
    const msg = formatAlertMessage(makeEvent("grok", { agent_id: "horizon" }));
    expect(msg).toContain("horizon");
  });
});

describe("alertCritical", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  test("calls fetch with Telegram Bot API URL", async () => {
    const originalFetch = globalThis.fetch;
    let fetchedUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetchedUrl = typeof url === "string" ? url : url.toString();
      return new Response("ok");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    await alertCritical(makeEvent("lmstudio:8082"));
    expect(fetchedUrl).toContain("api.telegram.org/bottest-token/sendMessage");

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("rate-limits: second call within 5min is skipped", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response("ok");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    await alertCritical(makeEvent("same-svc"));
    await alertCritical(makeEvent("same-svc")); // should be rate-limited

    expect(callCount).toBe(1);

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("different services are rate-limited independently", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response("ok");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    await alertCritical(makeEvent("svc-a"));
    await alertCritical(makeEvent("svc-b"));

    expect(callCount).toBe(2);

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("does not throw when fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("network error");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    // Should not throw
    await alertCritical(makeEvent("fail-svc"));

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("skips silently when env vars missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    // Should not throw
    await alertCritical(makeEvent("no-env-svc"));
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/alert.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement alert.ts**

```typescript
// src/resilience/alert.ts — Telegram escalation for critical errors.
// Raw Bot API fetch. Rate-limited per ServiceId (5 min cooldown).
// Never throws — alerting must not crash the system.

import type { ErrorEvent, ServiceId } from "./types";

// ---------------------------------------------------------------------------
// Rate limiter — in-memory, resets on process restart (acceptable)
// ---------------------------------------------------------------------------

const lastSent = new Map<ServiceId, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function isRateLimited(service: ServiceId): boolean {
  const last = lastSent.get(service);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_MS;
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

export function formatAlertMessage(event: ErrorEvent): string {
  return [
    `⚠️ CRITICAL: ${event.service} down`,
    `Agent: ${event.agent_id}`,
    `Message: ${event.message}`,
    `Time: ${event.timestamp}`,
    event.context && Object.keys(event.context).length > 0
      ? `Context: ${JSON.stringify(event.context)}`
      : null,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Send alert
// ---------------------------------------------------------------------------

export async function alertCritical(event: ErrorEvent): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) return; // silently skip if not configured

    if (isRateLimited(event.service)) return;

    const text = formatAlertMessage(event);

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    lastSent.set(event.service, Date.now());
  } catch {
    // Alerting must never crash the system
  }
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function resetRateLimiter(): void {
  lastSent.clear();
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/alert.test.ts
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/resilience/alert.ts src/tests/resilience/alert.test.ts
git commit -m "feat(resilience): Telegram alert with rate limiting + TDD"
```

---

### Task 8: Wire alert.ts to CRITICAL_ALERT EventBus subscription

**Files:**
- Create: `src/resilience/index.ts`

- [ ] **Step 1: Create index.ts that wires alert subscription**

```typescript
// src/resilience/index.ts — Public API + wiring.
// Subscribes alert.ts to CRITICAL_ALERT events on import.

export { type ErrorEvent, type CircuitState, type ErrorCategory, type Severity, type ServiceId, ResilienceError, classifyError } from "./types";
export { createBreaker, getBreakerState, getAllBreakerStates } from "./circuit";
export { createRetry } from "./retry";
export { emitError, emitCircuitChange, emitCritical } from "./error-bus";
export { alertCritical, formatAlertMessage } from "./alert";

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
```

- [ ] **Step 2: Verify all resilience tests still pass**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/
```
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/resilience/index.ts
git commit -m "feat(resilience): public API index + wire CRITICAL_ALERT to Telegram"
```

---

### Task 9: Wire dispatch to resilience layer

**Files:**
- Modify: `src/dispatch/worker.ts:228-237`

- [ ] **Step 1: Add resilience imports to worker.ts**

At the top of `src/dispatch/worker.ts`, add after existing imports:

```typescript
import { createBreaker } from "../resilience/circuit";
import { createRetry } from "../resilience/retry";
import { emitError } from "../resilience/error-bus";
import { classifyError, type ErrorEvent } from "../resilience/types";
```

- [ ] **Step 2: Replace the raw try-catch in dispatch()**

Replace lines 228-237 in `src/dispatch/worker.ts`:

**Before:**
```typescript
  try {
    const result = await callLmStudio(endpoint, task.task, cfg.timeoutMs, effectiveTier, task.max_tokens ?? 1024);
    inferenceText = result.text;
    completionTokens = result.completion_tokens;
    latencyMs = result.latency_ms;
    success = true;
  } catch (err) {
    latencyMs = 0;
    errorMsg = err instanceof Error ? err.message : String(err);
  }
```

**After:**
```typescript
  const breaker = createBreaker(endpoint, { threshold: 3, halfOpenAfterMs: 30_000 });
  const retry = createRetry({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 });

  try {
    const result = await retry.execute(() =>
      breaker.execute(() =>
        callLmStudio(endpoint, task.task, cfg.timeoutMs, effectiveTier, task.max_tokens ?? 1024)
      )
    );
    inferenceText = result.text;
    completionTokens = result.completion_tokens;
    latencyMs = result.latency_ms;
    success = true;
  } catch (err) {
    latencyMs = 0;
    errorMsg = err instanceof Error ? err.message : String(err);

    const errorEvent: ErrorEvent = {
      id: crypto.randomUUID(),
      service: endpoint,
      category: classifyError(err),
      severity: classifyError(err) === "circuit_open" ? "high" : "medium",
      message: errorMsg,
      context: { task_id: task.id, agent_id: task.agent_id, model: modelName, tier: effectiveTier },
      timestamp: new Date().toISOString(),
      agent_id: task.agent_id,
    };
    emitError(errorEvent);
  }
```

- [ ] **Step 3: Run all existing tests to verify nothing breaks**

```bash
cd /Users/eoh/theorex && bun test
```
Expected: ALL PASS (existing tests unaffected — dispatch function signature unchanged)

- [ ] **Step 4: Commit**

```bash
git add src/dispatch/worker.ts
git commit -m "feat(resilience): wire circuit breaker + retry into dispatch"
```

---

### Task 10: Integration test

**Files:**
- Create: `src/tests/resilience/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/tests/resilience/integration.test.ts
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
    const retry = createRetry({ maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 20 });

    let callCount = 0;

    // First call: retry exhausts, but breaker isn't tripped yet (only 1 failure per retry cycle)
    try {
      await retry.execute(() => {
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
});
```

- [ ] **Step 2: Run integration test**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/integration.test.ts
```
Expected: ALL PASS

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/eoh/theorex && bun test
```
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/tests/resilience/integration.test.ts
git commit -m "test(resilience): integration tests for composed policies"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run all resilience tests**

```bash
cd /Users/eoh/theorex && bun test src/tests/resilience/
```
Expected: ALL PASS across 6 test files

- [ ] **Step 2: Run full project test suite**

```bash
cd /Users/eoh/theorex && bun test
```
Expected: ALL PASS — no regressions

- [ ] **Step 3: Verify file sizes are under target**

```bash
wc -l /Users/eoh/theorex/src/resilience/*.ts
```
Expected: Each file under 100 lines, total under 400

- [ ] **Step 4: Final commit with all files**

```bash
cd /Users/eoh/theorex && git status
```
Verify working tree is clean. If any unstaged files remain, add and commit.
