# Roadmap: Theorex

## Overview

Theorex is built in strict dependency order: the significance engine is the foundation everything else calls, long-term storage must exist before short-term can graduate to it, short-term must exist before flash can flush to it, and hooks are built on proven storage infrastructure. Phases 0-5 prove the single-agent system before Phase 6 introduces multi-producer coordination, Phase 7 adds code reading, and Phase 8 closes the loop with drift detection — asking whether the agent is still being who it said it was. The build order is non-negotiable — it follows the dependency graph exactly.

## Phases

**Phase Numbering:**
- Integer phases (0-7): Planned milestone work in strict dependency order
- Decimal phases: Urgent insertions via /gsd:insert-phase

- [x] **Phase 0: Significance Engine** - Pure function pipeline — concept extraction, importance gate, frequency amplification, shared data model (completed 2026-03-10)
- [x] **Phase 1: Long-Term Lobe** - Axon concept web, MEMORY.md parser with round-trip fidelity, relevance/sentiment tiers, decay, pruning (completed 2026-03-10)
- [x] **Phase 2: Short-Term Lobe** - 14-day JSONL session log, hybrid BM25 + vector search, graduation to long-term (completed 2026-03-10)
- [x] **Phase 3: Flash Lobe + Hooks** - Per-session ring buffer, async hook dispatcher, SessionStart injection, PostToolUse recording, SessionEnd flush (completed 2026-03-11)
- [x] **Phase 4: RAG Bootstrap** - ONNX compatibility spike, cold-start edge seeding, confirmation and dissolution logic (completed 2026-03-11)
- [x] **Phase 5: Moment Nodes** - Permanent AI photographs, never-pruned anchors, CLI capture command (completed 2026-03-11)
- [ ] **Phase 6: AI Family Shared Layer** - Multi-producer concept web, source normalisation, cross-domain attenuation
- [ ] **Phase 7: Code Reading** - Raw codebase ingestion, AST parsing, functions as nodes, calls as edges
- [x] **Phase 8: Drift Detection** - Deterministic behavioral consistency tracking, audit event log, drift score from moment anchors vs live concept web (completed 2026-03-11)

## Phase Details

### Phase 0: Significance Engine
**Goal**: Users can pass any text through a pure function pipeline that extracts concepts, applies an importance gate, amplifies frequency for gated concepts, and returns a scored concept event with source weight — with zero side effects
**Depends on**: Nothing (first phase)
**Requirements**: SIG-01, SIG-02, SIG-03, SIG-04, SIG-05, SIG-06
**Success Criteria** (what must be TRUE):
  1. Given the same text input twice, the significance engine returns byte-identical output both times (pure functions, no side effects)
  2. A concept repeated 1000 times that fails the importance gate scores lower than a concept mentioned once that passes the gate
  3. Two surface forms that are synonyms (e.g., "ML" and "machine learning") resolve to the same numeric concept ID
  4. Every scored concept event carries a source_weight field identifying which agent or human produced it
  5. The pipeline can be called with no running processes, no database, and no filesystem writes — it is stateless by construction
**Plans**: 6 plans

Plans:
- [x] 00-01-PLAN.md — compromise v14 alias API spike (verify nlp.extend() before synonyms.ts)
- [x] 00-02-PLAN.md — locked shared data model (ConceptEvent + all intermediate types in types.ts)
- [x] 00-03-PLAN.md — TDD: extractConcepts + normalizeConcepts (pipeline steps 1-2)
- [x] 00-04-PLAN.md — TDD: resolveAlias + assignIds (synonym collapse + deterministic ID hashing)
- [x] 00-05-PLAN.md — TDD: importanceGate + amplifyFrequency (hard gate ordering enforced by types)
- [x] 00-06-PLAN.md — TDD: processText pipeline composition + public index.ts API

### Phase 1: Long-Term Lobe
**Goal**: Users can inspect a living concept web in axon.json that classifies every known concept with a relevance tier and sentiment tier, reads and writes MEMORY.md with byte-identical round-trip fidelity, and safely prunes stale concepts to an archive
**Depends on**: Phase 0
**Requirements**: AXN-01, AXN-02, AXN-03, AXN-04, AXN-05, AXN-06, REL-01, REL-02, REL-03, REL-04, REL-05, SNT-01, SNT-02, SNT-03, SNT-04, LTM-01, LTM-02, LTM-03, LTM-04, LTM-05, CLI-01, CLI-02, CLI-03, CLI-04
**Success Criteria** (what must be TRUE):
  1. Running `theorex scan` re-scores all nodes, applies exponential decay, and updates tiers — MEMORY.md content is unchanged and byte-identical after the run
  2. Running `theorex status` displays every known concept with its ACTIVE/MILD/LESS tier and PREFERRED/NEUTRAL/DISPREFERRED sentiment in a readable table
  3. A node activated by `theorex ref <keyword>` raises its neighbors by at most 50% of the activation amount (one-hop, 0.5 dampening), and no second-hop nodes change
  4. Running `theorex prune` moves LESS nodes past the 30-day threshold to data/archive/ — the original MEMORY.md and axon.json entries are removed but data/archive/ retains the records
  5. Writing MEMORY.md to a temp file then atomically renaming succeeds under concurrent sessions — MEMORY.md is never left in a partial state
**Plans**: 6 plans

Plans:
- [ ] 01-01-PLAN.md — TDD: AxonStore — Graphology-backed typed concept web with atomic save/load
- [ ] 01-02-PLAN.md — TDD: MEMORY.md section parser + atomic writer + meta store (HARD GATE: byte-identical round-trip)
- [ ] 01-03-PLAN.md — TDD: composite scorer (exponential decay + frequency) + one-hop propagation engine
- [x] 01-04-PLAN.md — TDD: scan (re-score all nodes, decay edges) + prune (archive + drop LESS nodes)
- [ ] 01-05-PLAN.md — CLI entry point: wire scan/status/ref/prune subcommands + full integration tests
- [ ] 01-06-PLAN.md — Gap closure: REL-03 lazy-on-read tier correction in runStatus()

### Phase 2: Short-Term Lobe
**Goal**: Users can search 14 days of session history with hybrid BM25 + vector search, and entries that stay ACTIVE for 7+ consecutive days are automatically promoted to long-term
**Depends on**: Phase 1
**Requirements**: STM-01, STM-02, STM-03, STM-04, STM-05, STM-06, CLI-05, CLI-06
**Success Criteria** (what must be TRUE):
  1. Session events are written to data/short-term/YYYY-MM-DD.jsonl and `theorex search <query>` returns ranked results using BM25 keyword matching with field weighting
  2. `theorex search <query>` returns the same ranked results when the LM Studio embedder is unavailable — graceful degradation to BM25-only with no error
  3. JSONL files older than 14 days are automatically deleted — no manual cleanup needed
  4. Running `theorex graduate` promotes all short-term entries that have been ACTIVE for 7+ consecutive days to MEMORY.md in long-term
**Plans**: 5 plans

Plans:
- [ ] 02-01-PLAN.md — TDD: ShortTermEntry type + store.ts (appendEntry, rotateStm, readShortTermFiles) + Config extension
- [ ] 02-02-PLAN.md — TDD: BM25 index build + search using wink-bm25-text-search (CJS interop via createRequire)
- [ ] 02-03-PLAN.md — TDD: embedder (LM Studio /v1/embeddings + graceful degradation) + RRF + hybridSearch entry point
- [ ] 02-04-PLAN.md — TDD: graduation logic (7-consecutive-day detection + writeMemoryAtomic to MEMORY.md)
- [ ] 02-05-PLAN.md — CLI wiring: theorex search + theorex graduate + integration tests

### Phase 3: Flash Lobe + Hooks
**Goal**: Every Claude Code tool use is recorded to a per-session ring buffer, significant events are flushed to short-term on session end, and relevant context is injected at session start — all without blocking Claude Code or affecting sessions outside Theorex
**Depends on**: Phase 2
**Requirements**: FLH-01, FLH-02, FLH-03, FLH-04, FLH-05, HKS-01, HKS-02, HKS-03, HKS-04, HKS-05, HKS-06
**Success Criteria** (what must be TRUE):
  1. PostToolUse hook records each event to data/flash/{session-id}.json in under 1ms (async: true) and never blocks the Claude Code response
  2. Flash buffer never exceeds 4,000 tokens — the hard ceiling is enforced in code and verified by test, not enforced by convention
  3. On session end, events scoring >= 0.5 significance are written to short-term JSONL; the flash file is then cleared
  4. Running a Claude Code session outside the Theorex project directory triggers no hook writes and exits 0 — existing hooks outside Theorex are unmodified
  5. SessionStart hook injects ACTIVE-tier context into the conversation without error even when all three lobes are empty (cold start)
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — TDD: FlashEvent type + ring buffer store (50-event cap, 4000-token ceiling, atomic write)
- [ ] 03-02-PLAN.md — TDD: flushFlash (filter >= 0.5, write short-term, clear) + injectContext (ACTIVE-tier stdout)
- [ ] 03-03-PLAN.md — CLI flash subcommands + hook shell script + .claude/settings.json project-scoped registration

### Phase 4: RAG Bootstrap
**Goal**: New concepts that have never been seen before get weak initial edges seeded from embedding nearest-neighbours so the concept web is not empty on day one, and seeded edges strengthen or dissolve based on co-occurrence evidence
**Depends on**: Phase 1
**Requirements**: RAG-01, RAG-02, RAG-03, RAG-04
**Success Criteria** (what must be TRUE):
  1. ONNX Bun compatibility is confirmed (native or WASM fallback) before any bootstrap code is written — a passing spike test is the hard gate for Phase 4 continuation
  2. A newly added concept with no co-occurrence history receives 2-5 seeded edges with initial weight 0.1-0.2 sourced from embedding nearest-neighbours
  3. A seeded edge that has been co-occurrence-confirmed at least once increases its weight above the initial seed value
  4. A seeded edge that has never been co-occurrence-confirmed dissolves below the prune threshold within the configured session window
**Plans**: 3 plans

Plans:
- [ ] 04-01-PLAN.md — ONNX spike (RAG-04 hard gate) + scaffold all unit test files in RED
- [ ] 04-02-PLAN.md — TDD: embedder (ONNX tier) + embedding-store + KNN bootstrap seeder (RAG-01, RAG-02)
- [ ] 04-03-PLAN.md — TDD: dissolution lifecycle + wire into scanAxon + pruneAxon embedding cleanup (RAG-03)

### Phase 5: Moment Nodes
**Goal**: Users can capture permanent AI photographs — timestamped records with code references and a story — that are never pruned by decay or tier logic, and are surfaced in search and context injection
**Depends on**: Phase 1
**Requirements**: MOM-01, MOM-02, MOM-03, MOM-04, CLI-07
**Success Criteria** (what must be TRUE):
  1. `theorex moment "story text"` creates a JSON file in data/moments/ containing timestamp, story, code references, and edges to related concepts
  2. After running `theorex prune` and `theorex scan` any number of times, moment nodes remain in data/moments/ and appear in `theorex status` output — decay and prune logic never touches them
  3. `theorex search <query>` surfaces moment nodes in results when their story text matches the query
  4. SessionStart hook includes relevant moment nodes in injected context when their concepts overlap with current ACTIVE-tier concepts
**Plans**: 3 plans

Plans:
- [ ] 05-01-PLAN.md — TDD: MomentNode type + store (createMoment, readMoments, loadMoment) with atomic write
- [ ] 05-02-PLAN.md — TDD: BM25 search over moment stories + extend runSearch/runStatus in CLI
- [ ] 05-03-PLAN.md — TDD: runMoment CLI handler + captureCodeRefs + inject context moment extension

### Phase 6: AI Family Shared Layer
**Goal**: Nova, Iris, and Qwen3 can each write signals to the shared concept web with per-source weight normalisation, and market signals from Iris do not propagate into coding concepts used by Claude
**Depends on**: Phase 3
**Requirements**: FAM-01, FAM-02, FAM-03, FAM-04
**Success Criteria** (what must be TRUE):
  1. A signal written by Nova (source_weight: 0.7) and the same signal written by Claude (source_weight: 1.0) produce different composite scores on the same concept node — source attribution is visible in axon.json
  2. Concurrent writes from two different agents to axon.json do not corrupt the file — the final state reflects both writes with no data loss
  3. A DISPREFERRED market concept from Iris does not appear in the top-10 ACTIVE concepts for Claude's coding session — cross-domain attenuation is enforced at read time
  4. A research spike confirming the cross-domain attenuation algorithm is completed and documented before Phase 6 implementation begins
**Plans**: TBD

### Phase 7: Code Reading
**Goal**: A codebase can be ingested as a concept web where functions are nodes, call relationships are edges weighted by call frequency, and code concepts integrate with the existing natural-language concept web
**Depends on**: Phase 1
**Requirements**: CODE-01, CODE-02, CODE-03, CODE-04
**Success Criteria** (what must be TRUE):
  1. A Cognee ECL overlap check is completed and documented before any AST ingestion code is written — the check either confirms novel territory or identifies reusable learnings
  2. After ingesting a TypeScript codebase, `theorex status` shows function nodes with edge weights reflecting relative call frequency — frequently called functions have higher edge weights
  3. A code function node and a natural-language concept node can be connected by an edge — code concepts and memory concepts live in the same web
  4. The code-reading graph has its own size cap and pruning pass separate from the memory concept web — codebase ingestion does not inflate or corrupt memory concepts
**Plans**: TBD

### Phase 8: Drift Detection
**Goal**: An AI agent's behavioral consistency is continuously tracked — every tier change, sentiment flip, graduation, and prune is logged to an audit trail, and a drift score computed from moment anchors vs the live concept web tells you whether the agent is still being who it said it was
**Depends on**: Phase 5 (moment nodes — the anchors), Phase 3 (hooks — event sources)
**Requirements**: DRF-01, DRF-02, DRF-03, DRF-04, DRF-05, DRF-06, DRF-07, DRF-08, CLI-08, CLI-09
**Success Criteria** (what must be TRUE):
  1. Every concept tier change, sentiment flip, graduation, prune event, and moment capture is appended to `data/events.jsonl` with timestamp and source — the log is never overwritten, only appended
  2. `theorex drift` returns a score between 0.0 and 1.0 — 1.0 means moment anchors perfectly overlap current ACTIVE concepts; 0.0 means complete divergence — computed with zero LLM calls
  3. `theorex drift` lists individual flagged concepts — those that dropped tiers or flipped sentiment within the configured rolling window (default: 7 days)
  4. `theorex status` output includes a drift summary line (score + stable/drifting/recovering) without breaking any existing assertions in the test suite
  5. `theorex audit` displays recent event log entries and accepts `--type` and `--since` filters — output is human-readable and machine-parseable
**Plans**: 4 plans

Plans:
- [ ] 08-01-PLAN.md — TDD: audit logger (appendAuditEvent, EVENTS_PATH, all AuditEvent types) + reader (readAuditEvents, AuditFilter)
- [ ] 08-02-PLAN.md — TDD: drift scorer (computeDriftScore, detectInstability, detectSentimentFlips, classifyTrend) — pure math, no I/O
- [ ] 08-03-PLAN.md — Wire mutation sites: scan.ts + prune.ts + propagate.ts + graduate.ts + moments/store.ts emit audit events; extend Config
- [ ] 08-04-PLAN.md — CLI: theorex drift + theorex audit commands + theorex status drift summary extension

## Progress

**Execution Order:**
Phases execute in dependency order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
Note: Phases 4, 5, 7 depend on Phase 1 only and could run in parallel after Phase 1 completes. Phase 3 depends on Phase 2. Phase 6 depends on Phase 3. Phase 8 depends on Phases 3 and 5.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Significance Engine | 6/6 | Complete   | 2026-03-10 |
| 1. Long-Term Lobe | 6/6 | Complete   | 2026-03-10 |
| 2. Short-Term Lobe | 5/5 | Complete   | 2026-03-10 |
| 3. Flash Lobe + Hooks | 3/3 | Complete   | 2026-03-11 |
| 4. RAG Bootstrap | 3/3 | Complete    | 2026-03-11 |
| 5. Moment Nodes | 3/3 | Complete   | 2026-03-11 |
| 6. AI Family Shared Layer | 0/TBD | Not started | - |
| 7. Code Reading | 0/TBD | Not started | - |
| 8. Drift Detection | 4/4 | Complete   | 2026-03-11 |
