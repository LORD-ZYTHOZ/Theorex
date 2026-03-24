// tests/ingest-trades.test.ts — Phase 13: Singularity trade outcome ingestion tests.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  convertTradeToOutcome,
  ingestTradeFile,
  readWatermark,
  writeWatermark,
  type SingularityTrade,
} from "../evolve/ingest-trades";
import { readOutcomes } from "../evolve/outcome";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTrade(overrides: Partial<SingularityTrade> = {}): SingularityTrade {
  return {
    trade_id: "SNIPER_XAUUSD_test_001",
    direction: "SELL",
    session: "LONDON",
    regime: "normal",
    prob: 0.72,
    lots: 0.1,
    entry_price: 3000.0,
    sl: 3015.0,
    tp: 2970.0,
    exit_price: 2970.0,
    outcome: "TP",
    pnl: 300.0,
    r: 2.0,
    ticks_held: 1800,
    dispatch_time: "2026-03-19T10:00:00+00:00",
    closed_at: "2026-03-19T10:30:00+00:00",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// convertTradeToOutcome
// ---------------------------------------------------------------------------

describe("convertTradeToOutcome", () => {
  test("TP trade → success=true", () => {
    const o = convertTradeToOutcome(makeTrade({ outcome: "TP" }), "secretarius");
    expect(o.success).toBe(true);
    expect(o.agent_id).toBe("secretarius");
  });

  test("SL trade → success=false", () => {
    const o = convertTradeToOutcome(makeTrade({ outcome: "SL", pnl: -150, r: -1.0, exit_price: 3015.0 }), "secretarius");
    expect(o.success).toBe(false);
  });

  test("TIMEOUT with positive pnl → success=true", () => {
    const o = convertTradeToOutcome(makeTrade({ outcome: "TIMEOUT", pnl: 100, r: 0.5 }), "secretarius");
    expect(o.success).toBe(true);
  });

  test("TIMEOUT with negative pnl → success=false", () => {
    const o = convertTradeToOutcome(makeTrade({ outcome: "TIMEOUT", pnl: -50, r: -0.25 }), "secretarius");
    expect(o.success).toBe(false);
  });

  test("tags include session, direction, regime, and singularity", () => {
    const o = convertTradeToOutcome(makeTrade({ session: "LONDON", direction: "BUY", regime: "normal" }), "secretarius");
    expect(o.tags).toContain("london");
    expect(o.tags).toContain("buy");
    expect(o.tags).toContain("normal");
    expect(o.tags).toContain("singularity");
  });

  test("explicit_score scales with R multiple (positive)", () => {
    const tp = convertTradeToOutcome(makeTrade({ outcome: "TP", r: 2.0 }), "secretarius");
    const sl = convertTradeToOutcome(makeTrade({ outcome: "SL", r: -1.0, pnl: -150, exit_price: 3015 }), "secretarius");
    expect(tp.explicit_score).toBeGreaterThan(0.5);
    expect(sl.explicit_score).toBeLessThan(0.5);
  });

  test("explicit_score is clamped to 0.0–1.0", () => {
    const highR = convertTradeToOutcome(makeTrade({ outcome: "TP", r: 20.0 }), "secretarius");
    const deepLoss = convertTradeToOutcome(makeTrade({ outcome: "SL", r: -5.0, pnl: -1000, exit_price: 3015 }), "secretarius");
    expect(highR.explicit_score!).toBeLessThanOrEqual(1.0);
    expect(deepLoss.explicit_score!).toBeGreaterThanOrEqual(0.0);
  });

  test("decision includes entry context", () => {
    const o = convertTradeToOutcome(makeTrade({ session: "ASIAN", direction: "BUY", prob: 0.75 }), "secretarius");
    expect(o.decision).toContain("ASIAN");
    expect(o.decision).toContain("BUY");
    expect(o.decision).toContain("0.75");
  });

  test("result includes outcome and R", () => {
    const o = convertTradeToOutcome(makeTrade({ outcome: "TP", r: 2.0, pnl: 300 }), "secretarius");
    expect(o.result).toContain("TP");
    expect(o.result).toContain("2.0");
  });
});

// ---------------------------------------------------------------------------
// ingestTradeFile — file-based ingestion with watermark
// ---------------------------------------------------------------------------

describe("ingestTradeFile", () => {
  let dir: string;
  let outcomesDir: string;
  let watermarksDir: string;
  let tradeFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "theorex-ingest-"));
    outcomesDir = join(dir, "outcomes");
    watermarksDir = join(dir, "watermarks");
    tradeFile = join(dir, "shadow_outcomes.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function jsonl(trades: SingularityTrade[]): string {
    return trades.map((t) => JSON.stringify(t)).join("\n") + "\n";
  }

  test("ingests new trades and writes outcomes", async () => {
    await writeFile(tradeFile, jsonl([makeTrade(), makeTrade({ trade_id: "t2" })]));
    const result = await ingestTradeFile({
      filePath: tradeFile,
      agentId: "secretarius",
      outcomesDir,
      watermarksDir,
    });
    expect(result.ingested).toBe(2);
    expect(result.skipped).toBe(0);
    const outcomes = await readOutcomes(outcomesDir);
    expect(outcomes.length).toBe(2);
  });

  test("does not re-ingest already seen trade_ids", async () => {
    await writeFile(tradeFile, jsonl([makeTrade(), makeTrade({ trade_id: "t2" })]));
    await ingestTradeFile({ filePath: tradeFile, agentId: "secretarius", outcomesDir, watermarksDir });
    // Add one new trade
    await writeFile(tradeFile, jsonl([makeTrade(), makeTrade({ trade_id: "t2" }), makeTrade({ trade_id: "t3" })]));
    const result2 = await ingestTradeFile({ filePath: tradeFile, agentId: "secretarius", outcomesDir, watermarksDir });
    expect(result2.ingested).toBe(1);
    expect(result2.skipped).toBe(2);
    const outcomes = await readOutcomes(outcomesDir);
    expect(outcomes.length).toBe(3);
  });

  test("skips malformed lines gracefully", async () => {
    await writeFile(tradeFile, "not-json\n" + JSON.stringify(makeTrade()) + "\n{bad\n");
    const result = await ingestTradeFile({ filePath: tradeFile, agentId: "secretarius", outcomesDir, watermarksDir });
    expect(result.ingested).toBe(1);
    expect(result.malformed).toBe(2);
  });

  test("returns 0 ingested when file does not exist", async () => {
    const result = await ingestTradeFile({ filePath: join(dir, "nonexistent.jsonl"), agentId: "secretarius", outcomesDir, watermarksDir });
    expect(result.ingested).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// readWatermark / writeWatermark
// ---------------------------------------------------------------------------

describe("watermark store", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "theorex-wm-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test("readWatermark returns empty set for missing file", async () => {
    const wm = await readWatermark("shadow_outcomes", dir);
    expect(wm.size).toBe(0);
  });

  test("write + read roundtrip", async () => {
    await writeWatermark("shadow_outcomes", new Set(["t1", "t2", "t3"]), dir);
    const wm = await readWatermark("shadow_outcomes", dir);
    expect(wm.size).toBe(3);
    expect(wm.has("t1")).toBe(true);
  });
});
