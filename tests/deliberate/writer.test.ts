// tests/deliberate/writer.test.ts — Tests for deliberation record writer + markdown renderer.

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { writeDeliberation, renderMarkdown } from "../../src/deliberate/writer";
import type {
  DeliberationRecord,
  SessionPacket,
  SingularityReport,
  DivergentReport,
  HorizonReport,
} from "../../src/deliberate/types";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePacket(): SessionPacket {
  const singularity: SingularityReport = {
    source: "singularity",
    total_trades: 5,
    winning_trades: 3,
    losing_trades: 2,
    total_pnl: 42.5,
    win_rate: 0.6,
    avg_hold_time_ms: 30000,
    largest_win: 25,
    largest_loss: -10,
    session_trades: [],
  };

  const divergent: DivergentReport = {
    source: "divergent",
    signal_count: 3,
    agreement_rate: 0.8,
    signals: [
      {
        timestamp: "2026-03-24T03:00:00.000Z",
        direction: "long",
        confidence: 0.85,
        models_agreed: 4,
        models_total: 5,
      },
    ],
  };

  const horizon: HorizonReport = {
    source: "horizon",
    active_positions: 1,
    total_exposure: 5000,
    unrealized_pnl: 12.3,
    positions: [
      {
        symbol: "XAUUSD",
        side: "long",
        size: 0.1,
        entry_price: 2050,
        current_price: 2062.3,
        unrealized_pnl: 12.3,
        opened_at: "2026-03-24T02:15:00.000Z",
      },
    ],
  };

  return {
    date: "2026-03-24",
    session: "asian",
    perspectives: [singularity, divergent, horizon],
    assembled_at: "2026-03-24T09:00:00.000Z",
  };
}

function makeRecord(overrides?: Partial<DeliberationRecord>): DeliberationRecord {
  return {
    id: "test-uuid-1234",
    date: "2026-03-24",
    session: "asian",
    status: "complete",
    packet: makePacket(),
    prompt: "Analyze the asian session.",
    response: "The asian session showed moderate activity with a 60% win rate.",
    model: "claude-opus-4-20250514",
    tokens_used: 1500,
    latency_ms: 3200,
    created_at: "2026-03-24T09:00:00.000Z",
    completed_at: "2026-03-24T09:00:03.200Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "writer-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// writeDeliberation
// ---------------------------------------------------------------------------

describe("writeDeliberation", () => {
  test("writes JSON and markdown files", async () => {
    const record = makeRecord();
    const result = await writeDeliberation(record, tempDir);

    expect(result.jsonPath).toBe(join(tempDir, "2026-03-24-asian.json"));
    expect(result.mdPath).toBe(join(tempDir, "2026-03-24-asian.md"));

    // JSON file should be valid and match the record
    const jsonContent = await Bun.file(result.jsonPath).json();
    expect(jsonContent.id).toBe("test-uuid-1234");
    expect(jsonContent.session).toBe("asian");
    expect(jsonContent.status).toBe("complete");

    // Markdown file should exist and contain key info
    const mdContent = await Bun.file(result.mdPath).text();
    expect(mdContent).toContain("2026-03-24");
    expect(mdContent).toContain("asian");
  });

  test("throws on duplicate when force is false", async () => {
    const subDir = await mkdtemp(join(tmpdir(), "writer-dedup-"));
    const record = makeRecord();

    // First write succeeds
    await writeDeliberation(record, subDir);

    // Second write should throw
    await expect(writeDeliberation(record, subDir)).rejects.toThrow(/already exists/);

    await rm(subDir, { recursive: true, force: true });
  });

  test("overwrites with force option", async () => {
    const subDir = await mkdtemp(join(tmpdir(), "writer-force-"));
    const record = makeRecord();

    await writeDeliberation(record, subDir);

    const updated = makeRecord({ response: "Updated analysis." });
    const result = await writeDeliberation(updated, subDir, { force: true });

    const jsonContent = await Bun.file(result.jsonPath).json();
    expect(jsonContent.response).toBe("Updated analysis.");

    await rm(subDir, { recursive: true, force: true });
  });

  test("creates directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "nested", "deep");
    const record = makeRecord({ date: "2026-03-25" });

    const result = await writeDeliberation(record, nestedDir);
    expect(await Bun.file(result.jsonPath).exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown
// ---------------------------------------------------------------------------

describe("renderMarkdown", () => {
  test("renders header with date, session, status, model", () => {
    const md = renderMarkdown(makeRecord());

    expect(md).toContain("# Deliberation: 2026-03-24 asian");
    expect(md).toContain("complete");
    expect(md).toContain("claude-opus-4-20250514");
  });

  test("renders singularity perspective", () => {
    const md = renderMarkdown(makeRecord());

    expect(md).toContain("Singularity");
    expect(md).toContain("Total trades: 5");
    expect(md).toContain("Win rate: 60.0%");
    expect(md).toContain("Total PnL: 42.50");
  });

  test("renders divergent perspective", () => {
    const md = renderMarkdown(makeRecord());

    expect(md).toContain("Divergent");
    expect(md).toContain("Signal count: 3");
    expect(md).toContain("Agreement rate: 80.0%");
  });

  test("renders horizon perspective", () => {
    const md = renderMarkdown(makeRecord());

    expect(md).toContain("Horizon");
    expect(md).toContain("Active positions: 1");
    expect(md).toContain("Unrealized PnL: 12.30");
  });

  test("renders response section when present", () => {
    const md = renderMarkdown(makeRecord());

    expect(md).toContain("## Analysis");
    expect(md).toContain("60% win rate");
  });

  test("omits response section when absent", () => {
    const md = renderMarkdown(makeRecord({ response: undefined }));

    expect(md).not.toContain("## Analysis");
  });

  test("renders timing footer", () => {
    const md = renderMarkdown(makeRecord());

    expect(md).toContain("Tokens: 1500");
    expect(md).toContain("Latency: 3200ms");
  });

  test("handles record without timing info", () => {
    const md = renderMarkdown(
      makeRecord({ tokens_used: undefined, latency_ms: undefined, completed_at: undefined }),
    );

    expect(md).not.toContain("Tokens:");
    expect(md).not.toContain("Latency:");
  });
});
