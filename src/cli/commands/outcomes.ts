// src/cli/commands/outcomes.ts — CLI command for viewing trade outcomes.
import { get_outcomes_by_agent, get_outcomes_summary } from "../../axon/outcomes.ts";

export async function runOutcomesCLI(args: { agent?: string; limit?: number; summary?: boolean }) {
  const agent = args.agent ?? "singularity";
  const limit = args.limit ?? 20;

  if (args.summary) {
    const summaryRows = await get_outcomes_summary(agent);
    const summary = summaryRows[0];
    if (!summary) { console.log(`No outcomes found for ${agent}`); return; }
    const nonTimeout = summary.total_trades - (summary.loss_count + (summary.win_count - summary.loss_count < 0 ? 0 : 0));
    console.log(`\n=== Outcomes Summary for ${agent} ===`);
    console.log(`Total trades: ${summary.total_trades}`);
    console.log(`Wins: ${summary.win_count} | Losses: ${summary.loss_count}`);
    console.log(`Win rate: ${summary.win_rate}%`);
    console.log(`Total PnL: $${summary.total_pnl >= 0 ? '+' : ''}${summary.total_pnl.toFixed(2)}`);
    console.log(`Avg PnL: $${summary.avg_pnl.toFixed(2)}`);
    return;
  }

  const outcomes = await get_outcomes_by_agent(agent, limit);

  const COL_TRADE = 38;
  const COL_DIR = 6;
  const COL_ENTRY = 12;
  const COL_EXIT = 12;
  const COL_PNL = 10;

  function pad(s: string | number, len: number): string {
    const str = String(s);
    return str.length >= len ? str.slice(0, len) : str.padEnd(len);
  }

  const header =
    pad("trade_id", COL_TRADE) +
    pad("dir", COL_DIR) +
    pad("entry", COL_ENTRY) +
    pad("exit", COL_EXIT) +
    pad("pnl", COL_PNL);

  console.log("=".repeat(header.length));
  console.log(header);
  console.log("-".repeat(header.length));

  for (const o of outcomes) {
    const sign = o.pnl >= 0 ? '+' : '-';
    const absPnl = Math.abs(o.pnl).toFixed(2);
    const pnlStr = sign + absPnl;
    const entryStr = typeof o.entry_price === 'number' ? o.entry_price.toFixed(2) : String(o.entry_price);
    const exitStr = typeof o.exit_price === 'number' ? o.exit_price.toFixed(2) : String(o.exit_price);
    console.log(
      pad(o.trade_id, COL_TRADE) +
      pad(o.direction, COL_DIR) +
      pad(entryStr, COL_ENTRY) +
      pad(exitStr, COL_EXIT) +
      pad(pnlStr, COL_PNL)
    );
  }

  console.log("-".repeat(header.length));
  const summaryRows = await get_outcomes_summary(agent);
  const summary = summaryRows[0];
  console.log(`\n${outcomes.length} outcomes shown. Total in DB: ${summary?.total_trades ?? 0}`);
}
