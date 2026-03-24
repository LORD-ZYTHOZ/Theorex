// tests/lesson.test.ts — Phase 13 richer lesson schema tests.
// Covers: LessonRecord store, synthesizeLesson, session brief generation.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildLesson,
  writeLesson,
  readLesson,
  readAllLessons,
  readActiveLessons,
  reinforceLesson,
  computeLessonScore,
  type LessonRecord,
} from "../evolve/lesson";

import {
  synthesizeLessons,
  type SynthesisInput,
} from "../evolve/synthesize";

import {
  buildSessionBrief,
  formatSessionBrief,
} from "../evolve/session-brief";

import { buildOutcome } from "../evolve/outcome";
import type { OutcomeRecord } from "../evolve/outcome";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutcome(
  agentId: string,
  tags: string[],
  success: boolean,
  explicit_score?: number,
): OutcomeRecord {
  return {
    ...buildOutcome({ agentId, decision: "test decision", result: "test result", success, tags }),
    explicit_score,
  };
}

// ---------------------------------------------------------------------------
// buildLesson
// ---------------------------------------------------------------------------

describe("buildLesson", () => {
  test("produces a valid LessonRecord with all required fields", () => {
    const lesson = buildLesson({
      agentId: "main",
      domain: "coding",
      lessonType: "methodology",
      title: "Always run impact analysis before editing",
      recommendation: "Run theronexus_impact before any edit",
      confidence: 0.8,
      evidenceCount: 6,
      evidenceQualityScore: 0.75,
      timeHorizon: "permanent",
      evidenceOutcomeIds: ["abc", "def"],
    });

    expect(lesson.id).toBeString();
    expect(lesson.agent_id).toBe("main");
    expect(lesson.domain).toBe("coding");
    expect(lesson.lesson_type).toBe("methodology");
    expect(lesson.confidence).toBe(0.8);
    expect(lesson.evidence_count).toBe(6);
    expect(lesson.evidence_quality_score).toBe(0.75);
    expect(lesson.time_horizon).toBe("permanent");
    expect(lesson.evidence_outcome_ids).toEqual(["abc", "def"]);
    expect(lesson.decay_rate).toBeGreaterThan(0);
    expect(lesson.first_observed).toBeString();
    expect(lesson.last_reinforced).toBeString();
  });

  test("sets decay_rate based on time_horizon", () => {
    const immediate = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "t", recommendation: "r", confidence: 0.5, evidenceCount: 2, evidenceQualityScore: 0.5, timeHorizon: "immediate", evidenceOutcomeIds: [] });
    const permanent = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "t", recommendation: "r", confidence: 0.5, evidenceCount: 2, evidenceQualityScore: 0.5, timeHorizon: "permanent", evidenceOutcomeIds: [] });
    expect(immediate.decay_rate).toBeGreaterThan(permanent.decay_rate);
  });
});

// ---------------------------------------------------------------------------
// computeLessonScore
// ---------------------------------------------------------------------------

describe("computeLessonScore", () => {
  test("returns 0 for expired immediate lesson", () => {
    const old = buildLesson({
      agentId: "main", domain: "trading", lessonType: "domain_fact",
      title: "t", recommendation: "r", confidence: 0.9,
      evidenceCount: 5, evidenceQualityScore: 0.8, timeHorizon: "immediate",
      evidenceOutcomeIds: [],
    });
    // Override last_reinforced to 4 days ago (immediate decay_rate=0.5, e^(-2)≈0.135 → score<0.1)
    const stale: LessonRecord = {
      ...old,
      last_reinforced: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    };
    const score = computeLessonScore(stale);
    expect(score).toBeLessThan(0.1);
  });

  test("permanent lesson retains high score even when old", () => {
    const lesson = buildLesson({
      agentId: "main", domain: "coding", lessonType: "methodology",
      title: "t", recommendation: "r", confidence: 0.9,
      evidenceCount: 10, evidenceQualityScore: 0.85, timeHorizon: "permanent",
      evidenceOutcomeIds: [],
    });
    const old: LessonRecord = {
      ...lesson,
      last_reinforced: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    };
    const score = computeLessonScore(old);
    expect(score).toBeGreaterThan(0.4);
  });

  test("low evidence quality reduces score", () => {
    const high = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "t", recommendation: "r", confidence: 0.8, evidenceCount: 8, evidenceQualityScore: 0.9, timeHorizon: "medium", evidenceOutcomeIds: [] });
    const low = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "t", recommendation: "r", confidence: 0.8, evidenceCount: 8, evidenceQualityScore: 0.2, timeHorizon: "medium", evidenceOutcomeIds: [] });
    expect(computeLessonScore(high)).toBeGreaterThan(computeLessonScore(low));
  });
});

// ---------------------------------------------------------------------------
// Lesson store — write / read / reinforce
// ---------------------------------------------------------------------------

describe("Lesson store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "theorex-lesson-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("write + readLesson roundtrip", async () => {
    const lesson = buildLesson({
      agentId: "main", domain: "coding", lessonType: "methodology",
      title: "Run tests before committing", recommendation: "Always run bun test first",
      confidence: 0.9, evidenceCount: 5, evidenceQualityScore: 0.8,
      timeHorizon: "permanent", evidenceOutcomeIds: ["x1"],
    });
    await writeLesson(lesson, dir);
    const loaded = await readLesson(lesson.id, dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(lesson.id);
    expect(loaded!.title).toBe("Run tests before committing");
  });

  test("readLesson returns null for missing id", async () => {
    const result = await readLesson("nonexistent", dir);
    expect(result).toBeNull();
  });

  test("readAllLessons returns all written lessons", async () => {
    for (let i = 0; i < 3; i++) {
      await writeLesson(buildLesson({
        agentId: "main", domain: "trading", lessonType: "domain_fact",
        title: `lesson ${i}`, recommendation: `do ${i}`,
        confidence: 0.7, evidenceCount: 3, evidenceQualityScore: 0.6,
        timeHorizon: "short", evidenceOutcomeIds: [],
      }), dir);
    }
    const all = await readAllLessons(dir);
    expect(all.length).toBe(3);
  });

  test("readActiveLessons filters by minimum score", async () => {
    // high-quality permanent lesson
    await writeLesson(buildLesson({
      agentId: "main", domain: "coding", lessonType: "methodology",
      title: "strong lesson", recommendation: "do this",
      confidence: 0.95, evidenceCount: 12, evidenceQualityScore: 0.9,
      timeHorizon: "permanent", evidenceOutcomeIds: [],
    }), dir);

    // stale immediate lesson (override last_reinforced)
    const stale = buildLesson({
      agentId: "main", domain: "trading", lessonType: "domain_fact",
      title: "stale lesson", recommendation: "meh",
      confidence: 0.4, evidenceCount: 2, evidenceQualityScore: 0.3,
      timeHorizon: "immediate", evidenceOutcomeIds: [],
    });
    await writeLesson({
      ...stale,
      last_reinforced: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    }, dir);

    const active = await readActiveLessons(dir, { minScore: 0.3 });
    expect(active.length).toBe(1);
    expect(active[0].title).toBe("strong lesson");
  });

  test("reinforceLesson updates last_reinforced and increments evidence_count", async () => {
    const lesson = buildLesson({
      agentId: "main", domain: "trading", lessonType: "domain_fact",
      title: "Asia range matters", recommendation: "Check Asia range before London entry",
      confidence: 0.7, evidenceCount: 4, evidenceQualityScore: 0.65,
      timeHorizon: "medium", evidenceOutcomeIds: [],
    });
    await writeLesson(lesson, dir);

    const before = new Date(lesson.last_reinforced).getTime();
    await new Promise((r) => setTimeout(r, 5)); // ensure clock moves
    await reinforceLesson(lesson.id, dir, { newOutcomeId: "y1", newQualityScore: 0.8 });

    const updated = await readLesson(lesson.id, dir);
    expect(updated!.evidence_count).toBe(5);
    expect(new Date(updated!.last_reinforced).getTime()).toBeGreaterThan(before);
    expect(updated!.evidence_outcome_ids).toContain("y1");
  });
});

// ---------------------------------------------------------------------------
// synthesizeLessons
// ---------------------------------------------------------------------------

describe("synthesizeLessons", () => {
  test("produces no lessons with insufficient outcomes", () => {
    const input: SynthesisInput = {
      agentId: "main",
      domain: "trading",
      outcomes: [makeOutcome("main", ["asia-range"], true)],
    };
    const lessons = synthesizeLessons(input);
    expect(lessons.length).toBe(0);
  });

  test("synthesizes a lesson from a strong tag pattern", () => {
    const outcomes = [
      makeOutcome("main", ["london-breakout"], true, 0.9),
      makeOutcome("main", ["london-breakout"], true, 0.85),
      makeOutcome("main", ["london-breakout"], true, 0.8),
      makeOutcome("main", ["london-breakout"], false, 0.1),
      makeOutcome("main", ["london-breakout"], true, 0.75),
    ];
    const lessons = synthesizeLessons({ agentId: "main", domain: "trading", outcomes });
    const l = lessons.find((x) => x.title.includes("london-breakout"));
    expect(l).toBeDefined();
    expect(l!.confidence).toBeGreaterThan(0.5);
    expect(l!.lesson_type).toBe("domain_fact");
  });

  test("marks a weak pattern lesson with low confidence", () => {
    const outcomes = [
      makeOutcome("main", ["counter-trend"], false, 0.1),
      makeOutcome("main", ["counter-trend"], false, 0.05),
      makeOutcome("main", ["counter-trend"], false, 0.0),
      makeOutcome("main", ["counter-trend"], true, 0.6),
      makeOutcome("main", ["counter-trend"], false, 0.1),
    ];
    const lessons = synthesizeLessons({ agentId: "main", domain: "trading", outcomes });
    const l = lessons.find((x) => x.title.includes("counter-trend"));
    expect(l).toBeDefined();
    expect(l!.confidence).toBeLessThan(0.4);
  });

  test("does not cross-pollinate different domains", () => {
    const outcomes = Array.from({ length: 5 }, (_, i) =>
      makeOutcome("main", ["refactor-pattern"], i < 4, 0.8)
    );
    const lessons = synthesizeLessons({ agentId: "main", domain: "coding", outcomes });
    expect(lessons.every((l) => l.domain === "coding")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSessionBrief / formatSessionBrief
// ---------------------------------------------------------------------------

describe("buildSessionBrief", () => {
  test("returns empty brief when no lessons", () => {
    const brief = buildSessionBrief([], { domain: "trading", maxLessons: 5 });
    expect(brief.lessons.length).toBe(0);
  });

  test("filters by domain", () => {
    const trading = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "trade lesson", recommendation: "r", confidence: 0.9, evidenceCount: 6, evidenceQualityScore: 0.8, timeHorizon: "medium", evidenceOutcomeIds: [] });
    const coding = buildLesson({ agentId: "main", domain: "coding", lessonType: "methodology", title: "code lesson", recommendation: "r", confidence: 0.9, evidenceCount: 6, evidenceQualityScore: 0.8, timeHorizon: "medium", evidenceOutcomeIds: [] });

    const brief = buildSessionBrief([trading, coding], { domain: "trading", maxLessons: 10 });
    expect(brief.lessons.every((l) => l.domain === "trading")).toBe(true);
    expect(brief.lessons.length).toBe(1);
  });

  test("respects maxLessons cap", () => {
    const lessons = Array.from({ length: 10 }, (_, i) =>
      buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: `lesson ${i}`, recommendation: "r", confidence: 0.8, evidenceCount: 5, evidenceQualityScore: 0.7, timeHorizon: "medium", evidenceOutcomeIds: [] })
    );
    const brief = buildSessionBrief(lessons, { domain: "trading", maxLessons: 3 });
    expect(brief.lessons.length).toBe(3);
  });

  test("sorts by score descending", () => {
    const strong = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "strong", recommendation: "r", confidence: 0.95, evidenceCount: 15, evidenceQualityScore: 0.9, timeHorizon: "permanent", evidenceOutcomeIds: [] });
    const weak = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "weak", recommendation: "r", confidence: 0.4, evidenceCount: 3, evidenceQualityScore: 0.3, timeHorizon: "short", evidenceOutcomeIds: [] });

    const brief = buildSessionBrief([weak, strong], { domain: "trading", maxLessons: 10 });
    expect(brief.lessons[0].title).toBe("strong");
  });

  test("formatSessionBrief produces readable text", () => {
    const lesson = buildLesson({ agentId: "main", domain: "trading", lessonType: "domain_fact", title: "London breakout works", recommendation: "Enter on London open break with HTF bias confirmed", confidence: 0.85, evidenceCount: 8, evidenceQualityScore: 0.8, timeHorizon: "medium", evidenceOutcomeIds: [] });
    const brief = buildSessionBrief([lesson], { domain: "trading", maxLessons: 5 });
    const text = formatSessionBrief(brief);
    expect(text).toContain("London breakout works");
    expect(text).toContain("Enter on London open break");
    expect(text).toContain("confidence");
  });
});
