import { describe, test, expect } from "bun:test";
import { levenshteinSimilarity, isDoomLoop } from "./circuit-breaker";

describe("levenshteinSimilarity", () => {
  test("identical strings → 1.0", () => {
    expect(levenshteinSimilarity("hello world", "hello world")).toBeCloseTo(1.0, 3);
  });

  test("completely different → low score", () => {
    expect(levenshteinSimilarity("abc", "xyz")).toBeLessThan(0.5);
  });

  test("one empty string → 0.0", () => {
    expect(levenshteinSimilarity("", "hello")).toBeCloseTo(0.0, 3);
  });

  test("near-identical → above 0.9", () => {
    const a = "The trade is RISK_ON, gamma=0.8, execute BUY";
    const b = "The trade is RISK_ON, gamma=0.8, execute BUY.";
    expect(levenshteinSimilarity(a, b)).toBeGreaterThan(0.9);
  });
});

describe("isDoomLoop", () => {
  test("no loop when outputs differ", () => {
    const outputs = [
      "Execute BUY with Kelly 0.3",
      "No trade — regime NEUTRAL",
      "Execute SELL with Kelly 0.2",
    ];
    const result = isDoomLoop(outputs);
    expect(result.is_doom_loop).toBe(false);
  });

  test("loop detected when last 3 are near-identical", () => {
    const repeated = "The consensus is RISK_ON, gamma=0.8, executing BUY signal.";
    const outputs = [repeated, repeated, repeated + " "];
    const result = isDoomLoop(outputs);
    expect(result.is_doom_loop).toBe(true);
    expect(result.similarity_score).toBeGreaterThan(0.9);
  });

  test("no loop with fewer than 3 outputs", () => {
    const outputs = ["hello", "hello"];
    expect(isDoomLoop(outputs).is_doom_loop).toBe(false);
  });
});
