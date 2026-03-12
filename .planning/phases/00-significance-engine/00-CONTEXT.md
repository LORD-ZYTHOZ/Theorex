# Phase 0: Significance Engine - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning
**Source:** cortex.md (Theorex design memory) + STATE.md decisions

<domain>
## Phase Boundary

Phase 0 delivers a pure function pipeline that:
- Extracts concepts from any text input and assigns each a stable numeric ID
- Gates each concept through an importance classifier (yes/no) before any frequency counting
- Amplifies significance for gate-passing concepts based on frequency
- Returns a scored concept event with source_weight — stateless, no filesystem writes, no running processes

Everything downstream (Long-Term Lobe, Short-Term, Flash, RAG) inherits this data model. The shared data model — including source_weight and node_type fields — must be fully defined here even though those fields are consumed in later phases.

</domain>

<decisions>
## Implementation Decisions

### Runtime
- Bun (fast, lightweight, event-driven) — not Node.js
- TypeScript throughout

### Concept Extraction
- compromise NLP for concept extraction and synonym normalization
- Every unique concept maps to a stable numeric ID — the word is just a label
- Synonyms collapse to one node ID (e.g. "ML" and "machine learning" → same ID)
- Multiple surface forms, one score

### Importance Gate — CRITICAL ORDERING
- Gate is a HARD prerequisite step, not a weighted factor
- Two questions, strictly in order:
  1. Is this important? → yes/no gate
  2. How often? → amplifier ONLY if gate passes, ignored if gate fails
- Frequency counting MUST NEVER run before gate PASS — this is non-negotiable
- Start with hand-coded heuristics for the gate (no ML model yet)
- Do NOT pre-optimize the threshold — collect data in Phases 1-2 first

### Source Weight
- Every scored concept event carries a source_weight field
- Identifies which agent or human produced the signal
- Field defined in Phase 0 data model, consumed in Phases 1+
- Claude = 1.0 (baseline), other agents vary

### Frequency Amplification
- Composite score = gate_pass × frequency_amplifier × source_weight
- Frequency amplifier is log-normalized (prevents runaway scores)
- A concept repeated 1000 times that fails the gate scores LOWER than one mention that passes

### Shared Data Model (locked here for all phases)
- ConceptEvent: { concept_id, surface_form, importance_score, frequency_count, composite_score, source_weight, node_type, timestamp }
- node_type: "concept" (Phase 0), "moment" (Phase 5), "code_function" (Phase 7)
- All fields defined now even if only "concept" type used in Phase 0

### Purity Constraints
- The pipeline is stateless by construction
- Same text input → byte-identical output (deterministic)
- No filesystem writes, no database calls, no network I/O
- No side effects — pure transformation functions only
- Enables safe concurrency and trivial testing

### Claude's Discretion
- Exact synonym resolution strategy (dictionary lookup vs. NLP-based)
- Specific heuristic rules for the importance gate (to be determined empirically)
- Internal data structures (maps, arrays, objects)
- File/module organization within Bun project
- Test framework choice (Bun built-in test runner preferred)

</decisions>

<specifics>
## Specific Ideas

### Concept Web Data Model Preview
```
[Theorex:001] ←── 0.92 ──→ [significance:003]
      │                            │
    0.87                         0.78
      │                            │
[flash:002]  ←── 0.71 ──→ [frequency:004]
```
Nodes = concepts with importance weight + sentiment.
Edges = co-occurrence relationships with strength weight.
Phase 0 doesn't build the web — it produces the ConceptEvents that feed it.

### Expected Pipeline Shape
```
text → extract_concepts() → [surface_forms]
     → assign_ids()       → [concept_ids]
     → gate()             → [gated_concepts]  // hard stop here if fails
     → amplify()          → [amplified_scores]
     → attach_metadata()  → ConceptEvent[]
```

### Stack
- Runtime: Bun 1.3.7+
- NLP: compromise (concept extraction + synonym normalization)
- No external API calls in Phase 0
- No embeddings in Phase 0 (that's Phase 4 RAG Bootstrap)

</specifics>

<deferred>
## Deferred Ideas

- Embedding-based synonym resolution → Phase 4 (RAG Bootstrap)
- Sentiment classification (PREFERRED/NEUTRAL/DISPREFERRED) → Phase 1
- Relevance tiers (ACTIVE/MILD/LESS) → Phase 1
- Frequency history storage → Phase 1 (Long-Term Lobe)
- ML-tuned importance gate threshold → after Phases 1-2 collect data
- Cross-pollination (one-hop activation propagation) → Phase 1
- Moment nodes → Phase 5

</deferred>

---

*Phase: 00-significance-engine*
*Context gathered: 2026-03-10 from Theorex design memory (cortex.md)*
