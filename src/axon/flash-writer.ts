// src/axon/flash-writer.ts — Write flash events to the flash_events table.
// Wire these triggers:
//   - Trade outcome written  → WIN / LOSS / TIMEOUT flash event
//   - Kelly sizing changed   → KELLY_CHANGE flash event
//   - Nova approval/rejection→ APPROVAL / REJECTION flash event

import { getDb } from "./pg-connection";

export type FlashEventType =
  | "WIN"
  | "LOSS"
  | "TIMEOUT"
  | "KELLY_CHANGE"
  | "APPROVAL"
  | "REJECTION"
  | "REGIME_SHIFT";

export interface FlashPayload {
  trade_id?: string;
  agent?: string;
  direction?: string;
  pnl?: number;
  entry_price?: number;
  exit_price?: number;
  kelly_before?: number;
  kelly_after?: number;
  decision?: string;
  result?: string;
  regime_type?: string;
  [key: string]: unknown;
}

/** Write a flash event to the flash_events partitioned table. */
export async function emit_flash_event(
  eventType: FlashEventType,
  payload: FlashPayload,
  agent?: string,
): Promise<void> {
  const sql = getDb();
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO flash_events (id, event_type, agent, payload, created_at)
    VALUES (
      ${id}::uuid,
      ${eventType}::text,
      ${agent ?? "system"}::text,
      ${JSON.stringify(payload)},
      now()
    )
  `;
}

/** Emit WIN/LOSS/TIMEOUT flash event for a trade outcome. */
export async function emit_trade_flash(
  trade_id: string,
  agent: string,
  direction: string,
  pnl: number,
  entry_price: number,
  exit_price: number,
): Promise<void> {
  const eventType: FlashEventType = pnl > 0 ? "WIN" : pnl === 0 ? "TIMEOUT" : "LOSS";
  await emit_flash_event(
    eventType,
    {
      trade_id,
      agent,
      direction,
      pnl,
      entry_price,
      exit_price,
    },
    agent,
  );
}

/** Emit a Kelly sizing change flash event. */
export async function emit_kelly_change_flash(
  agent: string,
  kelly_before: number,
  kelly_after: number,
): Promise<void> {
  await emit_flash_event(
    "KELLY_CHANGE",
    {
      agent,
      kelly_before,
      kelly_after,
      delta: kelly_after - kelly_before,
    },
    agent,
  );
}

/** Emit a Nova approval/rejection flash event. */
export async function emit_approval_flash(
  decision: string,
  result: string,
  approved: boolean,
  agent = "nova",
): Promise<void> {
  await emit_flash_event(
    approved ? "APPROVAL" : "REJECTION",
    { decision, result, approved },
    agent,
  );
}

/** Emit a regime shift flash event. */
export async function emit_regime_shift_flash(
  regime_type: string,
  agent = "system",
): Promise<void> {
  await emit_flash_event("REGIME_SHIFT", { regime_type }, agent);
}