/**
 * pg-resilience.ts — Retry + circuit breaker for Postgres connections.
 * Stage 7 Production Hardening.
 */

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < config.maxAttempts - 1) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt),
          config.maxDelayMs,
        );
        await Bun.sleep(delay);
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
  readonly monitorWindowMs: number;
}

const DEFAULT_CIRCUIT: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  monitorWindowMs: 60_000,
};

export class CircuitOpenError extends Error {
  constructor(resetAtMs: number) {
    const waitSec = Math.ceil((resetAtMs - Date.now()) / 1000);
    super(`Circuit open — Postgres unavailable. Retry in ~${waitSec}s`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures: readonly number[] = [];
  private openedAt = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT) {
    this.config = config;
  }

  getState(): CircuitState {
    this.maybeTransition();
    return this.state;
  }

  /** Throws CircuitOpenError if circuit is open. */
  checkState(): void {
    this.maybeTransition();
    if (this.state === "open") {
      throw new CircuitOpenError(this.openedAt + this.config.resetTimeoutMs);
    }
  }

  recordSuccess(): void {
    this.failures = [];
    this.state = "closed";
  }

  recordFailure(): void {
    const now = Date.now();
    const windowStart = now - this.config.monitorWindowMs;
    const recent = [...this.failures.filter((t) => t > windowStart), now];
    this.failures = recent;

    if (recent.length >= this.config.failureThreshold) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  private maybeTransition(): void {
    if (this.state === "open") {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = "half_open";
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _breaker: CircuitBreaker | null = null;

export function getCircuitBreaker(): CircuitBreaker {
  if (!_breaker) {
    _breaker = new CircuitBreaker();
  }
  return _breaker;
}

/** Reset for testing. */
export function resetCircuitBreaker(): void {
  _breaker = null;
}

// ---------------------------------------------------------------------------
// Connection error detection
// ---------------------------------------------------------------------------

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
]);

export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("connection terminated") ||
    msg.includes("connection refused") ||
    msg.includes("connection reset") ||
    msg.includes("could not connect")
  );
}

// ---------------------------------------------------------------------------
// Resilient query wrapper
// ---------------------------------------------------------------------------

export async function resilientQuery<T>(
  getDb: () => ReturnType<typeof Bun.sql>,
  resetDb: () => void,
  fn: (sql: ReturnType<typeof Bun.sql>) => Promise<T>,
): Promise<T> {
  const breaker = getCircuitBreaker();
  breaker.checkState();

  try {
    const result = await withRetry(() => fn(getDb()));
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure();
    if (isConnectionError(err)) {
      resetDb();
    }
    throw err;
  }
}
