import { describe, test, expect } from "bun:test";
import {
  computeSingularityReward,
  computeSignalReward,
  normalizeReward,
} from "./resolver";

describe("computeSingularityReward", () => {
  test("TP trade → positive reward", () => {
    const r = computeSingularityReward({ outcome: "TP", pnl: 12.5, r: 1.5 });
    expect(r).toBeGreaterThan(0);
  });

  test("SL trade → negative reward", () => {
    const r = computeSingularityReward({ outcome: "SL", pnl: -8.3, r: -1.0 });
    expect(r).toBeLessThan(0);
  });

  test("TIMEOUT with near-zero pnl → near-zero reward", () => {
    const r = computeSingularityReward({ outcome: "TIMEOUT", pnl: 0.1, r: 0.01 });
    expect(r).toBeCloseTo(0, 1);
  });
});

describe("computeSignalReward", () => {
  test("correct BUY signal → 1.0", () => {
    expect(computeSignalReward("BUY", 1850.0, 1855.0)).toBe(1.0);
  });

  test("wrong BUY signal → 0.0", () => {
    expect(computeSignalReward("BUY", 1850.0, 1845.0)).toBe(0.0);
  });

  test("correct SELL signal → 1.0", () => {
    expect(computeSignalReward("SELL", 1850.0, 1844.0)).toBe(1.0);
  });
});

describe("normalizeReward", () => {
  test("alpha+beta trade blend", () => {
    const r = normalizeReward({ tradeReward: 0.8, signalCorrect: 1.0, alpha: 0.6, beta: 0.4 });
    expect(r).toBeCloseTo(0.88, 2);
  });

  test("signal-only (alpha=0)", () => {
    const r = normalizeReward({ tradeReward: 0, signalCorrect: 1.0, alpha: 0.0, beta: 1.0 });
    expect(r).toBeCloseTo(1.0, 2);
  });
});
