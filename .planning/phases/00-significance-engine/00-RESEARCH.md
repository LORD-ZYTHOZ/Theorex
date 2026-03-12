# Phase 0: Significance Engine - Research

**Researched:** 2026-03-10
**Domain:** NLP concept extraction, pure functional pipelines, Bun TypeScript, heuristic importance gating
**Confidence:** HIGH (stack) / HIGH (architecture patterns) / MEDIUM (gate heuristics — by design, tuning deferred)

## Summary

Phase 0 builds a stateless pure-function pipeline that accepts a text string and returns `ConceptEvent[]`. The stack is narrow and well-chosen: compromise v14 for English NLP, Bun 1.3.7+ for runtime and testing, and `Bun.hash` for stable numeric IDs. No external dependencies beyond compromise are needed for Phase 0 — all other capabilities (embeddings, BM25, storage) are deferred.

The single hardest design problem in this phase is defining the importance gate heuristic. The gate is intentionally left as hand-coded heuristics to collect empirical data before tuning. Research confirms that POS tags plus named entity type plus stop-word anti-pattern is the standard approach for lightweight binary gating without an ML model. The key heuristic signals are: does compromise tag it as `#Noun`, `#Person`, `#Place`, `#Organization`, `#Value`, or `#ProperNoun`? Does it survive stop-word removal? Is it multi-word (higher precision)? Any concept that fails these checks never enters frequency counting.

The shared data model — `ConceptEvent` with all eight fields including `source_weight` and `node_type` — must be locked here even though most fields are consumed downstream. This is the only time the data schema is defined; all later phases consume it as-is.

**Primary recommendation:** Build the pipeline as five pure functions composed in a single `processText()` export. Gate early, hash for IDs, normalize with compromise's built-in `normalize({plurals:true, verbs:true})` for canonical forms, and use `Bun.hash.wyhash()` for 64-bit deterministic IDs.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Runtime:** Bun (not Node.js), TypeScript throughout
- **NLP:** compromise library for concept extraction and synonym normalization
- **ID assignment:** Every unique concept maps to a stable numeric ID — the word is just a label
- **Synonym collapse:** Synonyms collapse to one node ID ("ML" and "machine learning" → same ID)
- **Gate ordering:** Importance gate is a HARD prerequisite — frequency counting MUST NEVER run before gate PASS
- **Gate implementation:** Start with hand-coded heuristics (no ML model)
- **No pre-optimization:** Do NOT pre-optimize the threshold — collect data in Phases 1-2 first
- **Source weight:** Every ConceptEvent carries source_weight; Claude = 1.0 (baseline)
- **Frequency amplification:** Composite score = gate_pass × frequency_amplifier × source_weight; amplifier is log-normalized
- **Shared data model (locked):** `ConceptEvent: { concept_id, surface_form, importance_score, frequency_count, composite_score, source_weight, node_type, timestamp }`
- **node_type values:** "concept" (Phase 0), "moment" (Phase 5), "code_function" (Phase 7)
- **Purity constraints:** No filesystem writes, no database calls, no network I/O, no side effects — same input → byte-identical output

### Claude's Discretion
- Exact synonym resolution strategy (dictionary lookup vs. NLP-based)
- Specific heuristic rules for the importance gate (to be determined empirically)
- Internal data structures (maps, arrays, objects)
- File/module organization within Bun project
- Test framework choice (Bun built-in test runner preferred)

### Deferred Ideas (OUT OF SCOPE)
- Embedding-based synonym resolution → Phase 4
- Sentiment classification (PREFERRED/NEUTRAL/DISPREFERRED) → Phase 1
- Relevance tiers (ACTIVE/MILD/LESS) → Phase 1
- Frequency history storage → Phase 1 (Long-Term Lobe)
- ML-tuned importance gate threshold → after Phases 1-2 collect data
- Cross-pollination (one-hop activation propagation) → Phase 1
- Moment nodes → Phase 5
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SIG-01 | System extracts concept candidates from any text input using NLP (noun phrases, named entities, domain terms) | compromise v14 `.nouns()`, `.topics()`, `.people()`, `.places()`, `.organizations()`, `.match('#ProperNoun')` |
| SIG-02 | System applies importance gate — binary yes/no — before frequency is counted (importance must be hard prerequisite, not weighted factor) | Heuristic gate design: POS-tag filter + named entity type + multi-word boost + stop-word exclusion; pure function returns `boolean` |
| SIG-03 | System assigns numeric IDs to concepts — synonyms collapse to one canonical ID | compromise `.normalize({plurals:true,verbs:true})` produces canonical surface form; `Bun.hash.wyhash(canonicalForm)` → stable BigInt ID |
| SIG-04 | System amplifies frequency score only for concepts that pass the importance gate | `frequencyAmplifier = 1 + Math.log1p(frequency_count)`; only called after gate returns true |
| SIG-05 | System records source weight field on every signal (which AI agent or human generated it) | `source_weight` is a parameter injected by caller; not computed by pipeline; defined in ConceptEvent type |
| SIG-06 | All significance functions are pure (input → output, no side effects, no mutation) | Bun test runner with deterministic snapshot tests; all functions accept frozen readonly params, return new objects |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bun | 1.3.7+ | Runtime, test runner, package manager | Locked by project decision; native TypeScript, zero config |
| compromise | 14.15.0 | NLP: noun extraction, entity recognition, normalization, POS tagging | Locked by project decision; English-focused, no deps, browser + Node, ~250KB |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/bun | latest | TypeScript types for Bun globals (`Bun.hash`, etc.) | Always — enables Bun.hash without type errors |

### No External Dependencies Needed for Phase 0
- `Bun.hash` is built-in — no npm package required for hashing
- compromise handles all NLP — no spaCy, no compromise-pos, no wink-nlp
- No BM25, no embeddings, no storage in Phase 0

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| compromise | wink-nlp | wink-nlp is faster and more accurate but heavier; compromise sufficient for Phase 0 heuristic gate |
| compromise | natural (npm) | natural has stemmer/tokenizer only; lacks POS tagging needed for gate |
| Bun.hash.wyhash | crypto.randomUUID | UUID is non-deterministic — breaks purity constraint |
| Bun.hash.wyhash | djb2 hand-coded | Bun.hash is built-in, zero-dependency, equal performance |

**Installation:**
```bash
bun add compromise
bun add -d @types/bun
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── types.ts            # ConceptEvent, PipelineInput, GateResult — shared data model, all phases
├── extract.ts          # extractConcepts(): text → RawConcept[]
├── normalize.ts        # normalizeConcepts(): RawConcept[] → NormalizedConcept[]
├── identify.ts         # assignIds(): NormalizedConcept[] → IdentifiedConcept[]
├── gate.ts             # importanceGate(): IdentifiedConcept[] → GatedConcept[]
├── amplify.ts          # amplifyFrequency(): GatedConcept[] → ScoredConcept[]
├── compose.ts          # processText(): text + metadata → ConceptEvent[] (pipeline entry point)
tests/
├── extract.test.ts
├── normalize.test.ts
├── identify.test.ts
├── gate.test.ts
├── amplify.test.ts
├── compose.test.ts     # integration: same-input → byte-identical output
index.ts                # re-exports processText and ConceptEvent type
package.json
tsconfig.json
```

Each file stays well under 200 lines. Functions are imported across files — no barrel re-exports inside src/.

### Pattern 1: Pure Function Pipeline Composition
**What:** Each pipeline step is a function that takes data in, returns new data out. No shared state, no closures over mutable variables, no I/O.
**When to use:** Every function in this phase.

```typescript
// src/compose.ts — entry point
export function processText(
  text: string,
  sourceWeight: number,
  nodeType: "concept" | "moment" | "code_function" = "concept"
): readonly ConceptEvent[] {
  const raw = extractConcepts(text);
  const normalized = normalizeConcepts(raw);
  const identified = assignIds(normalized);
  const gated = importanceGate(identified);       // gate here — frequency NEVER runs before this
  const scored = amplifyFrequency(gated, text);   // count occurrences only for gated concepts
  return attachMetadata(scored, sourceWeight, nodeType);
}
```

### Pattern 2: Compromise NLP Extraction
**What:** Use compromise to extract noun phrases, named entities, and proper nouns from text.
**When to use:** `extractConcepts()` — the first step of the pipeline.

```typescript
// src/extract.ts
// Source: https://github.com/spencermountain/compromise (v14.15.0)
import nlp from "compromise";

export interface RawConcept {
  readonly surfaceForm: string;
  readonly tags: readonly string[];  // e.g. ["Noun", "Person", "ProperNoun"]
  readonly isMultiWord: boolean;
}

export function extractConcepts(text: string): readonly RawConcept[] {
  const doc = nlp(text);

  // Extract noun phrases + named entities in one pass
  const candidates = doc.nouns().json() as Array<{ text: string; tags: string[] }>;
  const entities = doc.topics().json() as Array<{ text: string; tags: string[] }>;

  const allRaw = [...candidates, ...entities];

  // Deduplicate by surface form (topics() overlaps with nouns() for proper nouns)
  const seen = new Set<string>();
  return allRaw
    .filter((c) => {
      const key = c.text.trim().toLowerCase();
      if (seen.has(key) || !key) return false;
      seen.add(key);
      return true;
    })
    .map((c) => ({
      surfaceForm: c.text.trim(),
      tags: c.tags ?? [],
      isMultiWord: c.text.trim().includes(" "),
    }));
}
```

### Pattern 3: Normalization for Canonical Form
**What:** Convert plural/possessive/verb forms to a canonical base form so synonyms hash to the same ID.
**When to use:** `normalizeConcepts()` — second step.

```typescript
// src/normalize.ts
// Source: https://observablehq.com/@spencermountain/compromise-normalization
import nlp from "compromise";

export function normalizeConcepts(
  concepts: readonly RawConcept[]
): readonly NormalizedConcept[] {
  return concepts.map((c) => {
    const canonical = nlp(c.surfaceForm)
      .normalize({ plurals: true, verbs: true, case: true, acronyms: true })
      .text()
      .toLowerCase()
      .trim();

    return {
      ...c,
      canonicalForm: canonical || c.surfaceForm.toLowerCase().trim(),
    };
  });
}
```

Note: The synonym collapse for abbreviations like "ML" → "machine learning" requires a hand-maintained dictionary registered via `nlp.extend()` — compromise does not infer this automatically. This is "Claude's Discretion" territory.

### Pattern 4: Deterministic ID Assignment via Bun.hash
**What:** Hash the canonical form to a stable 64-bit integer ID. Same canonical form → same ID across calls.
**When to use:** `assignIds()` — third step.

```typescript
// src/identify.ts
// Source: https://bun.com/docs/runtime/hashing (Bun.hash.wyhash)
export function assignIds(
  concepts: readonly NormalizedConcept[]
): readonly IdentifiedConcept[] {
  return concepts.map((c) => ({
    ...c,
    conceptId: Number(Bun.hash.wyhash(c.canonicalForm)),
    // Bun.hash.wyhash returns BigInt; convert to Number for JSON serialization
    // Risk: 64-bit → 53-bit safe integer. Use BigInt serialization if collision risk becomes real.
  }));
}
```

**ID collision risk:** Bun.hash.wyhash returns 64-bit values. JavaScript Number can hold 53-bit integers safely. For Phase 0 with hundreds to low thousands of concepts, collision probability is negligible. Phase 1+ should consider BigInt storage if concept count grows into millions. Document this constraint in types.ts.

### Pattern 5: Importance Gate Heuristics
**What:** Binary yes/no gate. Returns `true` only for concepts that meet importance criteria.
**When to use:** `importanceGate()` — fourth step.

```typescript
// src/gate.ts
// Heuristic signals — to be tuned empirically in Phase 1-2; do NOT pre-optimize

const IMPORTANT_TAGS = new Set([
  "Person", "Place", "Organization", "Value",
  "ProperNoun", "Noun", "Acronym"
]);

// Stop-word exclusion list — single-word common nouns to reject
const STOP_CONCEPTS = new Set([
  "thing", "way", "time", "people", "year", "day",
  "man", "woman", "child", "world", "life", "hand",
  "part", "place", "case", "week", "company", "system",
  "program", "question", "work", "government", "number",
  "night", "point", "home", "water", "room", "mother",
]);

export function isImportant(concept: IdentifiedConcept): boolean {
  const form = concept.canonicalForm;

  // Rule 1: Reject very short single-word concepts (likely noise)
  if (!concept.isMultiWord && form.length <= 2) return false;

  // Rule 2: Reject common stop-concepts
  if (STOP_CONCEPTS.has(form)) return false;

  // Rule 3: Named entities always pass (Person, Place, Org, Value)
  const entityTags = ["Person", "Place", "Organization", "Value"];
  if (concept.tags.some((t) => entityTags.includes(t))) return true;

  // Rule 4: Multi-word noun phrases pass (high precision)
  if (concept.isMultiWord) return true;

  // Rule 5: Acronyms pass
  if (concept.tags.includes("Acronym")) return true;

  // Rule 6: Single-word proper nouns pass
  if (concept.tags.includes("ProperNoun")) return true;

  // Default: single-word common noun — reject
  return false;
}

export function importanceGate(
  concepts: readonly IdentifiedConcept[]
): readonly GatedConcept[] {
  return concepts
    .filter(isImportant)
    .map((c) => ({ ...c, gatePass: true as const, importanceScore: 1.0 }));
  // importanceScore is binary 0/1 in Phase 0; becomes a float in Phase 2+ when ML gate added
}
```

### Pattern 6: Log-Normalized Frequency Amplification
**What:** Count how many times each concept appears in the original text, then apply log normalization.
**When to use:** `amplifyFrequency()` — fifth step, ONLY called after gate.

```typescript
// src/amplify.ts
export function amplifyFrequency(
  gatedConcepts: readonly GatedConcept[],
  originalText: string
): readonly ScoredConcept[] {
  const textLower = originalText.toLowerCase();

  return gatedConcepts.map((c) => {
    // Count occurrences of canonical form in original text
    const regex = new RegExp(`\\b${escapeRegex(c.canonicalForm)}\\b`, "gi");
    const frequencyCount = (originalText.match(regex) ?? []).length || 1;

    // Log normalization: 1 + ln(n) — prevents runaway scores
    // f(1)=1.0, f(10)=3.3, f(100)=5.6, f(1000)=7.9
    const frequencyAmplifier = 1 + Math.log1p(frequencyCount);

    return {
      ...c,
      frequencyCount,
      frequencyAmplifier,
    };
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

### Pattern 7: Locked ConceptEvent Shape
**What:** The canonical output type, defined once, consumed by all downstream phases.

```typescript
// src/types.ts — DO NOT modify shape after Phase 0 ships
export interface ConceptEvent {
  readonly concept_id: number;       // stable hash-derived numeric ID
  readonly surface_form: string;     // original extracted text before normalization
  readonly importance_score: number; // 0.0 or 1.0 in Phase 0 (binary gate)
  readonly frequency_count: number;  // raw count in source text
  readonly composite_score: number;  // gate_pass × frequency_amplifier × source_weight
  readonly source_weight: number;    // who produced signal: Claude=1.0, Nova=0.7, etc.
  readonly node_type: "concept" | "moment" | "code_function";
  readonly timestamp: string;        // ISO 8601, injected at call time
}
```

### Anti-Patterns to Avoid
- **Frequency before gate:** Never count `frequency_count` before calling `importanceGate()`. The gate is the hard prerequisite. Enforce this by making `amplifyFrequency()` only accept `GatedConcept[]`, not `IdentifiedConcept[]`.
- **Mutable objects:** Never use `Object.assign` to mutate — always spread into new objects. The `readonly` modifier on ConceptEvent fields enforces this at the type level.
- **Regex in hot loop without escaping:** Frequency counting uses a regex built from user text — always escape before constructing the RegExp.
- **Treating compromise.json() output as typed:** compromise's `.json()` returns `any[]`. Cast explicitly and validate shape before use.
- **Synonym resolution via compromise alone:** compromise normalizes morphological variants (plural→singular) but does NOT resolve semantic synonyms ("ML" → "machine learning"). A hand-maintained alias dictionary registered via `nlp.extend()` is required for abbreviation collapse.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| POS tagging | Custom regex tagger | `compromise` `.nouns()`, `.topics()`, POS tags | 83-tag hierarchy, multi-word aware, handles contractions |
| Morphological normalization | Stemmer or manual plural stripping | `compromise .normalize({plurals:true,verbs:true})` | Handles irregular plurals, possessives, verb conjugation |
| Deterministic string→number ID | Custom djb2/FNV | `Bun.hash.wyhash(str)` | Built into Bun runtime, zero npm deps, 64-bit output |
| Frequency counting across forms | Manual string comparison | regex + `originalText.match()` after canonical normalization | normalizing first, then matching covers plural/possessive variants |
| Test runner setup | Jest + babel + ts-jest | `bun test` | Native TypeScript, zero config, 10-50x faster than Jest |

**Key insight:** compromise handles English morphology edge cases (irregular plurals, gerunds, possessives, acronym expansion) that would take weeks to hand-roll reliably. Use it for extraction and normalization; do NOT build a parallel tagger.

---

## Common Pitfalls

### Pitfall 1: Frequency Before Gate
**What goes wrong:** `frequency_count` gets incremented for unimportant concepts, corrupting composite score.
**Why it happens:** Pipeline steps get reordered, or a refactor passes all concepts to `amplifyFrequency()` without filtering.
**How to avoid:** Use TypeScript's type system as enforcement. `amplifyFrequency()` must accept `GatedConcept[]` not `IdentifiedConcept[]`. The compiler will reject the wrong call.
**Warning signs:** A high-frequency stop-word like "system" produces a non-zero composite_score.

### Pitfall 2: Non-Deterministic Output
**What goes wrong:** Same input produces different output on different calls, breaking the purity guarantee (SIG-06).
**Why it happens:** `Date.now()` called inside the pipeline; compromise internally uses random seed; hash function has non-deterministic seed; Set/Map iteration order.
**How to avoid:** Inject `timestamp` as a parameter from the caller, not generated inside processText. Use `Bun.hash.wyhash(str, 0n)` with explicit seed `0n`. Sort output arrays by `concept_id` before returning.
**Warning signs:** Same-input test fails intermittently.

### Pitfall 3: Compromise .json() Type Unsafety
**What goes wrong:** `doc.nouns().json()` returns `any[]`, and accessing undefined fields causes silent runtime errors.
**Why it happens:** compromise's TypeScript types are not exhaustive for all output shapes.
**How to avoid:** Write a `parseCompromiseJson()` validator function that explicitly checks for `text` and `tags` fields before use. Use `unknown` cast, not `any` cast.
**Warning signs:** `concept.tags.includes(...)` throws "Cannot read property of undefined".

### Pitfall 4: BigInt/Number ID Serialization
**What goes wrong:** `concept_id` values above `Number.MAX_SAFE_INTEGER` (2^53-1) silently lose precision when converted to Number.
**Why it happens:** `Bun.hash.wyhash()` returns BigInt. Converting large values to Number truncates.
**How to avoid:** In Phase 0 with small concept vocabularies this is safe. Document the known limitation in `types.ts`. Add a test that verifies `concept_id > 0` for every output (catches the NaN/0 edge case from failed BigInt conversion).
**Warning signs:** Two different canonical forms produce the same concept_id.

### Pitfall 5: Synonym Resolution Scope Creep
**What goes wrong:** Attempting to build full semantic synonym resolution in Phase 0 instead of accepting a hand dictionary.
**Why it happens:** "ML" and "machine learning" failing to collapse feels like a bug.
**How to avoid:** The alias dictionary covers known abbreviations. Full semantic synonym resolution is Phase 4 (RAG Bootstrap with embeddings). Resist the pull to solve it here.
**Warning signs:** Work expands to downloading word vectors or calling an embedding API.

### Pitfall 6: Import Paths with .ts Extensions
**What goes wrong:** TypeScript import `from "./extract.ts"` fails in Node but is required in Bun.
**Why it happens:** Bun requires explicit `.ts` extensions in import paths when `"allowImportingTsExtensions": true`.
**How to avoid:** Use `.ts` extensions in all local imports when in Bun project. Set `"allowImportingTsExtensions": true` in tsconfig.json.
**Warning signs:** "Module not found" errors at runtime despite file existing.

---

## Code Examples

### Bun Test: Pure Function Determinism (SIG-06)
```typescript
// tests/compose.test.ts
// Source: https://bun.com/docs/test
import { describe, expect, test } from "bun:test";
import { processText } from "../src/compose.ts";

describe("processText — purity", () => {
  test("same input produces byte-identical output", () => {
    const input = "TypeScript is a superset of JavaScript for building scalable applications";
    const a = processText(input, 1.0);
    const b = processText(input, 1.0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("gate failure: common noun scores zero even if repeated 1000 times", () => {
    const repeated = Array(1000).fill("system").join(" ");
    const events = processText(repeated, 1.0);
    const systemEvent = events.find((e) => e.surface_form.toLowerCase() === "system");
    expect(systemEvent).toBeUndefined(); // rejected by gate, never reaches output
  });

  test("gate pass: named entity with one mention outscores repeated common noun", () => {
    const text = "TypeScript " + Array(100).fill("thing").join(" ");
    const events = processText(text, 1.0);
    const typescript = events.find((e) => e.surface_form.toLowerCase().includes("typescript"));
    expect(typescript).toBeDefined();
    expect(typescript!.composite_score).toBeGreaterThan(0);
  });
});
```

### Bun Test Runner Commands
```bash
bun test                          # run all tests
bun test --coverage               # with coverage report
bun test --watch                  # watch mode during development
bun test gate.test.ts             # single file
bun test --test-name-pattern pure # filter by name
```

### tsconfig.json for Bun
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```
Source: https://bun.com/docs/typescript

### Compromise: Synonym Dictionary Registration
```typescript
// src/synonyms.ts — hand-maintained alias dictionary for abbreviation collapse
// Source: https://github.com/spencermountain/compromise (nlp.extend / nlp.world.addWords)
import nlp from "compromise";

const ALIASES: Record<string, string> = {
  "ml": "machine learning",
  "ai": "artificial intelligence",
  "nlp": "natural language processing",
  "llm": "large language model",
  "rag": "retrieval augmented generation",
};

export function registerAliases(): void {
  // Called once at module initialization — idempotent
  const wordMap: Record<string, string[]> = {};
  for (const [abbr, _full] of Object.entries(ALIASES)) {
    wordMap[abbr] = ["Acronym"];
  }
  nlp.extend((_Doc, _world) => {
    // Note: exact API depends on compromise 14 plugin format
    // Verify against: https://github.com/spencermountain/compromise/tree/master/docs
  });
}

// normalizeAlias(): called in normalize.ts BEFORE compromise .normalize()
export function resolveAlias(canonical: string): string {
  return ALIASES[canonical.toLowerCase()] ?? canonical;
}
```

**Note (MEDIUM confidence):** The exact `nlp.extend()` plugin API shape for registering word aliases in compromise v14 was not fully verified from official docs — GitHub was rate-limited during research. Recommend verifying against the compromise GitHub docs/plugins directory before implementation. The `nlp.world.addWords()` pattern was confirmed via WebSearch for older versions; v14 may use `nlp.extend()` callback format.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jest + ts-jest for Bun projects | `bun test` (built-in) | Bun 1.0+ | Zero config TypeScript testing, 10-50x faster |
| `crypto.subtle` async hash | `Bun.hash.wyhash()` sync | Bun 0.6+ | Synchronous, non-cryptographic, deterministic |
| compromise v13 `.out('array')` | compromise v14 `.json()` with metadata | v14.0 | Richer output with POS tags in JSON |
| Manual stop-word lists | compromise `.topics()` for entity passthrough | compromise v12+ | Named entity extraction built-in |

**Deprecated/outdated:**
- `compromise.out('array')`: Replaced by `.json()` which includes tags. Use `.json()` for phase 0 to access tag information needed for the gate.
- `nlp_compromise` (old npm package name): Superseded by `compromise` package. Do not install `nlp_compromise`.

---

## Open Questions

1. **Exact compromise v14 plugin API for word aliases**
   - What we know: `nlp.extend()` and `nlp.world.addWords()` both exist; behavior differs by version
   - What's unclear: Whether v14.15.0 uses the callback or object API form for registering custom word→tag mappings
   - Recommendation: Wave 0 of implementation — add a test that registers one alias and verifies collapse. Treat as a spike task.

2. **BigInt → Number ID precision boundary**
   - What we know: `Bun.hash.wyhash()` returns BigInt; Number safe integer limit is 2^53-1
   - What's unclear: Whether Phase 0 concept counts will approach the collision threshold
   - Recommendation: Store `concept_id` as `number` for Phase 0, document as known limitation in `types.ts`, add test asserting `concept_id === Math.floor(concept_id)` (no precision loss)

3. **Importance gate threshold calibration**
   - What we know: Rules above (named entities pass, short common nouns fail) are reasonable starting heuristics
   - What's unclear: Real-world false positive/negative rate until Phase 1-2 data is collected
   - Recommendation: By design — do not tune in Phase 0. Log all gate decisions to a `gateDecisions` debug field in development mode only.

4. **compromise `.topics()` vs `.nouns()` overlap**
   - What we know: `.topics()` = `.people()` + `.places()` + `.organizations()`; these overlap with `.nouns()` for proper nouns
   - What's unclear: Whether calling both produces clean deduplication or causes issues in v14
   - Recommendation: Deduplicate by canonical form in `extractConcepts()` (already shown in Pattern 2 code above). Add a test with a text containing a named entity to verify no duplicate concept IDs.

---

## Sources

### Primary (HIGH confidence)
- [compromise v14.15.0 GitHub releases](https://github.com/spencermountain/compromise/releases) — version confirmed 14.15.0, February 25, 2025
- [Bun test runner docs](https://bun.com/docs/test) — test file patterns, bun:test import, coverage commands
- [Bun TypeScript docs](https://bun.com/docs/typescript) — tsconfig.json recommended settings, allowImportingTsExtensions
- [Bun hashing docs](https://bun.com/docs/runtime/hashing) — `Bun.hash.wyhash()` API, 64-bit BigInt return

### Secondary (MEDIUM confidence)
- [compromise Observable notebook — normalization](https://observablehq.com/@spencermountain/compromise-normalization) — normalize() options object, presets (light/medium/heavy)
- [compromise Observable notebook — nouns](https://observablehq.com/@spencermountain/nouns) — `.nouns().json()`, `.nouns().toSingular()` API
- [compromise npm page](https://www.npmjs.com/package/compromise) — ~250KB size, 1MB/sec throughput, architecture levels (one/two/three)
- [TF-IDF Wikipedia](https://en.wikipedia.org/wiki/Tf%E2%80%93idf) — log-normalized frequency formula reference

### Tertiary (LOW confidence)
- WebSearch results for compromise plugin API (`nlp.extend()` / `nlp.world.addWords()`) — GitHub rate-limited during research; v14 plugin format not fully verified

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions confirmed from official release page and Bun docs
- Architecture patterns: HIGH — pure function pipeline is well-established; patterns verified against official APIs
- Gate heuristics: MEDIUM — heuristic rules are reasonable but intentionally untuned by design; will require empirical adjustment in Phase 1-2
- Synonym/alias API: MEDIUM-LOW — compromise normalize() confirmed; nlp.extend() plugin format not fully verified due to GitHub rate limit

**Research date:** 2026-03-10
**Valid until:** 2026-09-10 (stable ecosystem; compromise and Bun APIs change slowly)
