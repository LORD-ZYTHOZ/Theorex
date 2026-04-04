// src/spans/resolver.ts
// Delayed reward resolution for trading agent spans.
// Singularity: resolved on trade close. Divergence: 4h. Horizon: 24h.

import { SpanStore } from "./store";

const MAX_PNL = 50.0; // XAUUSD normalization baseline (pips)

export interface TradeOutcome {
  outcome: "TP" | "SL" | "TIMEOUT";
  pnl: number;   // raw P&L in account currency
  r: number;     // R multiple
}

/**
 * Compute reward for a Singularity trade close.
 * Returns value in [-1, 1].
 */
export function computeSingularityReward(trade: TradeOutcome): number {
  const normalized = Math.max(-1, Math.min(1, trade.pnl / MAX_PNL));
  if (trade.outcome === "TIMEOUT") return normalized * 0.2; // downweight timeouts
  return normalized;
}

/**
 * Compute reward for a directional signal (Divergence / Horizon).
 * Returns 1.0 if direction was correct, 0.0 if wrong.
 */
export function computeSignalReward(
  direction: "BUY" | "SELL",
  priceAtSignal: number,
  priceAtResolution: number,
): number {
  const priceMoved = priceAtResolution - priceAtSignal;
  if (direction === "BUY") return priceMoved > 0 ? 1.0 : 0.0;
  return priceMoved < 0 ? 1.0 : 0.0;
}

/**
 * Blend trade reward + signal accuracy into final reward_score.
 */
export function normalizeReward(params: {
  tradeReward: number;
  signalCorrect: number;
  alpha: number;
  beta: number;
}): number {
  return params.alpha * params.tradeReward + params.beta * params.signalCorrect;
}

/**
 * Resolve all open spans whose resolution window has elapsed.
 * Called by the CLI `resolve-outcomes` command.
 *
 * Resolution windows:
 *   Secretarius (Singularity): on trade close (external, not time-based)
 *   Meridian    (Divergence):  4h after span
 *   Augur       (Horizon):     24h after span
 */
export async function resolveOpenSpans(): Promise<{ resolved: number; skipped: number }> {
  const store = new SpanStore();
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let resolved = 0;
  let skipped = 0;

  // Resolve Meridian (Divergence) spans older than 4h
  const meridianSpans = await store.getSpans({ agent_id: "meridian", limit: 100 });

  for (const span of meridianSpans) {
    if (span.resolved) { skipped++; continue; }
    if (new Date(span.created_at) > new Date(fourHoursAgo)) { skipped++; continue; }

    const direction = (span.metadata as { direction?: string }).direction as "BUY" | "SELL" | undefined;
    const priceAtSignal = (span.metadata as { price?: number }).price;

    if (!direction || !priceAtSignal) { skipped++; continue; }

    const priceAtResolution = (span.metadata as { price_at_resolution?: number }).price_at_resolution;
    if (!priceAtResolution) { skipped++; continue; }

    const signalCorrect = computeSignalReward(direction, priceAtSignal, priceAtResolution);
    const reward = normalizeReward({ tradeReward: 0, signalCorrect, alpha: 0.0, beta: 1.0 });
    await store.resolveSpan(span.span_id, reward);
    resolved++;
  }

  // Resolve Augur (Horizon) spans older than 24h
  const augurSpans = await store.getSpans({ agent_id: "augur", limit: 100 });

  for (const span of augurSpans) {
    if (span.resolved) { skipped++; continue; }
    if (new Date(span.created_at) > new Date(twentyFourHoursAgo)) { skipped++; continue; }

    const direction = (span.metadata as { direction?: string }).direction as "BUY" | "SELL" | undefined;
    const priceAtSignal = (span.metadata as { price?: number }).price;
    const priceAtResolution = (span.metadata as { price_at_resolution?: number }).price_at_resolution;

    if (!direction || !priceAtSignal || !priceAtResolution) { skipped++; continue; }

    const signalCorrect = computeSignalReward(direction, priceAtSignal, priceAtResolution);
    const reward = normalizeReward({ tradeReward: 0, signalCorrect, alpha: 0.0, beta: 1.0 });
    await store.resolveSpan(span.span_id, reward);
    resolved++;
  }

  return { resolved, skipped };
}
