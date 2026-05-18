// src/axon/outcomes.ts — Trade outcome write-back for Theorex.
// Phase 13: shadows trade outcomes from Singularity → Postgres outcomes table.
// Also provides read APIs for the outcomes CLI command.

import { getDb } from "./pg-connection";
import { emit_trade_flash } from "./flash-writer";

export interface TradeOutcome {
  trade_id: string;
  agent: string;
  direction: "long" | "short" | "flat";
  entry_price: number;
  exit_price: number;
  pnl: number;
  meta?: Record<string, unknown>;
}

export interface OutcomeSummary {
  agent: string;
  total_trades: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
}

/** Write a single trade outcome to the outcomes table. */
export async function write_trade_outcome(outcome: TradeOutcome): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO outcomes (trade_id, agent, direction, entry_price, exit_price, pnl, meta)
    VALUES (
      ${outcome.trade_id},
      ${outcome.agent},
      ${outcome.direction}::text,
      ${outcome.entry_price},
      ${outcome.exit_price},
      ${outcome.pnl},
      ${outcome.meta ?? {}}
    )
  `;
  // Emit flash event for this trade outcome
  const meta = outcome.meta ?? {};
  const out = meta.outcome ?? (outcome.pnl > 0 ? "WIN" : outcome.pnl < 0 ? "LOSS" : "TIMEOUT");
  await emit_trade_flash({
    trade_id: outcome.trade_id,
    agent: outcome.agent,
    direction: outcome.direction,
    outcome: out,
    pnl: outcome.pnl,
    session: meta.session ?? meta.timeframe ?? null,
  });
}

/** Get all outcomes for a given agent, ordered by created_at DESC. */
export async function get_outcomes_by_agent(
  agent: string,
  limit = 50
): Promise<TradeOutcome[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT trade_id, agent, direction, entry_price, exit_price, pnl, meta, created_at
    FROM outcomes
    WHERE agent = ${agent}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    trade_id: r.trade_id as string,
    agent: r.agent as string,
    direction: (r.direction ?? "flat") as "long" | "short" | "flat",
    entry_price: Number(r.entry_price),
    exit_price: Number(r.exit_price),
    pnl: Number(r.pnl),
    meta: (r.meta as Record<string, unknown>) ?? {},
  }));
}

/** Get aggregated summary stats per agent. */
export async function get_outcomes_summary(agentFilter?: string): Promise<OutcomeSummary[]> {
  const sql = getDb();
  const where = agentFilter ? sql`WHERE agent = ${agentFilter}` : sql``;
  const rows = await sql`
    SELECT
      agent,
      COUNT(*)                     AS total_trades,
      COUNT(*) FILTER (WHERE pnl > 0) AS win_count,
      COUNT(*) FILTER (WHERE pnl < 0) AS loss_count,
      ROUND(
        COUNT(*) FILTER (WHERE pnl > 0)::numeric /
        NULLIF(COUNT(*), 0)::numeric * 100, 1
      )                           AS win_rate,
      ROUND(AVG(pnl)::numeric, 4) AS avg_pnl,
      ROUND(SUM(pnl)::numeric, 4)  AS total_pnl
    FROM outcomes
    ${where}
    GROUP BY agent
    ORDER BY total_trades DESC
  `;
  return rows.map((r) => ({
    agent: r.agent as string,
    total_trades: Number(r.total_trades),
    win_count: Number(r.win_count),
    loss_count: Number(r.loss_count),
    win_rate: Number(r.win_rate ?? 0),
    avg_pnl: Number(r.avg_pnl ?? 0),
    total_pnl: Number(r.total_pnl ?? 0),
  }));
}

/** Upsert a trade outcome. If trade_id already exists, update exit_price/pnl/meta.
 * Fires a WIN/LOSS/TIMEOUT flash event on insert.
 */
export async function upsert_trade_outcome(outcome: TradeOutcome): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO outcomes (trade_id, agent, direction, entry_price, exit_price, pnl, meta)
    VALUES (
      ${outcome.trade_id},
      ${outcome.agent},
      ${outcome.direction}::text,
      ${outcome.entry_price},
      ${outcome.exit_price},
      ${outcome.pnl},
      ${outcome.meta ?? {}}
    )
    ON CONFLICT (trade_id) DO UPDATE SET
      exit_price = EXCLUDED.exit_price,
      pnl        = EXCLUDED.pnl,
      meta       = EXCLUDED.meta
  `;
  // Fire flash event for new or updated outcome
  await emit_trade_flash(
    outcome.trade_id,
    outcome.agent,
    outcome.direction,
    outcome.pnl,
    outcome.entry_price,
    outcome.exit_price,
  ).catch(() => {}); // non-blocking
}