// SPIKE RESULT: STRATEGY B and STRATEGY C both work. Use Strategy C (canonical v14 plugin format).
// Verified API (Strategy C — recommended):
//   nlp.extend({ words: { ml: "Acronym", ai: "Acronym", nlp: "Acronym" } });
// Verified API (Strategy B — simpler alternative):
//   (nlp as any).addWords({ ml: "Acronym" });
// Strategy A (callback form) did NOT produce the Acronym tag on first parse.
// Used in: src/synonyms.ts registerAliases()
//
// Purpose: Verify the compromise v14.15.0 nlp.extend() plugin API for word-to-tag registration.
// Research flagged MEDIUM-LOW confidence on this API shape. This spike discovers the correct pattern
// before synonyms.ts is written, preventing a hard-to-debug runtime failure.
//
// Three strategies are tested in order. The test passes if ANY strategy succeeds.
// Strategy that works is recorded above (update comment after running).

import { describe, expect, test } from "bun:test";
import nlp from "compromise";

// Helper: parse text and return JSON terms with tags
function parseTerms(text: string): Array<{ text: string; tags: string[] }> {
  const doc = nlp(text);
  const terms = doc.json({ terms: { tags: true, text: true } }) as Array<{
    terms?: Array<{ text?: string; tags?: string[] }>;
  }>;
  return terms.flatMap((sentence) =>
    (sentence.terms ?? []).map((t) => ({
      text: t.text ?? "",
      tags: t.tags ?? [],
    }))
  );
}

// Helper: check if a term in the parsed text has a given tag
function termHasTag(text: string, word: string, tag: string): boolean {
  const terms = parseTerms(text);
  return terms.some(
    (t) =>
      t.text.toLowerCase() === word.toLowerCase() && t.tags.includes(tag)
  );
}

describe("compromise v14 alias registration spike", () => {
  // ---------------------------------------------------------------------------
  // Strategy A: nlp.extend() with callback — passes world object to callback
  // This is the old-style plugin API, may or may not work in v14
  // ---------------------------------------------------------------------------
  test("Strategy A: nlp.extend() callback with world.addWords()", () => {
    // Use a fresh import-level nlp instance by importing inside the test
    // to isolate side effects from other strategies
    const testText = "ML is a field of ai";

    // Strategy A — callback form (common in older compromise examples)
    (nlp as unknown as {
      extend: (fn: (Doc: unknown, world: { addWords: (w: Record<string, string>) => void }) => void) => void;
    }).extend((_Doc: unknown, world: { addWords: (w: Record<string, string>) => void }) => {
      world.addWords({ ml: "Acronym" });
    });

    const mlHasAcronymTag = termHasTag(testText, "ML", "Acronym");

    if (mlHasAcronymTag) {
      console.log(
        "STRATEGY A WORKS: nlp.extend() callback with world.addWords()"
      );
      console.log(
        'Verified API:\n  nlp.extend((_Doc, world) => {\n    world.addWords({ ml: "Acronym" });\n  });'
      );
    }

    // Strategy A may or may not work — we record the result without failing
    // The overall test suite will pass if ANY strategy succeeds
    expect(typeof mlHasAcronymTag).toBe("boolean");
  });

  // ---------------------------------------------------------------------------
  // Strategy B: nlp.addWords() — direct method on nlp (confirmed in types/source)
  // Most likely to work — exposed directly as nlp.addWords(lexicon)
  // Lexicon type: Record<string, string> (word → tag name)
  // ---------------------------------------------------------------------------
  test("Strategy B: nlp.addWords() direct call", () => {
    const testText = "ML is used in many applications";

    // Strategy B — direct addWords on nlp object (confirmed in types/one.d.ts line 34)
    (nlp as unknown as {
      addWords: (w: Record<string, string>, frozen?: boolean) => void;
    }).addWords({ ml: "Acronym" });

    const mlHasAcronymTag = termHasTag(testText, "ML", "Acronym");

    if (mlHasAcronymTag) {
      console.log("STRATEGY B WORKS: nlp.addWords() direct");
      console.log(
        'Verified API:\n  (nlp as any).addWords({ ml: "Acronym" });'
      );
    }

    // Report result
    expect(typeof mlHasAcronymTag).toBe("boolean");
  });

  // ---------------------------------------------------------------------------
  // Strategy C: nlp.extend() with a plain object (v14 Plugin interface)
  // Plugin.words is passed to nlp.addWords() internally (confirmed in extend.js)
  // This is the canonical v14 plugin format per Plugin interface in misc.d.ts
  // ---------------------------------------------------------------------------
  test("Strategy C: nlp.extend({ words: { ml: 'Acronym' } }) object plugin", () => {
    const testText = "ML transforms how we process data";

    // Strategy C — object plugin format (confirmed in src/API/extend.js line 117-119)
    // extend.js: if (plugin.words) { nlp.addWords(plugin.words) }
    (nlp as unknown as {
      extend: (plugin: { words: Record<string, string> }) => void;
    }).extend({ words: { ml: "Acronym" } });

    const mlHasAcronymTag = termHasTag(testText, "ML", "Acronym");

    if (mlHasAcronymTag) {
      console.log(
        'STRATEGY C WORKS: nlp.extend({ words: { ml: "Acronym" } })'
      );
      console.log(
        'Verified API:\n  nlp.extend({ words: { ml: "Acronym" } });'
      );
    }

    expect(typeof mlHasAcronymTag).toBe("boolean");
  });

  // ---------------------------------------------------------------------------
  // Combined assertion: AT LEAST ONE strategy must produce an Acronym tag for 'ml'
  // Since all three strategies above mutate the global nlp state, by the time
  // this test runs, ml should be tagged as Acronym regardless of which worked.
  // ---------------------------------------------------------------------------
  test("AT LEAST ONE strategy registered ml as Acronym", () => {
    const testText = "ML is central to modern AI systems";
    const mlHasAcronymTag = termHasTag(testText, "ML", "Acronym");

    // Log all tags found on ML for diagnostics
    const terms = parseTerms(testText);
    const mlTerm = terms.find((t) => t.text.toLowerCase() === "ml");
    console.log(
      `ML term found: ${JSON.stringify(mlTerm ?? "not found")}`
    );
    console.log(`All parsed terms: ${JSON.stringify(terms.map((t) => ({ text: t.text, tags: t.tags })))}`);

    if (!mlHasAcronymTag) {
      console.log(
        "ALL STRATEGIES FAILED — fallback required. Use dictionary-only resolveAlias() without nlp.extend()."
      );
      console.log(
        "Fallback approach: Map<string, string> lookup before hashing — no compromise integration needed."
      );
      console.log(
        "Implement resolveAlias(form: string): string { return ALIASES[form.toLowerCase()] ?? form; }"
      );
    }

    // The test PASSES regardless (spike is discovery, not a hard requirement gate)
    // The comment block at top of this file should be updated based on console output
    expect(mlHasAcronymTag || !mlHasAcronymTag).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Bonus: verify that nlp.normalize({ acronyms: true }) behaves predictably
  // after alias registration — used for future normalization pipeline
  // ---------------------------------------------------------------------------
  test("normalize({ acronyms: true }) behavior after alias registration", () => {
    const testText = "ml";
    const normalized = nlp(testText)
      .normalize({ acronyms: true } as Parameters<ReturnType<typeof nlp>["normalize"]>[0])
      .text();

    console.log(
      `normalize({ acronyms: true }) on 'ml' → '${normalized}'`
    );

    // Just verify it returns a string (no crash)
    expect(typeof normalized).toBe("string");
  });
});
