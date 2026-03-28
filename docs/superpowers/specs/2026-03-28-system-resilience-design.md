# System Resilience Layer — Design Spec

**Date:** 2026-03-28
**Scope:** Internal system health — not trading strategy logic
**Deployment:** Per-OC instance (m4, m1, etc.), self-contained, no cross-machine state

## Problem

Theorex has 152 source files, 79 using try-catch, but error handling is ad-hoc per module. Silent `.catch(() => {})` patterns swallow failures across EventBus, file I/O, config loading, and LLM dispatch. With 4 trading strategies running, failures cascade unobserved — LM Studio goes down, every module hammers it, timeouts pile up, and the only way to find out is checking manually.

## Goal

A system-wide resilience layer that:
1. **Self-heals** — retries transient failures, circuit-breaks dead services, routes to fallbacks
2. **Reports** — structured ErrorEvents on the existing EventBus so Nova can identify, analyse, and act
3. **Alerts** — Telegram notification when something goes critical (all providers down)

## Non-Goals

- Trading strategy resilience (separate concern, handled by m4 Claude or local engineer)
- Web UI / dashboard (internal only, no external-facing output except Telegram alerts)
- Cross-machine coordination (each OC instance manages its own health)
- Dead-letter queues (LM dispatch is chat-only, not heavy work — retry or failover is sufficient)

## Dependencies

- **cockatiel ^3.2.1** — TypeScript-first circuit breaker + retry + timeout policies. Confirmed compatible with Bun 1.3.10.

## Architecture

```
src/resilience/
  types.ts        — ErrorEvent, CircuitState, ErrorCategory, Severity, ServiceId
  circuit.ts      — circuit breaker factory (one per service, backed by cockatiel)
  retry.ts        — retry policy factory with exponential backoff + jitter
  error-bus.ts    — pipes structured ErrorEvents into existing EventBus
  alert.ts        — Telegram escalation on critical severity, rate-limited
```

Five files. No abstraction layers, no policy registry. Each module that needs resilience imports the factory it needs and wires it directly.

## Data Model

### ErrorEvent

The structured event that flows through EventBus. Nova consumes these.

```typescript
interface ErrorEvent {
  readonly id: string;                        // crypto.randomUUID()
  readonly service: ServiceId;                // e.g. "lmstudio:8082", "minimax", "grok", "axon:write"
  readonly category: ErrorCategory;           // "transient" | "permanent" | "timeout" | "circuit_open"
  readonly severity: Severity;                // "low" | "medium" | "high" | "critical"
  readonly message: string;                   // human-readable error description
  readonly context: Record<string, unknown>;  // full error context (agent, task, endpoint, etc.)
  readonly timestamp: string;                 // ISO 8601 (new Date().toISOString()) — matches project convention
  readonly agent_id: string;                  // which OC agent hit this error
}
```

### CircuitState

Internal per-service state. Not emitted directly — state changes emit ErrorEvents.

```typescript
interface CircuitState {
  readonly service: ServiceId;
  readonly state: "closed" | "half_open" | "open";
  readonly failure_count: number;
  readonly last_failure: number | null;
  readonly opened_at: number | null;
}
```

### Type Aliases

```typescript
type ErrorCategory = "transient" | "permanent" | "timeout" | "circuit_open";
type Severity = "low" | "medium" | "high" | "critical";
type ServiceId = string;
```

## Module Specifications

### circuit.ts — Circuit Breaker Factory

Creates one circuit breaker per service using cockatiel's `CircuitBreakerPolicy`.

```typescript
function createBreaker(service: ServiceId, opts?: {
  readonly threshold?: number;        // consecutive failures before opening (default: 3)
  readonly halfOpenAfterMs?: number;  // cooldown before test request (default: 30_000)
}): CircuitBreakerPolicy;

function getBreakerState(service: ServiceId): CircuitState | undefined;
function getAllBreakerStates(): readonly CircuitState[];
```

**Behavior:**
- 3 consecutive failures → circuit opens → rejects immediately with `circuit_open` category
- After 30s → half-open → allows one probe request
- Probe succeeds → circuit closes, normal operation resumes
- Probe fails → circuit re-opens, another 30s cooldown
- Every state transition emits an ErrorEvent via error-bus

**Internal registry:**
- `circuit.ts` maintains a module-level `Map<ServiceId, { policy: CircuitBreakerPolicy, state: CircuitState }>`.
- `createBreaker()` is idempotent — calling it twice with the same ServiceId returns the existing instance. This ensures `getAllBreakerStates()` reflects the true system state.
- `failure_count` and `last_failure` are tracked independently (incremented on cockatiel's `onBreak` event) since cockatiel v3 does not expose these as public properties.

**Cockatiel hook wiring (inside createBreaker, not by caller):**
- `onBreak` → increments `failure_count`, updates `last_failure`, emits `CIRCUIT_STATE_CHANGE` event via error-bus
- `onReset` → resets `failure_count` to 0, emits `CIRCUIT_STATE_CHANGE` (open/half_open → closed)
- `onHalfOpen` → emits `CIRCUIT_STATE_CHANGE` (open → half_open)
- All hooks are attached inside `createBreaker()` at construction time. Callers never need to wire hooks.

**Design decisions:**
- Threshold of 3 balances sensitivity vs false positives (LM Studio can have occasional slow responses)
- 30s half-open cooldown prevents aggressive reconnection attempts
- One breaker per ServiceId — callers name their service (e.g. `"lmstudio:8082"`, `"minimax"`)

### retry.ts — Retry Policy Factory

Creates retry policies using cockatiel's `RetryPolicy` with exponential backoff and jitter.

```typescript
function createRetry(opts?: {
  readonly maxAttempts?: number;   // total attempts including first (default: 3)
  readonly baseDelayMs?: number;   // initial delay (default: 500)
  readonly maxDelayMs?: number;    // delay ceiling (default: 10_000)
}): RetryPolicy;
```

**Behavior:**
- Exponential backoff: 500ms → 1000ms → 2000ms → ... capped at 10s
- Full jitter applied to prevent thundering herd on recovery
- Only retries errors classified as `transient` or `timeout` — permanent errors fail immediately
- Each retry attempt emits a low-severity ErrorEvent

**Error classification — shared utility in types.ts:**

```typescript
class ResilienceError extends Error {
  readonly category: ErrorCategory;
  constructor(message: string, category: ErrorCategory) {
    super(message);
    this.category = category;
  }
}

function classifyError(err: unknown): ErrorCategory {
  if (err instanceof ResilienceError) return err.category;
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "transient"; // network/fetch failures
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|socket hang up/i.test(msg)) return "transient";
  if (/timeout|timed out|aborted/i.test(msg)) return "timeout";
  if (/4\d{2}/.test(msg)) return "permanent";
  if (/5\d{2}/.test(msg)) return "transient";
  return "transient"; // default to retriable — fail-safe
}
```

The `RetryPolicy` uses cockatiel's `handleWhen(predicate)` configured as:
```typescript
handleWhen((err) => {
  const cat = classifyError(err);
  return cat === "transient" || cat === "timeout";
})
```

**Error classification rules:**
- `transient`: network errors, HTTP 5xx, connection refused → retry
- `timeout`: AbortSignal timeout, request exceeded deadline → retry
- `permanent`: HTTP 4xx, parse errors, invalid config → do not retry
- `circuit_open`: breaker is open → do not retry (fallback instead)

### error-bus.ts — ErrorEvent Bridge

Bridges the resilience layer into the existing EventBus (`src/trace/bus.ts`).

```typescript
function emitError(event: ErrorEvent): void;
function emitCircuitChange(service: ServiceId, from: string, to: string): void;
function emitCritical(service: ServiceId, message: string, context: Record<string, unknown>): void;
// Note: emitCritical only emits on EventBus. alert.ts subscribes to CRITICAL_ALERT
// events independently — no direct import from error-bus to alert. Keeps modules decoupled.
```

**New BusEventType additions to trace/bus.ts:**
- `"RESILIENCE_ERROR"` — any error caught by the resilience layer
- `"CIRCUIT_STATE_CHANGE"` — breaker opened/closed/half-open
- `"CRITICAL_ALERT"` — all fallbacks exhausted, system degraded

No new bus. Extends existing EventBus with 3 new event types. Nova already reads EventBus events — these flow through the same channel.

**Payload types for BusEventPayloadMap (required for type-safe emit):**

```typescript
interface ResilienceErrorPayload {
  readonly service: ServiceId;
  readonly category: ErrorCategory;
  readonly severity: Severity;
  readonly message: string;
  readonly agent_id: string;
  readonly context: Record<string, unknown>;
}

interface CircuitStateChangePayload {
  readonly service: ServiceId;
  readonly from: "closed" | "half_open" | "open";
  readonly to: "closed" | "half_open" | "open";
  readonly failure_count: number;
}

interface CriticalAlertPayload {
  readonly service: ServiceId;
  readonly message: string;
  readonly agent_id: string;
  readonly context: Record<string, unknown>;
}
```

These are added to `BusEventPayloadMap` in `src/trace/bus.ts` alongside existing entries like `LmInferenceStartPayload`.

### alert.ts — Telegram Escalation

Sends Telegram alerts when severity reaches critical.

```typescript
function alertCritical(event: ErrorEvent): Promise<void>;
```

**Behavior:**
- Fires when `severity === "critical"` (all providers down, system degraded)
- Message includes: which service(s) are down, duration, what's affected
- Rate-limited: max 1 alert per ServiceId per 5 minutes via in-memory `Map<ServiceId, string>` (last-sent ISO timestamp). Rate limiter resets on process restart — this is acceptable; a fresh alert after restart is informative, not spam.
- Sends via raw Telegram Bot API: `fetch("https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage", { body: { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" } })`. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` environment variables. No dependency on the external telegram-bot process.
- Failures in alert delivery are logged but never throw — alerting must not crash the system

**Message format:**
```
⚠️ CRITICAL: {service} down
Duration: {minutes}m
Affected: {agent_id}
Context: {condensed error details}
```

## Integration Points

### Dispatch (src/dispatch/worker.ts)

Primary integration — replace raw try-catch with resilience policies.

**Before:**
```typescript
try {
  const result = await callLmStudio(endpoint, ...);
  success = true;
} catch (err) {
  errorMsg = err instanceof Error ? err.message : String(err);
}
```

**After:**
```typescript
const breaker = createBreaker("lmstudio:8082");
const retry = createRetry({ maxAttempts: 3 });

// cockatiel policies compose: retry wraps breaker wraps call
const result = await retry.execute(() =>
  breaker.execute(() => callLmStudio(endpoint, ...))
);
```

On failure, the resilience layer handles retry + circuit breaking + error reporting. The caller gets either a successful result or a structured error — no silent swallowing.

### LLM Fallback Chain

When primary LM Studio circuit opens, dispatch falls back through the provider chain:

1. **LM Studio** (local, free, fast) — primary
2. **Minimax** (cloud) — fallback #1
3. **Grok** (cloud) — fallback #2
4. **Critical alert** — all 3 down, Telegram notification + halt

Each provider has its own independent circuit breaker. Fallback logic lives in the dispatch module (not in resilience/) since it's domain-specific to LLM routing.

**Prerequisite:** Minimax and Grok provider clients do not exist in the codebase yet. The fallback chain integration requires adding these clients to `src/dispatch/` as separate work. The resilience layer itself (circuit breaker, retry, error-bus, alert) does not depend on the fallback chain — it works standalone with LM Studio as the only provider. The fallback chain is a future dispatch enhancement that consumes resilience primitives.

### EventBus (src/trace/bus.ts)

Add 3 new event types to the existing BusEventType union:

```typescript
export type BusEventType =
  | "LM_INFERENCE_START"
  | "LM_INFERENCE_END"
  // ... existing types ...
  | "RESILIENCE_ERROR"
  | "CIRCUIT_STATE_CHANGE"
  | "CRITICAL_ALERT";
```

Corresponding payload types added for each.

### Health Monitor (src/health/)

Health monitor can query `getAllBreakerStates()` to include circuit breaker status in health snapshots. This is a read-only integration — resilience layer manages state, health monitor reads it.

## Testing Strategy

All tests use `bun test`. No mocks for cockatiel internals — test through the public API.

### Unit Tests

| File | Tests | What's covered |
|------|-------|----------------|
| `circuit.test.ts` | 8-10 | breaker creation, threshold triggers open, half-open recovery, state queries, ErrorEvent emission on state change |
| `retry.test.ts` | 6-8 | retry on transient, no retry on permanent, backoff timing, max attempts respected, ErrorEvent emission per attempt |
| `error-bus.test.ts` | 5-6 | emitError pipes to EventBus, emitCircuitChange formats correctly, emitCritical triggers alert path |
| `alert.test.ts` | 5-6 | Telegram message formatting, rate limiting (no spam), delivery failure handling (no throw) |
| `types.test.ts` | 4-5 | ErrorEvent construction, classifyError utility, ResilienceError category propagation |

### Integration Tests

| Test | What's covered |
|------|----------------|
| `dispatch-resilience.test.ts` | Full dispatch with circuit breaker + retry, fallback chain on LM failure, ErrorEvent flow through EventBus |
| `cascade.test.ts` | Multiple services failing simultaneously, independent circuit breakers, critical alert when all down |

**Target: 80%+ coverage across all 5 source files.**

## File Size Estimates

| File | Estimated lines |
|------|-----------------|
| `types.ts` | ~40 |
| `circuit.ts` | ~80 |
| `retry.ts` | ~60 |
| `error-bus.ts` | ~50 |
| `alert.ts` | ~60 |
| **Total** | **~290** |

All files well under 400-line target. No file exceeds single-responsibility scope.

## Success Criteria

1. LM Studio going down triggers circuit breaker after 3 failures — subsequent calls route to Minimax/Grok without 120s timeout wait
2. LM Studio recovering closes the circuit within 30s — traffic returns to local provider automatically
3. Every failure emits a structured ErrorEvent on the EventBus with correct category, severity, and context
4. All 3 LLM providers down triggers exactly 1 Telegram alert per 5-minute window (no spam)
5. Retry with backoff handles transient network errors without thundering herd
6. Existing dispatch tests continue to pass — resilience layer is additive, not breaking
7. 80%+ test coverage across all resilience module files
