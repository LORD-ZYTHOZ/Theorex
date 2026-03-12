import { describe, test, expect } from "bun:test";
import {
  computeDriftScore,
  detectInstability,
  detectSentimentFlips,
  classifyTrend,
} from "../../src/audit/scorer";

// Minimal inline AuditEvent shape for test construction
type TestAuditEvent = {
  type: string;
  timestamp: string;
  concept_id?: number;
  surface_form?: string;
  from?: string;
  to?: string;
  [key: string]: unknown;
};

// Helper: build a timestamp offset from a reference time
const MS_PER_DAY = 86_400_000;
const NOW_MS = 1_700_000_000_000; // fixed reference time for deterministic tests

function tsAt(offsetDays: number): string {
  return new Date(NOW_MS + offsetDays * MS_PER_DAY).toISOString();
}

// ---------------------------------------------------------------------------
// computeDriftScore
// ---------------------------------------------------------------------------

describe("computeDriftScore", () => {
  test("empty moment set → 1.0 (no anchors = no drift)", () => {
    expect(computeDriftScore(new Set(), new Set([1, 2, 3]))).toBe(1.0);
  });

  test("empty active set → 0.0 (all anchors drifted away)", () => {
    expect(computeDriftScore(new Set([1, 2, 3]), new Set())).toBe(0.0);
  });

  test("identical sets {1,2,3} → 1.0 (full overlap)", () => {
    expect(computeDriftScore(new Set([1, 2, 3]), new Set([1, 2, 3]))).toBe(1.0);
  });

  test("disjoint sets {1,2} vs {3,4} → 0.0 (complete divergence)", () => {
    expect(computeDriftScore(new Set([1, 2]), new Set([3, 4]))).toBe(0.0);
  });

  test("partial overlap: moment={1,2,3}, active={2,3,4} → 0.5", () => {
    // intersection={2,3}=2, union={1,2,3,4}=4 → 2/4=0.5
    expect(computeDriftScore(new Set([1, 2, 3]), new Set([2, 3, 4]))).toBe(0.5);
  });

  test("single element overlap: moment={1}, active={1} → 1.0", () => {
    expect(computeDriftScore(new Set([1]), new Set([1]))).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// detectInstability
// ---------------------------------------------------------------------------

describe("detectInstability", () => {
  test("empty events → []", () => {
    const result = detectInstability([], 30, NOW_MS);
    expect(result).toEqual([]);
  });

  test("tier_change from ACTIVE to MILD within window → flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "tier_change",
        timestamp: tsAt(-1), // 1 day ago (within 30-day window)
        concept_id: 42,
        surface_form: "machine learning",
        from: "ACTIVE",
        to: "MILD",
      },
    ];
    const result = detectInstability(events as any, 30, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].concept_id).toBe(42);
    expect(result[0].surface_form).toBe("machine learning");
    expect(result[0].from).toBe("ACTIVE");
    expect(result[0].to).toBe("MILD");
  });

  test("tier_change from ACTIVE to LESS within window → flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "tier_change",
        timestamp: tsAt(-5),
        concept_id: 7,
        surface_form: "neural net",
        from: "ACTIVE",
        to: "LESS",
      },
    ];
    const result = detectInstability(events as any, 30, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].to).toBe("LESS");
  });

  test("tier_change from MILD to LESS (from is not ACTIVE) → not flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "tier_change",
        timestamp: tsAt(-1),
        concept_id: 10,
        surface_form: "backprop",
        from: "MILD",
        to: "LESS",
      },
    ];
    const result = detectInstability(events as any, 30, NOW_MS);
    expect(result).toHaveLength(0);
  });

  test("tier_change from ACTIVE to MILD OUTSIDE window → not flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "tier_change",
        timestamp: tsAt(-31), // 31 days ago, outside 30-day window
        concept_id: 5,
        surface_form: "gradient descent",
        from: "ACTIVE",
        to: "MILD",
      },
    ];
    const result = detectInstability(events as any, 30, NOW_MS);
    expect(result).toHaveLength(0);
  });

  test("non-tier_change events (graduation, prune) → not flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "graduation",
        timestamp: tsAt(-1),
        concept_id: 3,
        surface_form: "transformers",
        from: "ACTIVE",
        to: "MILD",
      },
      {
        type: "prune",
        timestamp: tsAt(-1),
        concept_id: 4,
        surface_form: "rnn",
        from: "ACTIVE",
        to: "LESS",
      },
    ];
    const result = detectInstability(events as any, 30, NOW_MS);
    expect(result).toHaveLength(0);
  });

  test("dropped_at field is the ISO timestamp of the event", () => {
    const ts = tsAt(-2);
    const events: TestAuditEvent[] = [
      {
        type: "tier_change",
        timestamp: ts,
        concept_id: 99,
        surface_form: "attention",
        from: "ACTIVE",
        to: "MILD",
      },
    ];
    const result = detectInstability(events as any, 30, NOW_MS);
    expect(result[0].dropped_at).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// detectSentimentFlips
// ---------------------------------------------------------------------------

describe("detectSentimentFlips", () => {
  test("concept with PREFERRED then DISPREFERRED within window → flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "sentiment_flip",
        timestamp: tsAt(-2),
        concept_id: 11,
        surface_form: "python",
        from: "NEUTRAL",
        to: "PREFERRED",
      },
      {
        type: "sentiment_flip",
        timestamp: tsAt(-1),
        concept_id: 11,
        surface_form: "python",
        from: "PREFERRED",
        to: "DISPREFERRED",
      },
    ];
    const result = detectSentimentFlips(events as any, 30, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].concept_id).toBe(11);
    expect(result[0].surface_form).toBe("python");
    expect(result[0].sentiments_seen).toContain("PREFERRED");
    expect(result[0].sentiments_seen).toContain("DISPREFERRED");
  });

  test("concept with only PREFERRED → not flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "sentiment_flip",
        timestamp: tsAt(-1),
        concept_id: 20,
        surface_form: "rust",
        from: "NEUTRAL",
        to: "PREFERRED",
      },
    ];
    const result = detectSentimentFlips(events as any, 30, NOW_MS);
    expect(result).toHaveLength(0);
  });

  test("concept with only DISPREFERRED → not flagged", () => {
    const events: TestAuditEvent[] = [
      {
        type: "sentiment_flip",
        timestamp: tsAt(-1),
        concept_id: 30,
        surface_form: "php",
        from: "NEUTRAL",
        to: "DISPREFERRED",
      },
    ];
    const result = detectSentimentFlips(events as any, 30, NOW_MS);
    expect(result).toHaveLength(0);
  });

  test("sentiment events outside window → excluded from flip detection", () => {
    const events: TestAuditEvent[] = [
      {
        type: "sentiment_flip",
        timestamp: tsAt(-31), // outside window
        concept_id: 40,
        surface_form: "cobol",
        from: "NEUTRAL",
        to: "PREFERRED",
      },
      {
        type: "sentiment_flip",
        timestamp: tsAt(-32), // also outside window
        concept_id: 40,
        surface_form: "cobol",
        from: "PREFERRED",
        to: "DISPREFERRED",
      },
    ];
    const result = detectSentimentFlips(events as any, 30, NOW_MS);
    expect(result).toHaveLength(0);
  });

  test("mixed in-window and out-of-window events for same concept → only in-window counted", () => {
    const events: TestAuditEvent[] = [
      {
        type: "sentiment_flip",
        timestamp: tsAt(-31), // outside window → PREFERRED not counted
        concept_id: 50,
        surface_form: "java",
        from: "NEUTRAL",
        to: "PREFERRED",
      },
      {
        type: "sentiment_flip",
        timestamp: tsAt(-1), // inside window → DISPREFERRED counted
        concept_id: 50,
        surface_form: "java",
        from: "PREFERRED",
        to: "DISPREFERRED",
      },
    ];
    // Only DISPREFERRED is in-window; PREFERRED was out-of-window → not flagged
    const result = detectSentimentFlips(events as any, 30, NOW_MS);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// classifyTrend
// ---------------------------------------------------------------------------

describe("classifyTrend", () => {
  test('score=0.8, instability=0 → "stable"', () => {
    expect(classifyTrend(0.8, 0)).toBe("stable");
  });

  test('score=0.8, instability=2 → "recovering" (high score + recent instability)', () => {
    expect(classifyTrend(0.8, 2)).toBe("recovering");
  });

  test('score=0.3, instability=0 → "drifting" (score < 0.5)', () => {
    expect(classifyTrend(0.3, 0)).toBe("drifting");
  });

  test('score=0.6, instability=5 → "drifting" (instability >= 3)', () => {
    expect(classifyTrend(0.6, 5)).toBe("drifting");
  });

  test('score=0.6, instability=1 → "stable" (score >= 0.5, instability < 3, score < 0.7)', () => {
    expect(classifyTrend(0.6, 1)).toBe("stable");
  });

  test('score=0.7, instability=0 → "stable" (score at recovering threshold but no instability)', () => {
    expect(classifyTrend(0.7, 0)).toBe("stable");
  });

  test('score=0.5, instability=0 → "stable" (at boundary)', () => {
    expect(classifyTrend(0.5, 0)).toBe("stable");
  });

  test('score=0.49, instability=0 → "drifting" (just below 0.5)', () => {
    expect(classifyTrend(0.49, 0)).toBe("drifting");
  });

  test('score=0.7, instability=1 → "recovering" (score >= 0.7 AND instability > 0)', () => {
    expect(classifyTrend(0.7, 1)).toBe("recovering");
  });
});
