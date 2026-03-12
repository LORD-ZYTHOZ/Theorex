---
phase: 00-significance-engine
verified: 2026-03-10T00:00:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 0: Significance Engine Verification Report

**Phase Goal:** Users can pass any text through a pure function pipeline that extracts concepts, applies an importance gate, amplifies frequency for gated concepts, and returns a scored concept event with source weight — with zero side effects
**Verified:** 2026-03-10
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Text input produces extracted noun phrases and named entities via NLP (SIG-01) | VERIFIED | `src/extract.ts` calls `nlp().nouns().json()` + `nlp().topics().json()`; 145 tests pass including extraction cases |
| 2 | Importance gate is a hard binary prerequisite — failed concepts never reach frequency counting (SIG-02) | VERIFIED | `amplifyFrequency()` accepts `GatedConcept[]` not `IdentifiedConcept[]`; TypeScript type system enforces ordering; stop-concept rejection tests pass |
| 3 | Synonyms collapse to one canonical ID — "ml" and "machine learning" produce identical conceptId (SIG-03) | VERIFIED | `resolveAlias()` in `src/synonyms.ts`; `assignIds()` calls `resolveAlias()` before hashing; identify tests confirm alias collapse |
| 4 | Frequency score is only amplified for concepts that passed the gate (SIG-04) | VERIFIED | `amplifyFrequency(gated, text)` receives only `GatedConcept[]` output; compiler rejects `IdentifiedConcept[]` at call site |
| 5 | Every ConceptEvent carries a source_weight field injected by the caller (SIG-05) | VERIFIED | `source_weight: input.sourceWeight` in `attachMetadata()`; tests confirm all output events carry exact caller-supplied weight |
| 6 | All significance functions are pure — same input produces identical output with zero side effects (SIG-06) | VERIFIED | `processText()` is a pure pipeline composition; byte-identical output test passes over 5 repeated calls; no filesystem/network/DB access in any source module |

**Score:** 6/6 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/spike/alias-api.test.ts` | Proof of compromise v14 alias registration API | VERIFIED | Exists; SPIKE RESULT comment at top documents Strategies B+C as working; tests pass |
| `src/types.ts` | Shared data model — all 8 exported types | VERIFIED | 83 lines; exports ConceptEvent, RawConcept, NormalizedConcept, IdentifiedConcept, GatedConcept, ScoredConcept, PipelineInput, NodeType; all fields readonly; ID precision note present |
| `src/extract.ts` | `extractConcepts(): text → readonly RawConcept[]` | VERIFIED | 90 lines; exports `extractConcepts`; uses `parseCompromiseJson()` validator; deduplicates by lowercased surface form |
| `src/normalize.ts` | `normalizeConcepts(): readonly RawConcept[] → readonly NormalizedConcept[]` | VERIFIED | 35 lines; exports `normalizeConcepts`; spreads into new objects (immutable); fallback to lowercase surfaceForm on empty result |
| `src/synonyms.ts` | ALIASES dictionary, `resolveAlias()`, `registerAliases()` | VERIFIED | 54 lines; exports all three; uses Strategy C from spike; module-level `registerAliases()` call |
| `src/identify.ts` | `assignIds(): readonly NormalizedConcept[] → readonly IdentifiedConcept[]` | VERIFIED | 26 lines; uses `Bun.hash.wyhash(resolved, 0n)` with explicit seed 0n; BigInt masked to safe integer range |
| `src/gate.ts` | `isImportant()`, `importanceGate()`, IMPORTANT_TAGS, STOP_CONCEPTS | VERIFIED | 97 lines; exports all four; 6 rules in strict order; 30+ stop concepts including all required ones |
| `src/amplify.ts` | `amplifyFrequency()` | VERIFIED | 30 lines; accepts `GatedConcept[]` (not IdentifiedConcept[]); regex-escaped frequency counting; floor of 1 for unmatched |
| `src/compose.ts` | `processText()` pipeline entry point | VERIFIED | 67 lines; wires all 5 functions in correct order; `attachMetadata()` builds ConceptEvent with formula `importanceScore × frequencyAmplifier × sourceWeight`; sorted by concept_id ascending |
| `index.ts` | Public API re-exports | VERIFIED | 5 lines; re-exports `processText` from compose.ts and `ConceptEvent`, `NodeType` types from types.ts |
| `tests/extract.test.ts` | TDD tests for extraction | VERIFIED | Exists; covers extraction cases, deduplication, purity |
| `tests/normalize.test.ts` | TDD tests for normalization | VERIFIED | Exists; covers plural/singular collapse, gerund→base, lowercase, fallback |
| `tests/synonyms.test.ts` | TDD tests for alias resolution | VERIFIED | Exists; covers all 5 known aliases + unknown passthrough + case-insensitive lookup |
| `tests/identify.test.ts` | TDD tests for ID assignment | VERIFIED | Exists; covers determinism, alias collapse to same ID, safe integer check |
| `tests/gate.test.ts` | TDD tests for gate — all 6 rules | VERIFIED | Exists; covers all 6 rules individually; STOP_CONCEPTS membership tests for all 30 required words |
| `tests/amplify.test.ts` | TDD tests for frequency amplification | VERIFIED | Exists; covers f(1)=1.0, f(10)≈3.302, f(1000)≈7.908; regex escape; floor behavior; immutability |
| `tests/compose.test.ts` | Integration tests — purity, gate ordering, source weight, composite score | VERIFIED | Exists; byte-identical output test (5 calls); gate ordering test with stop-concepts; source_weight visibility across all events; composite_score formula verification |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/spike/alias-api.test.ts` | `src/synonyms.ts` | `nlp.extend()` pattern documented in spike | WIRED | SPIKE RESULT comment in alias-api.test.ts; synonyms.ts comment explicitly references Strategy C from Plan 01 spike |
| `src/types.ts` | All pipeline modules | TypeScript imports | WIRED | All 6 pipeline modules import their types from `./types.ts`; confirmed via grep |
| `src/extract.ts` | `compromise` | `nlp().nouns().json()` + `nlp().topics().json()` | WIRED | Lines 65-66 in extract.ts |
| `src/identify.ts` | `src/synonyms.ts` | `resolveAlias()` on canonicalForm before hashing | WIRED | Line 22 in identify.ts: `const resolved = resolveAlias(concept.canonicalForm)` |
| `src/identify.ts` | `Bun.hash.wyhash` | `Number(Bun.hash.wyhash(resolved, 0n) & MAX_SAFE_BIGINT)` | WIRED | Line 23 in identify.ts |
| `src/gate.ts` | `src/amplify.ts` | `GatedConcept` type — amplify only accepts output of gate | WIRED | `amplify.ts` imports `GatedConcept` not `IdentifiedConcept`; TypeScript enforces ordering |
| `src/amplify.ts` | `originalText (string parameter)` | `originalText.match(new RegExp(...))` | WIRED | Line 24 in amplify.ts |
| `src/compose.ts` | `extract → normalize → assignIds → importanceGate → amplifyFrequency` | Sequential pure function composition | WIRED | Lines 60-64 in compose.ts; gate at step 4, amplify at step 5 |
| `src/compose.ts` | `ConceptEvent` via `attachMetadata()` | `composite_score: importanceScore × frequencyAmplifier × sourceWeight` | WIRED | Lines 22-32 in compose.ts |
| `index.ts` | `src/compose.ts` + `src/types.ts` | Re-export of processText and ConceptEvent | WIRED | Lines 4-5 in index.ts |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| SIG-01 | 00-03-PLAN | System extracts concept candidates from any text input using NLP (noun phrases, named entities, domain terms) | SATISFIED | `extractConcepts()` in extract.ts calls `nlp().nouns()` and `nlp().topics()`; extract.test.ts covers noun phrases, named entities, proper nouns |
| SIG-02 | 00-05-PLAN | System applies importance gate — binary yes/no — before frequency is counted | SATISFIED | `importanceGate()` produces `GatedConcept[]`; `amplifyFrequency()` only accepts `GatedConcept[]`; TypeScript compiler enforces this ordering at compile time |
| SIG-03 | 00-01-PLAN, 00-04-PLAN | System assigns numeric IDs to concepts — synonyms collapse to one canonical ID | SATISFIED | `resolveAlias()` + `Bun.hash.wyhash` with seed 0n; "ml" and "machine learning" produce same conceptId confirmed by test |
| SIG-04 | 00-05-PLAN | System amplifies frequency score only for concepts that pass the importance gate | SATISFIED | `amplifyFrequency(gated: readonly GatedConcept[], ...)` — parameter type enforces gate-first; STOP_CONCEPT × 1000 test produces zero output |
| SIG-05 | 00-02-PLAN, 00-06-PLAN | System records source weight field on every signal | SATISFIED | `source_weight: input.sourceWeight` in `attachMetadata()`; compose.test.ts verifies all output events carry exact caller-supplied weight |
| SIG-06 | 00-02-PLAN, 00-06-PLAN | All significance functions are pure (input → output, no side effects, no mutation) | SATISFIED | All functions return new arrays/objects; no filesystem/network calls; byte-identical output test passes over 5 sequential calls; 100% line coverage confirms no dead branches |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/amplify.ts` | 9, 27 | Doc comment says `Math.log1p` but implementation uses `Math.log` | Info | No functional impact — tests and implementation agree on `Math.log`; the plan's stated formula name (`log1p`) was incorrect but numerical intent (f(1)=1.0) was correct. Tests were written to match the implementation. |

No blockers. No warnings. One informational note on formula naming mismatch between plan documentation and implementation (both implementation and tests are internally consistent).

---

## Human Verification Required

None. All phase success criteria are verifiable programmatically and confirmed by the test suite.

---

## Gaps Summary

No gaps. Phase 0 goal is fully achieved.

All six requirements (SIG-01 through SIG-06) are satisfied. The significance pipeline is a complete, pure function composition that:

1. Extracts concept candidates from any English text via compromise NLP
2. Normalizes and deduplicates surface forms
3. Collapses known abbreviation synonyms before hashing
4. Assigns stable numeric IDs via Bun.hash.wyhash with explicit seed
5. Applies a binary importance gate (6 rules, strict ordering) before any frequency counting
6. Amplifies frequency with log-normalization only for gated concepts
7. Attaches caller-injected source_weight and timestamp to every ConceptEvent
8. Returns a deterministically sorted (by concept_id), immutable ConceptEvent array

Test suite: 145 tests pass, 0 fail. Coverage: 100% functions and lines across all 7 production source files. TypeScript strict-mode errors exist only in test files (due to `noUncheckedIndexedAccess` on array indexing), not in production source.

---

_Verified: 2026-03-10_
_Verifier: Claude (gsd-verifier)_
