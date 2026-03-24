// deliberate/integration.test.ts — Full deliberation pipeline integration test.
// Wires mock data through extractors, packet building, prompt construction,
// and orchestrator dispatch to verify the end-to-end flow.

import { test, expect, describe } from "bun:test";
import { runDeliberation } from "../../src/deliberate/orchestrate";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const TEST_DATE = "2026-03-24";

const mockTrades = [
  {
    id: "t1",
    symbol: "XAUUSD",
    side: "buy",
    entry_price: 2950.0,
    exit_price: 2955.0,
    pnl: 50.0,
    entry_time: `${TEST_DATE}T10:15:00.000Z`,
    exit_time: `${TEST_DATE}T10:45:00.000Z`,
    hold_time_ms: 1_800_000,
    strategy: "momentum",
  },
  {
    id: "t2",
    symbol: "XAUUSD",
    side: "sell",
    entry_price: 2960.0,
    exit_price: 2965.0,
    pnl: -50.0,
    entry_time: `${TEST_DATE}T12:00:00.000Z`,
    exit_time: `${TEST_DATE}T12:30:00.000Z`,
    hold_time_ms: 1_800_000,
    strategy: "reversal",
  },
  {
    id: "t3",
    symbol: "XAUUSD",
    side: "buy",
    entry_price: 2940.0,
    exit_price: 2948.0,
    pnl: 80.0,
    entry_time: `${TEST_DATE}T14:00:00.000Z`,
    exit_time: `${TEST_DATE}T15:00:00.000Z`,
    hold_time_ms: 3_600_000,
    strategy: "breakout",
  },
] as const;

const mockDivergentReport = {
  source: "divergent" as const,
  signal_count: 2,
  agreement_rate: 0.75,
  signals: [
    {
      timestamp: `${TEST_DATE}T09:00:00.000Z`,
      direction: "long" as const,
      confidence: 0.82,
      models_agreed: 3,
      models_total: 4,
    },
    {
      timestamp: `${TEST_DATE}T13:30:00.000Z`,
      direction: "short" as const,
      confidence: 0.65,
      models_agreed: 2,
      models_total: 4,
    },
  ],
};

const mockHorizonReport = {
  source: "horizon" as const,
  active_positions: 1,
  total_exposure: 10_000,
  unrealized_pnl: 120.5,
  positions: [
    {
      symbol: "XAUUSD",
      side: "long" as const,
      size: 1.0,
      entry_price: 2945.0,
      current_price: 2957.5,
      unrealized_pnl: 120.5,
      opened_at: `${TEST_DATE}T11:00:00.000Z`,
    },
  ],
};

const mockDispatch = async (_prompt: string) =>
  JSON.stringify({
    alignments: ["All engines agreed on bullish bias"],
    conflicts: ["Singularity took BUY against Divergent bearish consensus"],
    blind_spots: ["None identified"],
    missed_opportunities: ["Late LDN reversal setup missed"],
    takeaways: [
      {
        insight: "BUY setups against strong bearish consensus lost 4/5",
        test_condition:
          "Track BUY performance during bearish consensus next week",
        engines_involved: ["singularity", "divergent"],
        confidence: 0.85,
      },
    ],
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deliberation integration", () => {
  test("full pipeline produces a complete record with all perspectives", async () => {
    // 1. Create temp directories
    const inputDir = await mkdtemp(join(tmpdir(), "delib-input-"));
    const outputDir = await mkdtemp(join(tmpdir(), "delib-output-"));

    // 2. Write mock Singularity trade data (JSONL)
    const singularityPath = join(inputDir, "latent_trades.jsonl");
    const tradesJsonl = mockTrades.map((t) => JSON.stringify(t)).join("\n");
    await writeFile(singularityPath, tradesJsonl, "utf-8");

    // 3. Write mock Divergent report (JSON)
    const divergentPath = join(inputDir, "divergent_report.json");
    await writeFile(
      divergentPath,
      JSON.stringify(mockDivergentReport),
      "utf-8",
    );

    // 4. Write mock Horizon report (JSON)
    const horizonPath = join(inputDir, "horizon_report.json");
    await writeFile(horizonPath, JSON.stringify(mockHorizonReport), "utf-8");

    // 5. Run deliberation
    const record = await runDeliberation({
      session: "london",
      date: TEST_DATE,
      paths: {
        singularity: singularityPath,
        divergent: divergentPath,
        horizon: horizonPath,
      },
      outputDir,
      dispatch: mockDispatch,
    });

    // 6. Assertions
    // Status should be complete
    expect(record.status).toBe("complete");

    // Record should have required fields
    expect(record.id).toBeDefined();
    expect(record.date).toBe(TEST_DATE);
    expect(record.session).toBe("london");
    expect(record.model).toBeDefined();
    expect(record.created_at).toBeDefined();
    expect(record.completed_at).toBeDefined();
    expect(record.latency_ms).toBeGreaterThanOrEqual(0);

    // Packet should contain all 3 perspectives
    const { packet } = record;
    expect(packet.date).toBe(TEST_DATE);
    expect(packet.session).toBe("london");
    expect(packet.assembled_at).toBeDefined();
    expect(packet.perspectives.length).toBe(3);

    const sources = packet.perspectives.map((p) => p.source).sort();
    expect(sources).toEqual(["divergent", "horizon", "singularity"]);

    // Singularity perspective should have trade data
    const singPerspective = packet.perspectives.find(
      (p) => p.source === "singularity",
    );
    expect(singPerspective).toBeDefined();
    if (singPerspective && singPerspective.source === "singularity") {
      // London session window is 08:00-16:00 UTC — all 3 mock trades fall in range
      expect(singPerspective.total_trades).toBe(3);
      expect(singPerspective.winning_trades).toBe(2);
      expect(singPerspective.losing_trades).toBe(1);
      expect(singPerspective.total_pnl).toBe(80);
    }

    // Divergent perspective
    const divPerspective = packet.perspectives.find(
      (p) => p.source === "divergent",
    );
    expect(divPerspective).toBeDefined();
    if (divPerspective && divPerspective.source === "divergent") {
      expect(divPerspective.signal_count).toBe(2);
      expect(divPerspective.agreement_rate).toBe(0.75);
    }

    // Horizon perspective
    const horPerspective = packet.perspectives.find(
      (p) => p.source === "horizon",
    );
    expect(horPerspective).toBeDefined();
    if (horPerspective && horPerspective.source === "horizon") {
      expect(horPerspective.active_positions).toBe(1);
      expect(horPerspective.unrealized_pnl).toBe(120.5);
    }

    // Response should contain the dispatch output
    expect(record.response).toBeDefined();
    const parsed = JSON.parse(record.response!);
    expect(parsed.alignments).toBeArrayOfSize(1);
    expect(parsed.conflicts).toBeArrayOfSize(1);
    expect(parsed.takeaways).toBeArrayOfSize(1);
    expect(parsed.takeaways[0].confidence).toBe(0.85);

    // Prompt should have been constructed
    expect(record.prompt).toBeDefined();
    expect(record.prompt.length).toBeGreaterThan(0);

    // No error
    expect(record.error).toBeUndefined();
  });

  test("dispatch failure produces an error record", async () => {
    const inputDir = await mkdtemp(join(tmpdir(), "delib-err-input-"));
    const outputDir = await mkdtemp(join(tmpdir(), "delib-err-output-"));

    // Write minimal valid data
    const singularityPath = join(inputDir, "trades.jsonl");
    await writeFile(singularityPath, JSON.stringify(mockTrades[0]), "utf-8");

    const divergentPath = join(inputDir, "divergent.json");
    await writeFile(
      divergentPath,
      JSON.stringify(mockDivergentReport),
      "utf-8",
    );

    const horizonPath = join(inputDir, "horizon.json");
    await writeFile(horizonPath, JSON.stringify(mockHorizonReport), "utf-8");

    const failingDispatch = async (_prompt: string): Promise<string> => {
      throw new Error("LLM service unavailable");
    };

    const record = await runDeliberation({
      session: "london",
      date: TEST_DATE,
      paths: {
        singularity: singularityPath,
        divergent: divergentPath,
        horizon: horizonPath,
      },
      outputDir,
      dispatch: failingDispatch,
    });

    expect(record.status).toBe("error");
    expect(record.error).toBe("LLM service unavailable");
    expect(record.response).toBeUndefined();
    expect(record.packet).toBeDefined();
  });
});
