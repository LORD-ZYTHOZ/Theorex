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
      maxAttempts: maxAttempts - 1,
      backoff: new ExponentialBackoff({
        initialDelay: baseDelayMs,
        maxDelay: maxDelayMs,
        jitter: 0.5, // Adds randomness to prevent thundering herd
      }),
    },
  );
}
