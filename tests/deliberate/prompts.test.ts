// tests/deliberate/prompts.test.ts — Verify prompt templates for deliberation channel.

import { describe, test, expect } from "bun:test";
import {
  buildSingularityPrompt,
  buildDivergentPrompt,
  buildHorizonPrompt,
  buildOrchestratorPrompt,
} from "../../src/deliberate/prompts";
import type {
  SessionPacket,
  SingularityReport,
  DivergentReport,
  HorizonReport,
  PerspectiveReport,
} from "../../src/deliberate/types";

const makePacket = (overrides?: Partial<SessionPacket>): SessionPacket => ({
  date: "2026-03-24",
  session: "london",
  perspectives: [],
  assembled_at: "2026-03-24T12:00:00.000Z",
  ...overrides,
});

const singularityReport: SingularityReport = {
  source: "singularity",
  total_trades: 5,
  winning_trades: 3,
  losing_trades: 2,
  total_pnl: 120.5,
  win_rate: 0.6,
  avg_hold_time_ms: 45000,
  largest_win: 80.0,
  largest_loss: -30.0,
  session_trades: [],
};

const divergentReport: DivergentReport = {
  source: "divergent",
  signal_count: 10,
  agreement_rate: 0.8,
  signals: [],
};

const horizonReport: HorizonReport = {
  source: "horizon",
  active_positions: 2,
  total_exposure: 5000,
  unrealized_pnl: 150.0,
  positions: [],
};

describe("buildSingularityPrompt", () => {
  test("contains session date and session name", () => {
    const prompt = buildSingularityPrompt(makePacket());
    expect(prompt).toContain("2026-03-24");
    expect(prompt).toContain("london");
  });

  test("mentions technicals or price structure", () => {
    const prompt = buildSingularityPrompt(makePacket());
    const hasTechnicals = prompt.includes("technicals") || prompt.includes("price structure");
    expect(hasTechnicals).toBe(true);
  });

  test("includes packet data as JSON", () => {
    const packet = makePacket();
    const prompt = buildSingularityPrompt(packet);
    expect(prompt).toContain('"assembled_at"');
  });

  test("requests PerspectiveReport JSON response", () => {
    const prompt = buildSingularityPrompt(makePacket());
    expect(prompt).toContain("JSON");
  });
});

describe("buildDivergentPrompt", () => {
  test("contains session date and session name", () => {
    const prompt = buildDivergentPrompt(makePacket({ session: "asian", date: "2026-03-20" }));
    expect(prompt).toContain("2026-03-20");
    expect(prompt).toContain("asian");
  });

  test("mentions regime or sentiment", () => {
    const prompt = buildDivergentPrompt(makePacket());
    const has = prompt.includes("regime") || prompt.includes("sentiment");
    expect(has).toBe(true);
  });

  test("requests PerspectiveReport JSON response", () => {
    const prompt = buildDivergentPrompt(makePacket());
    expect(prompt).toContain("JSON");
  });
});

describe("buildHorizonPrompt", () => {
  test("contains session date and session name", () => {
    const prompt = buildHorizonPrompt(makePacket({ session: "new_york" }));
    expect(prompt).toContain("new_york");
    expect(prompt).toContain("2026-03-24");
  });

  test("mentions predict", () => {
    const prompt = buildHorizonPrompt(makePacket());
    expect(prompt.toLowerCase()).toContain("predict");
  });

  test("requests PerspectiveReport JSON response", () => {
    const prompt = buildHorizonPrompt(makePacket());
    expect(prompt).toContain("JSON");
  });
});

describe("buildOrchestratorPrompt", () => {
  test("contains session date and session name", () => {
    const prompt = buildOrchestratorPrompt(makePacket(), {
      singularity: null,
      divergent: null,
      horizon: null,
    });
    expect(prompt).toContain("2026-03-24");
    expect(prompt).toContain("london");
  });

  test("includes perspective content when provided", () => {
    const prompt = buildOrchestratorPrompt(makePacket(), {
      singularity: singularityReport,
      divergent: divergentReport,
      horizon: horizonReport,
    });
    expect(prompt).toContain("singularity");
    expect(prompt).toContain("divergent");
    expect(prompt).toContain("horizon");
    expect(prompt).toContain("120.5");
  });

  test("handles null perspectives gracefully", () => {
    const prompt = buildOrchestratorPrompt(makePacket(), {
      singularity: null,
      divergent: null,
      horizon: null,
    });
    expect(prompt).toContain("not available");
  });

  test("requests orchestrator JSON schema fields", () => {
    const prompt = buildOrchestratorPrompt(makePacket(), {
      singularity: singularityReport,
      divergent: null,
      horizon: null,
    });
    expect(prompt).toContain("alignments");
    expect(prompt).toContain("conflicts");
    expect(prompt).toContain("blind_spots");
    expect(prompt).toContain("missed_opportunities");
    expect(prompt).toContain("takeaways");
  });

  test("takeaway schema includes required fields", () => {
    const prompt = buildOrchestratorPrompt(makePacket(), {
      singularity: null,
      divergent: null,
      horizon: null,
    });
    expect(prompt).toContain("insight");
    expect(prompt).toContain("test_condition");
    expect(prompt).toContain("engines_involved");
    expect(prompt).toContain("confidence");
  });
});
