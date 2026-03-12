// Shared data model for all Theorex phases.
// This file defines ONLY types — no runtime logic, no imports.
// All pipeline modules import their input/output types from here.

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Entry point shape passed to processText() by the caller. */
export interface PipelineInput {
  readonly text: string;
  readonly sourceWeight: number; // Claude=1.0, Nova=0.7, Qwen3=0.8, human=1.0
  readonly nodeType: NodeType;   // defaults to "concept" at call site
  readonly timestamp: string;    // ISO 8601 — injected by caller, not pipeline
}

// ---------------------------------------------------------------------------
// Node type union (used across all phases)
// ---------------------------------------------------------------------------

/** Discriminates between graph node categories produced by different phases. */
export type NodeType = "concept" | "moment" | "code_function";
// "moment"        — used by Phase 5 Moment Nodes
// "code_function" — used by Phase 7 Code Reading

// ---------------------------------------------------------------------------
// Pipeline intermediate types (ordered by stage)
// ---------------------------------------------------------------------------

/** Output of extractConcepts(): raw extracted term before any normalization. */
export interface RawConcept {
  readonly surfaceForm: string;      // original extracted text, pre-normalization
  readonly tags: readonly string[];  // compromise POS tags e.g. ["Noun", "Person"]
  readonly isMultiWord: boolean;     // true if surface form contains a space
}

/** Output of normalizeConcepts(): RawConcept with canonical form attached. */
export interface NormalizedConcept extends RawConcept {
  readonly canonicalForm: string;    // lowercased, morphologically normalized
}

// ID precision note: Bun.hash.wyhash() returns BigInt (64-bit).
// Converted to Number here — safe for up to ~9 quadrillion unique concepts
// (Number.MAX_SAFE_INTEGER = 2^53-1 = 9,007,199,254,740,991).
// Phase 1+ should evaluate BigInt storage if concept vocabulary exceeds ~10M nodes.

/** Output of assignIds(): NormalizedConcept with a stable numeric hash ID. */
export interface IdentifiedConcept extends NormalizedConcept {
  readonly conceptId: number;        // stable hash of canonicalForm
}

/** Output of importanceGate(): only concepts that PASS the gate appear here. */
export interface GatedConcept extends IdentifiedConcept {
  readonly gatePass: true;           // always true — failed concepts never reach this type
  readonly importanceScore: number;  // 0.0–1.0; binary 1.0 in Phase 0; float in Phase 2+
}

/** Output of amplifyFrequency(): GatedConcept with frequency-based amplification. */
export interface ScoredConcept extends GatedConcept {
  readonly frequencyCount: number;   // raw occurrences in source text
  readonly frequencyAmplifier: number; // 1 + Math.log1p(frequencyCount)
}

// ---------------------------------------------------------------------------
// Final output — consumed by ALL downstream phases (Phases 1–7)
// ---------------------------------------------------------------------------

// DO NOT modify this shape after Phase 0 ships.
// All phases (1–7) consume ConceptEvent exactly as defined here.
// Adding fields requires a coordinated migration across all phases.

/** Locked final output of the significance pipeline — inherited by all phases. */
export interface ConceptEvent {
  readonly concept_id: number;        // stable hash-derived numeric ID (see ID precision note above)
  readonly surface_form: string;      // original extracted text before normalization
  readonly importance_score: number;  // 0.0 or 1.0 in Phase 0 (binary gate result)
  readonly frequency_count: number;   // raw occurrence count in source text
  readonly composite_score: number;   // gate_pass × frequencyAmplifier × source_weight
  readonly source_weight: number;     // signal producer: Claude=1.0, Nova=0.7, Qwen3=0.8
  readonly node_type: NodeType;       // "concept" in Phase 0; "moment"/"code_function" in later phases
  readonly timestamp: string;         // ISO 8601 string — injected by caller at processText() call site
}
