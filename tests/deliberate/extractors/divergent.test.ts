// tests/deliberate/extractors/divergent.test.ts — Divergent report extractor tests.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDivergentReport } from "../../../src/deliberate/extractors/divergent";
import type { DivergentReport } from "../../../src/deliberate/types";

const TMP = join(tmpdir(), "theorex-divergent-test-" + Date.now());
const REPORT_PATH = join(TMP, "divergent-report.json");

const SAMPLE_REPORT: DivergentReport = {
  source: "divergent",
  signal_count: 3,
  agreement_rate: 0.8,
  signals: [
    { timestamp: "2026-03-24T03:00:00Z", direction: "long", confidence: 0.85, models_agreed: 4, models_total: 5 },
    { timestamp: "2026-03-24T03:15:00Z", direction: "short", confidence: 0.6, models_agreed: 3, models_total: 5 },
    { timestamp: "2026-03-24T03:30:00Z", direction: "neutral", confidence: 0.4, models_agreed: 2, models_total: 5 },
  ],
};

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
  await Bun.write(REPORT_PATH, JSON.stringify(SAMPLE_REPORT));
});

afterAll(() => rm(TMP, { recursive: true, force: true }));

describe("extractDivergentReport", () => {
  test("returns null for non-existent file", async () => {
    const result = await extractDivergentReport(join(TMP, "nope.json"), "asian", "2026-03-24");
    expect(result).toBeNull();
  });

  test("parses valid JSON file into DivergentReport", async () => {
    const result = await extractDivergentReport(REPORT_PATH, "asian", "2026-03-24");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("divergent");
    expect(result!.signal_count).toBe(3);
    expect(result!.agreement_rate).toBe(0.8);
    expect(result!.signals).toHaveLength(3);
    expect(result!.signals[0]!.direction).toBe("long");
    expect(result!.signals[0]!.confidence).toBe(0.85);
    expect(result!.signals[1]!.models_agreed).toBe(3);
  });
});
