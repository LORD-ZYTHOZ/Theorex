// tests/deliberate/packet.test.ts — Tests for session packet builder + condensation.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { buildSessionPacket, condensePacket } from "../../src/deliberate/packet";
import type { SessionPacket, TradeRecord, SingularityReport, HorizonReport } from "../../src/deliberate/types";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "packet-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: write a singularity JSONL file with N trades in the asian session
// ---------------------------------------------------------------------------

function makeTrade(index: number, dateStr: string): TradeRecord {
  const hour = 2; // UTC hour 2 = inside asian window
  const entryTime = `${dateStr}T0${hour}:${String(index).padStart(2, "0")}:00.000Z`;
  return {
    id: `trade-${index}`,
    symbol: "XAUUSD",
    side: "buy",
    entry_price: 2000 + index,
    exit_price: 2001 + index,
    pnl: index % 3 === 0 ? -10 : 15,
    entry_time: entryTime,
    exit_time: `${dateStr}T0${hour}:${String(index).padStart(2, "0")}:30.000Z`,
    hold_time_ms: 30000,
  };
}

async function writeSingularityFile(path: string, trades: readonly TradeRecord[]): Promise<void> {
  const lines = trades.map((t) => JSON.stringify(t)).join("\n");
  await Bun.write(path, lines);
}

// ---------------------------------------------------------------------------
// Test: assembly with all 3 reports
// ---------------------------------------------------------------------------

test("buildSessionPacket assembles all 3 perspective reports", async () => {
  const date = "2026-03-24";
  const singPath = join(tempDir, "sing.jsonl");
  const divPath = join(tempDir, "div.json");
  const horPath = join(tempDir, "hor.json");

  // Write singularity trades
  const trades = [makeTrade(1, date), makeTrade(2, date)];
  await writeSingularityFile(singPath, trades);

  // Write divergent report
  await Bun.write(
    divPath,
    JSON.stringify({
      source: "divergent",
      signal_count: 1,
      agreement_rate: 0.8,
      signals: [
        { timestamp: `${date}T03:00:00Z`, direction: "long", confidence: 0.9, models_agreed: 4, models_total: 5 },
      ],
    }),
  );

  // Write horizon report
  await Bun.write(
    horPath,
    JSON.stringify({
      source: "horizon",
      active_positions: 1,
      total_exposure: 1000,
      unrealized_pnl: 50,
      positions: [
        { symbol: "XAUUSD", side: "long", size: 0.1, entry_price: 2000, current_price: 2050, unrealized_pnl: 50, opened_at: `${date}T02:00:00Z` },
      ],
    }),
  );

  const packet = await buildSessionPacket({
    session: "asian",
    date,
    singularityPath: singPath,
    divergentPath: divPath,
    horizonPath: horPath,
  });

  expect(packet.date).toBe(date);
  expect(packet.session).toBe("asian");
  expect(packet.assembled_at).toBeTruthy();
  expect(packet.perspectives).toHaveLength(3);

  const sources = packet.perspectives.map((p) => p.source);
  expect(sources).toContain("singularity");
  expect(sources).toContain("divergent");
  expect(sources).toContain("horizon");
});

// ---------------------------------------------------------------------------
// Test: null handling for missing Divergent/Horizon
// ---------------------------------------------------------------------------

test("buildSessionPacket handles missing divergent and horizon files", async () => {
  const date = "2026-03-24";
  const singPath = join(tempDir, "sing-only.jsonl");

  await writeSingularityFile(singPath, [makeTrade(1, date)]);

  const packet = await buildSessionPacket({
    session: "asian",
    date,
    singularityPath: singPath,
    divergentPath: join(tempDir, "nonexistent-div.json"),
    horizonPath: join(tempDir, "nonexistent-hor.json"),
  });

  // Only singularity should be present
  expect(packet.perspectives).toHaveLength(1);
  expect(packet.perspectives[0].source).toBe("singularity");
});

// ---------------------------------------------------------------------------
// Test: condensePacket truncates trades > 20
// ---------------------------------------------------------------------------

test("condensePacket truncates singularity trades to 20 most recent", () => {
  const date = "2026-03-24";
  const trades: TradeRecord[] = Array.from({ length: 30 }, (_, i) => ({
    id: `t-${i}`,
    symbol: "XAUUSD",
    side: "buy" as const,
    entry_price: 2000,
    exit_price: 2001,
    pnl: 10,
    entry_time: `${date}T02:${String(i).padStart(2, "0")}:00.000Z`,
    exit_time: `${date}T02:${String(i).padStart(2, "0")}:30.000Z`,
    hold_time_ms: 30000,
  }));

  const singReport: SingularityReport = {
    source: "singularity",
    total_trades: 30,
    winning_trades: 30,
    losing_trades: 0,
    total_pnl: 300,
    win_rate: 1,
    avg_hold_time_ms: 30000,
    largest_win: 10,
    largest_loss: 0,
    session_trades: trades,
  };

  const packet: SessionPacket = {
    date,
    session: "asian",
    perspectives: [singReport],
    assembled_at: new Date().toISOString(),
  };

  const condensed = condensePacket(packet);

  // Original untouched (immutability check)
  const origSing = packet.perspectives.find((p) => p.source === "singularity") as SingularityReport;
  expect(origSing.session_trades).toHaveLength(30);

  // Condensed has max 20, most recent by entry_time
  const condensedSing = condensed.perspectives.find((p) => p.source === "singularity") as SingularityReport;
  expect(condensedSing.session_trades).toHaveLength(20);
  // Should keep trades with indices 10-29 (most recent)
  expect(condensedSing.session_trades[0].id).toBe("t-10");
  expect(condensedSing.session_trades[19].id).toBe("t-29");
});

// ---------------------------------------------------------------------------
// Test: condensePacket truncates horizon positions to 10
// ---------------------------------------------------------------------------

test("condensePacket truncates horizon positions to 10 most recent", () => {
  const date = "2026-03-24";
  const positions = Array.from({ length: 15 }, (_, i) => ({
    symbol: "XAUUSD",
    side: "long" as const,
    size: 0.1,
    entry_price: 2000,
    current_price: 2050,
    unrealized_pnl: 50,
    opened_at: `${date}T02:${String(i).padStart(2, "0")}:00.000Z`,
  }));

  const horReport: HorizonReport = {
    source: "horizon",
    active_positions: 15,
    total_exposure: 1500,
    unrealized_pnl: 750,
    positions,
  };

  const packet: SessionPacket = {
    date,
    session: "asian",
    perspectives: [horReport],
    assembled_at: new Date().toISOString(),
  };

  const condensed = condensePacket(packet);
  const condensedHor = condensed.perspectives.find((p) => p.source === "horizon") as HorizonReport;
  expect(condensedHor.positions).toHaveLength(10);
  // Most recent = indices 5-14
  expect(condensedHor.positions[0].opened_at).toBe(`${date}T02:05:00.000Z`);
});

// ---------------------------------------------------------------------------
// Test: condensePacket passes through when under limits
// ---------------------------------------------------------------------------

test("condensePacket passes through when under limits", () => {
  const date = "2026-03-24";
  const singReport: SingularityReport = {
    source: "singularity",
    total_trades: 2,
    winning_trades: 2,
    losing_trades: 0,
    total_pnl: 30,
    win_rate: 1,
    avg_hold_time_ms: 30000,
    largest_win: 15,
    largest_loss: 0,
    session_trades: [makeTrade(1, date), makeTrade(2, date)],
  };

  const packet: SessionPacket = {
    date,
    session: "asian",
    perspectives: [singReport],
    assembled_at: new Date().toISOString(),
  };

  const condensed = condensePacket(packet);
  const condensedSing = condensed.perspectives.find((p) => p.source === "singularity") as SingularityReport;
  expect(condensedSing.session_trades).toHaveLength(2);
  // Should be a new object, not the same reference
  expect(condensed).not.toBe(packet);
});
