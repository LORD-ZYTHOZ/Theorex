// tests/deliberate/takeaways.test.ts — Tests for takeaway extractor.

import { describe, test, expect } from "bun:test";
import { extractTakeaways } from "../../src/deliberate/takeaways";

describe("extractTakeaways", () => {
  test("parses valid JSON with 3 takeaways", () => {
    const input = JSON.stringify({
      takeaways: [
        {
          insight: "Asian session showed strong momentum",
          test_condition: "price > vwap",
          engines_involved: ["singularity", "divergent"],
          confidence: 0.9,
        },
        {
          insight: "Divergent signals aligned on long bias",
          test_condition: null,
          engines_involved: ["divergent"],
          confidence: 0.7,
        },
        {
          insight: "Horizon exposure was minimal",
          test_condition: "exposure < 0.5",
          engines_involved: ["horizon"],
          confidence: 0.85,
        },
      ],
    });

    const result = extractTakeaways(input);

    expect(result).toHaveLength(3);
    expect(result[0].insight).toBe("Asian session showed strong momentum");
    expect(result[0].test_condition).toBe("price > vwap");
    expect(result[0].engines_involved).toEqual(["singularity", "divergent"]);
    expect(result[0].confidence).toBe(0.9);
    expect(result[1].test_condition).toBeNull();
    expect(result[2].engines_involved).toEqual(["horizon"]);
  });

  test("filters out takeaway with confidence < 0.3, keeps >= 0.3", () => {
    const input = JSON.stringify({
      takeaways: [
        {
          insight: "Low confidence noise",
          test_condition: null,
          engines_involved: ["singularity"],
          confidence: 0.2,
        },
        {
          insight: "Medium confidence signal",
          test_condition: "rsi > 70",
          engines_involved: ["divergent"],
          confidence: 0.5,
        },
      ],
    });

    const result = extractTakeaways(input);

    expect(result).toHaveLength(1);
    expect(result[0].insight).toBe("Medium confidence signal");
    expect(result[0].confidence).toBe(0.5);
  });

  test("returns empty array on malformed JSON", () => {
    const result = extractTakeaways("not valid json {{{");

    expect(result).toEqual([]);
  });

  test("returns empty array when takeaways key is missing", () => {
    const input = JSON.stringify({ summary: "no takeaways here" });

    const result = extractTakeaways(input);

    expect(result).toEqual([]);
  });

  test("skips takeaway with missing insight field", () => {
    const input = JSON.stringify({
      takeaways: [
        {
          // no insight field
          test_condition: null,
          engines_involved: ["singularity"],
          confidence: 0.8,
        },
        {
          insight: "Valid takeaway",
          test_condition: null,
          engines_involved: ["horizon"],
          confidence: 0.6,
        },
      ],
    });

    const result = extractTakeaways(input);

    expect(result).toHaveLength(1);
    expect(result[0].insight).toBe("Valid takeaway");
  });
});
