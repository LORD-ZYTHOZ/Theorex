// tests/deliberate/extractors/horizon.test.ts — Horizon report extractor tests.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractHorizonReport } from "../../../src/deliberate/extractors/horizon";
import type { HorizonReport } from "../../../src/deliberate/types";

const TMP = join(tmpdir(), "theorex-horizon-test-" + Date.now());
const REPORT_PATH = join(TMP, "horizon-report.json");

const SAMPLE_REPORT: HorizonReport = {
  source: "horizon",
  active_positions: 2,
  total_exposure: 5000,
  unrealized_pnl: 120,
  positions: [
    { symbol: "XAUUSD", side: "long", size: 1.0, entry_price: 2000, current_price: 2060, unrealized_pnl: 60, opened_at: "2026-03-24T02:00:00Z" },
    { symbol: "XAUUSD", side: "short", size: 0.5, entry_price: 2100, current_price: 2040, unrealized_pnl: 60, opened_at: "2026-03-24T03:00:00Z" },
  ],
};

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
  await Bun.write(REPORT_PATH, JSON.stringify(SAMPLE_REPORT));
});

afterAll(() => rm(TMP, { recursive: true, force: true }));

describe("extractHorizonReport", () => {
  test("returns null for non-existent file", async () => {
    const result = await extractHorizonReport(join(TMP, "nope.json"), "asian", "2026-03-24");
    expect(result).toBeNull();
  });

  test("parses valid JSON file into HorizonReport", async () => {
    const result = await extractHorizonReport(REPORT_PATH, "asian", "2026-03-24");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("horizon");
    expect(result!.active_positions).toBe(2);
    expect(result!.total_exposure).toBe(5000);
    expect(result!.unrealized_pnl).toBe(120);
    expect(result!.positions).toHaveLength(2);
    expect(result!.positions[0]!.symbol).toBe("XAUUSD");
    expect(result!.positions[0]!.side).toBe("long");
    expect(result!.positions[1]!.unrealized_pnl).toBe(60);
  });
});
