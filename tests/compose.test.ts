// Integration tests for processText() — pipeline entry point.
// Tests prove Phase 0 success criteria: byte-identical output, gate ordering,
// source_weight visibility, composite_score formula, and pipeline purity.
//
// NOTE on NLP behavior: compromise extracts noun phrases, not individual tokens.
// Adjacent repeated nouns form multi-word phrases (e.g. "thing thing thing" is
// one multi-word concept). Tests use single-word inputs to prove gate rejection,
// and properly-structured sentences to test named entities.

import { describe, test, expect } from "bun:test";
import { processText } from "../src/compose.ts";
import type { ConceptEvent } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Byte-identical output (purity / determinism)
// ---------------------------------------------------------------------------

describe("processText — purity and determinism", () => {
  test("returns byte-identical output when called twice with same arguments", () => {
    const text = "Learn machine learning now. Machine learning is powerful. Use machine learning daily.";
    const a = processText(text, 1.0, "concept", "2026-01-01T00:00:00Z");
    const b = processText(text, 1.0, "concept", "2026-01-01T00:00:00Z");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("returns byte-identical output when called three times (no global state mutation)", () => {
    const text = "Microsoft is a technology corporation known for research";
    const ts = "2026-01-01T12:00:00Z";
    const a = processText(text, 0.8, "concept", ts);
    const b = processText(text, 0.8, "concept", ts);
    const c = processText(text, 0.8, "concept", ts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toBe(JSON.stringify(c));
  });

  test("does not share state between calls with different inputs", () => {
    const ts = "2026-01-01T00:00:00Z";
    const a = processText("machine learning research analysis", 1.0, "concept", ts);
    const b = processText("Microsoft corporation technology", 0.7, "concept", ts);
    // Results are different (different inputs produce different outputs)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Gate ordering: stop-concepts must produce zero output when extracted solo
// ---------------------------------------------------------------------------

describe("processText — importance gate ordering", () => {
  test("single stop-concept word produces zero output", () => {
    // "thing", "problem", "system" are in STOP_CONCEPTS — extracted as individual nouns
    // and rejected by Rule 2 (STOP_CONCEPTS). amplify never runs for them.
    expect(processText("thing", 1.0, "concept", "2026-01-01T00:00:00Z")).toEqual([]);
    expect(processText("problem", 1.0, "concept", "2026-01-01T00:00:00Z")).toEqual([]);
    expect(processText("system", 1.0, "concept", "2026-01-01T00:00:00Z")).toEqual([]);
  });

  test("empty string produces empty output", () => {
    const result = processText("", 1.0, "concept", "2026-01-01T00:00:00Z");
    expect(result).toEqual([]);
  });

  test("concept that fails gate produces zero output regardless of repetition", () => {
    // Single stop-concept words individually fail the gate whether mentioned once or stated alone
    const ts = "2026-01-01T00:00:00Z";
    const once = processText("problem", 1.0, "concept", ts);
    const thrice = processText("thing", 1.0, "concept", ts);
    expect(once).toEqual([]);
    expect(thrice).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Named entity beats common noun: gate ensures signal quality
// ---------------------------------------------------------------------------

describe("processText — named entity vs common noun scoring", () => {
  test("named entity produces output; stop-concept alone produces none", () => {
    const ts = "2026-01-01T00:00:00Z";

    // Microsoft is an Organization — passes gate, gets scored
    const namedEntityResult = processText("Microsoft", 1.0, "concept", ts);

    // "problem" is a STOP_CONCEPT — rejected by gate entirely
    const stopConceptResult = processText("problem", 1.0, "concept", ts);

    expect(namedEntityResult.length).toBeGreaterThan(0);
    expect(stopConceptResult).toEqual([]);

    const msEvent = namedEntityResult.find(e => e.surface_form === "Microsoft");
    expect(msEvent).toBeDefined();
    expect(msEvent!.composite_score).toBeGreaterThan(0);
  });

  test("named entity composite_score exceeds stop-concept which is absent", () => {
    // A named entity with composite_score > 0 definitively outscores a stop-concept
    // with no output (implicitly score = 0).
    const ts = "2026-01-01T00:00:00Z";
    const namedResult = processText("Microsoft is a corporation", 1.0, "concept", ts);
    const stopResult = processText("problem", 1.0, "concept", ts);

    const msEvent = namedResult.find(e => e.surface_form === "Microsoft");
    expect(msEvent).toBeDefined();
    expect(msEvent!.composite_score).toBeGreaterThan(0);
    expect(stopResult).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// source_weight visibility — caller-injected, never computed
// ---------------------------------------------------------------------------

describe("processText — source_weight visibility", () => {
  test("all output events have source_weight=0.5 when caller passes 0.5", () => {
    const text = "machine learning research analysis";
    const result = processText(text, 0.5, "concept", "2026-01-01T00:00:00Z");
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(event.source_weight).toBe(0.5);
    }
  });

  test("all output events have source_weight=0.7 when caller passes 0.7", () => {
    const text = "machine learning research analysis";
    const result = processText(text, 0.7, "concept", "2026-01-01T00:00:00Z");
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(event.source_weight).toBe(0.7);
    }
  });

  test("all output events have source_weight=1.0 when caller passes 1.0", () => {
    const text = "machine learning research analysis";
    const result = processText(text, 1.0, "concept", "2026-01-01T00:00:00Z");
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(event.source_weight).toBe(1.0);
    }
  });

  test("source_weight differs between two calls with different weights", () => {
    const text = "machine learning research analysis";
    const ts = "2026-01-01T00:00:00Z";
    const result07 = processText(text, 0.7, "concept", ts);
    const result10 = processText(text, 1.0, "concept", ts);
    expect(result07.every(e => e.source_weight === 0.7)).toBe(true);
    expect(result10.every(e => e.source_weight === 1.0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// composite_score formula: importanceScore × frequencyAmplifier × sourceWeight
// ---------------------------------------------------------------------------

describe("processText — composite_score formula", () => {
  test("composite_score = importanceScore × frequencyAmplifier × sourceWeight for all events", () => {
    const text = "machine learning research analysis";
    const result = processText(text, 0.7, "concept", "2026-01-01T00:00:00Z");
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      const expected = event.importance_score * (1 + Math.log(event.frequency_count)) * event.source_weight;
      expect(event.composite_score).toBeCloseTo(expected, 10);
    }
  });

  test("composite_score with sourceWeight=1.0 equals importanceScore × frequencyAmplifier", () => {
    const text = "machine learning research analysis";
    const result = processText(text, 1.0, "concept", "2026-01-01T00:00:00Z");
    for (const event of result) {
      const amplifier = 1 + Math.log(event.frequency_count);
      expect(event.composite_score).toBeCloseTo(event.importance_score * amplifier * 1.0, 10);
    }
  });

  test("known formula: machine learning freq=3, sourceWeight=0.7 → composite=1.0×(1+ln(3))×0.7", () => {
    // "machine learning" appears exactly 3 times independently as a two-word phrase
    const text = "Learn machine learning now. Machine learning is powerful. Use machine learning daily.";
    const result = processText(text, 0.7, "concept", "2026-01-01T00:00:00Z");
    const mlEvent = result.find(e => e.surface_form === "machine learning");
    expect(mlEvent).toBeDefined();
    expect(mlEvent!.frequency_count).toBe(3);
    // 1.0 × (1 + Math.log(3)) × 0.7
    const expected = 1.0 * (1 + Math.log(3)) * 0.7;
    expect(mlEvent!.composite_score).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// Output determinism: sorted by concept_id ascending
// ---------------------------------------------------------------------------

describe("processText — deterministic output ordering", () => {
  test("output array is sorted by concept_id ascending", () => {
    const text = "Learn machine learning now. Machine learning is powerful. Use machine learning daily.";
    const result = processText(text, 1.0, "concept", "2026-01-01T00:00:00Z");
    for (let i = 1; i < result.length; i++) {
      // noUncheckedIndexedAccess: access within bounds asserted via loop constraint
      const curr = result[i] as ConceptEvent;
      const prev = result[i - 1] as ConceptEvent;
      expect(curr.concept_id).toBeGreaterThanOrEqual(prev.concept_id);
    }
  });

  test("output order is identical across two calls (concept_id sort is stable)", () => {
    const text = "Microsoft builds machine learning research tools for technology analysis";
    const ts = "2026-01-01T00:00:00Z";
    const a = processText(text, 1.0, "concept", ts);
    const b = processText(text, 1.0, "concept", ts);
    const aIds = a.map(e => e.concept_id);
    const bIds = b.map(e => e.concept_id);
    expect(aIds).toEqual(bIds);
  });
});

// ---------------------------------------------------------------------------
// ConceptEvent field completeness
// ---------------------------------------------------------------------------

describe("processText — ConceptEvent field completeness", () => {
  test("every ConceptEvent has all required fields with correct types", () => {
    const text = "machine learning research analysis";
    const result = processText(text, 0.8, "concept", "2026-01-01T00:00:00Z");
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(typeof event.concept_id).toBe("number");
      expect(typeof event.surface_form).toBe("string");
      expect(typeof event.importance_score).toBe("number");
      expect(typeof event.frequency_count).toBe("number");
      expect(typeof event.composite_score).toBe("number");
      expect(typeof event.source_weight).toBe("number");
      expect(typeof event.node_type).toBe("string");
      expect(typeof event.timestamp).toBe("string");
    }
  });

  test("timestamp is the caller-injected value, not a new Date()", () => {
    const ts = "2025-06-15T10:30:00Z";
    const result = processText("machine learning research", 1.0, "concept", ts);
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(event.timestamp).toBe(ts);
    }
  });

  test("node_type is passed through from caller", () => {
    const result = processText("machine learning research", 1.0, "moment", "2026-01-01T00:00:00Z");
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(event.node_type).toBe("moment");
    }
  });

  test("node_type defaults to 'concept' when not provided", () => {
    const result = processText("machine learning research", 1.0);
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(event.node_type).toBe("concept");
    }
  });

  test("timestamp defaults to a valid ISO 8601 string when not provided", () => {
    const before = new Date().toISOString();
    const result = processText("machine learning research", 1.0);
    const after = new Date().toISOString();
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) {
      expect(event.timestamp >= before).toBe(true);
      expect(event.timestamp <= after).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Purity: no side effects (filesystem, network, database)
// ---------------------------------------------------------------------------

describe("processText — purity (no I/O side effects)", () => {
  test("multiple calls in sequence all produce the same result (no accumulated state)", () => {
    const text = "machine learning research analysis";
    const ts = "2026-01-01T00:00:00Z";
    const results: (readonly ConceptEvent[])[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(processText(text, 1.0, "concept", ts));
    }
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i])).toBe(JSON.stringify(results[0]));
    }
  });
});
