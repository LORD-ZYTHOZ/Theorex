# Requirements: Theorex

**Defined:** 2026-03-10
**Core Value:** An AI that knows what matters right now because its memory is alive, decays intelligently, and cross-pollinates relevance across a living concept web.

## v1 Requirements

### Significance Engine (Phase 0)

- [x] **SIG-01**: System extracts concept candidates from any text input using NLP (noun phrases, named entities, domain terms)
- [x] **SIG-02**: System applies importance gate — binary yes/no — before frequency is counted (importance must be a hard prerequisite, not a weighted factor)
- [x] **SIG-03**: System assigns numeric IDs to concepts — synonyms collapse to one canonical ID
- [x] **SIG-04**: System amplifies frequency score only for concepts that pass the importance gate
- [x] **SIG-05**: System records source weight field on every signal (which AI agent or human generated it)
- [x] **SIG-06**: All significance functions are pure (input → output, no side effects, no mutation)

### Concept Web — Axon (Phase 1)

- [x] **AXN-01**: System maintains a weighted concept graph (nodes = concepts, edges = co-occurrence relationships)
- [x] **AXN-02**: Each node carries: numeric ID, label, relevance tier, sentiment tier, importance weight, reference count, last-referenced timestamp, source weight
- [x] **AXN-03**: Each edge carries: strength (0.0–1.0), co-occurrence count, last co-occurrence timestamp
- [x] **AXN-04**: Activation propagates one hop through edges with 0.5 dampening factor (no unbounded multi-hop)
- [x] **AXN-05**: New edges form automatically when concepts co-occur; dead edges decay and are pruned below threshold
- [x] **AXN-06**: Graph serialises to JSON (human-inspectable); loads from JSON on startup

### Relevance Classification (Phase 1)

- [x] **REL-01**: Every node is classified as ACTIVE / MILD / LESS based on composite score (recency 40%, frequency 35%, co-occurrence 25%)
- [x] **REL-02**: Recency uses exponential decay with configurable lambda (default: half-life ~14 days)
- [x] **REL-03**: Classification updates lazily on read (elapsed-time correction) and eagerly on scheduled scan (every 6 hours via PM2)
- [x] **REL-04**: LESS nodes past configurable prune threshold (default: 30 days) are archived then deleted
- [x] **REL-05**: Classification thresholds are configurable in config.json (default: ACTIVE ≥ 0.6, MILD ≥ 0.3)

### Sentiment Classification (Phase 1)

- [x] **SNT-01**: Every node starts at NEUTRAL sentiment
- [x] **SNT-02**: System can set node sentiment to PREFERRED or DISPREFERRED based on experience signals
- [x] **SNT-03**: Sentiment propagates one hop through edges with dampening (DISPREFERRED does not flood entire graph)
- [x] **SNT-04**: A node can be ACTIVE + DISPREFERRED (recurring problem) or LESS + PREFERRED (remembered solution)

### Long-Term Lobe (Phase 1)

- [x] **LTM-01**: System parses existing MEMORY.md into structured entries using section-boundary parser (not generic markdown parser)
- [x] **LTM-02**: Parser produces byte-identical output when writing unmodified entries (round-trip fidelity — hard gate)
- [x] **LTM-03**: Classification metadata stored in .theorex-meta.json separate from MEMORY.md
- [x] **LTM-04**: Writer always writes to temp file first, then atomic rename — never corrupts MEMORY.md
- [x] **LTM-05**: Pruned entries archived to data/archive/ before deletion — never silently lost

### Short-Term Lobe (Phase 2)

- [x] **STM-01**: System writes session entries to append-only JSONL files (one per day) at data/short-term/YYYY-MM-DD.jsonl
- [x] **STM-02**: JSONL files older than 14 days are automatically deleted
- [x] **STM-03**: System supports BM25 keyword search over session entries with field weighting
- [x] **STM-04**: System supports vector semantic search over session entries using local embeddings
- [x] **STM-05**: Hybrid search combines BM25 + vector via reciprocal rank fusion; degrades gracefully to BM25-only when embedder unavailable
- [x] **STM-06**: Short-term entries classified as ACTIVE for 7+ consecutive days are graduated to long-term automatically

### Flash Lobe (Phase 3)

- [x] **FLH-01**: System maintains a per-session ring buffer of last 50 events at data/flash/{session-id}.json
- [x] **FLH-02**: Flash buffer uses atomic write (temp file + rename) — safe for concurrent sessions
- [x] **FLH-03**: Flash token ceiling enforced in code at 2,000–4,000 tokens — hard limit, not guideline
- [x] **FLH-04**: On session end, events above significance threshold (≥ 0.5) are written to short-term
- [x] **FLH-05**: Flash clears naturally at session end — volatile by design

### Claude Code Hooks (Phase 3)

- [x] **HKS-01**: PostToolUse hook records events to flash buffer (async: true — non-blocking)
- [x] **HKS-02**: SessionEnd hook flushes flash to short-term and triggers significance scoring
- [x] **HKS-03**: SessionStart hook injects relevant context from all three lobes into conversation
- [x] **HKS-04**: All hooks are project-scoped — do not affect Claude Code sessions outside Theorex
- [x] **HKS-05**: Hooks suppress shell startup output to prevent JSON corruption
- [x] **HKS-06**: Hooks are additive — existing ~/.claude/ hooks are preserved and unmodified

### RAG Bootstrap (Phase 4)

- [x] **RAG-01**: New concepts are embedded using local model (LM Studio → HuggingFace ONNX → BM25-only fallback)
- [x] **RAG-02**: Initial edges seeded from embedding nearest-neighbours with low weight (0.1–0.2)
- [x] **RAG-03**: Bootstrap edges strengthen on confirmed co-occurrence, dissolve if never reinforced
- [x] **RAG-04**: ONNX Bun compatibility validated at Phase 4 start before full implementation

### Moment Nodes (Phase 5)

- [x] **MOM-01**: System can create moment nodes — permanent concept anchors tied to a specific point in time
- [x] **MOM-02**: Moment node stores: timestamp, story (human-readable description), code references (file:line), edges to related concepts
- [x] **MOM-03**: Moment nodes are never pruned regardless of recency or frequency scores
- [x] **MOM-04**: Moment nodes are searchable and surface in context injection

### CLI (Distributed across phases)

- [x] **CLI-01**: `theorex scan` — re-score all entries, apply decay, update classifications
- [x] **CLI-02**: `theorex status` — display all nodes with ACTIVE/MILD/LESS and PREFERRED/NEUTRAL/DISPREFERRED
- [x] **CLI-03**: `theorex ref <keyword>` — record a reference, bump recency and frequency
- [x] **CLI-04**: `theorex prune` — archive and remove LESS nodes past threshold
- [x] **CLI-05**: `theorex search <query>` — hybrid search over short-term
- [x] **CLI-06**: `theorex graduate` — promote eligible short-term entries to long-term
- [x] **CLI-07**: `theorex moment <story>` — create a moment node with current context

## v2 Requirements

### AI Family Shared Layer (Phase 6)

- **FAM-01**: Nova, Iris, Qwen3 can write signals to shared concept web
- **FAM-02**: Source weight normalisation across different AI agents (Ministral-3B vs Qwen3-32B vs Claude)
- **FAM-03**: Cross-domain propagation attenuation (market signals from Iris don't flood coding concepts)
- **FAM-04**: Multi-agent concurrent write safety

### Code Reading (Phase 7)

- **CODE-01**: Ingest raw codebase as concept web (functions = nodes, calls = edges)
- **CODE-02**: Function call frequency drives edge weight
- **CODE-03**: Code concepts integrate with natural language concept web
- **CODE-04**: Verify Cognee ECL overlap before building AST ingestion from scratch

### Drift Detection (Phase 8)

- **DRF-01**: System maintains a JSONL audit event log (`data/events.jsonl`) — every concept tier change, sentiment flip, graduation, prune, and moment capture is appended with a timestamp and source
- **DRF-02**: System computes a drift score (0.0–1.0) by comparing moment node concept_ids against the current ACTIVE-tier set — high overlap = stable, low overlap = drifting
- **DRF-03**: System detects concept tier instability — ACTIVE concepts that drop to MILD or LESS within a configurable rolling window raise a drift signal
- **DRF-04**: System detects sentiment flips — concepts that transition between PREFERRED and DISPREFERRED within the rolling window are flagged individually
- **DRF-05**: Drift evaluation is purely deterministic — no LLM calls, no external APIs; computed from axon.json + events.jsonl + moment nodes
- **DRF-06**: `theorex drift` CLI command displays current drift score, flagged concepts, and stability trend (stable / drifting / recovering)
- **DRF-07**: `theorex status` extended to include drift summary line (score + alert flag) without breaking existing output
- **DRF-08**: `theorex audit` CLI command displays recent event log entries — tier changes, prune events, graduations, moment captures — filterable by type and time window
- **CLI-08**: `theorex drift` — show drift score (0.0–1.0), flagged concepts, trend direction
- **CLI-09**: `theorex audit [--type <type>] [--since <date>]` — inspect event log

## Out of Scope



| Feature | Reason |
|---------|--------|
| External embedding APIs (OpenAI, Anthropic) | Local only — no cloud dependency |
| Graphical UI or web dashboard | CLI and hook integration sufficient for v1 |
| Generic document search (RAG-as-retrieval) | Anti-pattern for this use case — retrieval pattern discarded |
| Borrowed code from QMD/LlamaIndex/CortexGraph | Learnings only; fresh implementation to avoid inherited assumptions |
| SQLite or any database | Flat-file architecture correct at v1 scale; JSONL + JSON only |
| Multi-hop cross-pollination (>1 hop) | Confirmed to flood graph and destroy tier discrimination |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SIG-01 | Phase 0 — Significance Engine | Complete |
| SIG-02 | Phase 0 — Significance Engine | Complete |
| SIG-03 | Phase 0 — Significance Engine | Complete |
| SIG-04 | Phase 0 — Significance Engine | Complete |
| SIG-05 | Phase 0 — Significance Engine | Complete |
| SIG-06 | Phase 0 — Significance Engine | Complete |
| AXN-01 | Phase 1 — Long-Term Lobe | Complete |
| AXN-02 | Phase 1 — Long-Term Lobe | Complete |
| AXN-03 | Phase 1 — Long-Term Lobe | Complete |
| AXN-04 | Phase 1 — Long-Term Lobe | Complete |
| AXN-05 | Phase 1 — Long-Term Lobe | Complete |
| AXN-06 | Phase 1 — Long-Term Lobe | Complete |
| REL-01 | Phase 1 — Long-Term Lobe | Complete |
| REL-02 | Phase 1 — Long-Term Lobe | Complete |
| REL-03 | Phase 1 — Long-Term Lobe | Complete |
| REL-04 | Phase 1 — Long-Term Lobe | Complete |
| REL-05 | Phase 1 — Long-Term Lobe | Complete |
| SNT-01 | Phase 1 — Long-Term Lobe | Complete |
| SNT-02 | Phase 1 — Long-Term Lobe | Complete |
| SNT-03 | Phase 1 — Long-Term Lobe | Complete |
| SNT-04 | Phase 1 — Long-Term Lobe | Complete |
| LTM-01 | Phase 1 — Long-Term Lobe | Complete |
| LTM-02 | Phase 1 — Long-Term Lobe | Complete |
| LTM-03 | Phase 1 — Long-Term Lobe | Complete |
| LTM-04 | Phase 1 — Long-Term Lobe | Complete |
| LTM-05 | Phase 1 — Long-Term Lobe | Complete |
| CLI-01 | Phase 1 — Long-Term Lobe | Complete |
| CLI-02 | Phase 1 — Long-Term Lobe | Complete |
| CLI-03 | Phase 1 — Long-Term Lobe | Complete |
| CLI-04 | Phase 1 — Long-Term Lobe | Complete |
| STM-01 | Phase 2 — Short-Term Lobe | Complete |
| STM-02 | Phase 2 — Short-Term Lobe | Complete |
| STM-03 | Phase 2 — Short-Term Lobe | Complete |
| STM-04 | Phase 2 — Short-Term Lobe | Complete |
| STM-05 | Phase 2 — Short-Term Lobe | Complete |
| STM-06 | Phase 2 — Short-Term Lobe | Complete |
| CLI-05 | Phase 2 — Short-Term Lobe | Complete |
| CLI-06 | Phase 2 — Short-Term Lobe | Complete |
| FLH-01 | Phase 3 — Flash Lobe + Hooks | Complete |
| FLH-02 | Phase 3 — Flash Lobe + Hooks | Complete |
| FLH-03 | Phase 3 — Flash Lobe + Hooks | Complete |
| FLH-04 | Phase 3 — Flash Lobe + Hooks | Complete |
| FLH-05 | Phase 3 — Flash Lobe + Hooks | Complete |
| HKS-01 | Phase 3 — Flash Lobe + Hooks | Complete |
| HKS-02 | Phase 3 — Flash Lobe + Hooks | Complete |
| HKS-03 | Phase 3 — Flash Lobe + Hooks | Complete |
| HKS-04 | Phase 3 — Flash Lobe + Hooks | Complete |
| HKS-05 | Phase 3 — Flash Lobe + Hooks | Complete |
| HKS-06 | Phase 3 — Flash Lobe + Hooks | Complete |
| RAG-01 | Phase 4 — RAG Bootstrap | Complete |
| RAG-02 | Phase 4 — RAG Bootstrap | Complete |
| RAG-03 | Phase 4 — RAG Bootstrap | Complete |
| RAG-04 | Phase 4 — RAG Bootstrap | Complete |
| MOM-01 | Phase 5 — Moment Nodes | Complete |
| MOM-02 | Phase 5 — Moment Nodes | Complete |
| MOM-03 | Phase 5 — Moment Nodes | Complete |
| MOM-04 | Phase 5 — Moment Nodes | Complete |
| CLI-07 | Phase 5 — Moment Nodes | Complete |
| FAM-01 | Phase 6 — AI Family Shared Layer (v2) | Pending |
| FAM-02 | Phase 6 — AI Family Shared Layer (v2) | Pending |
| FAM-03 | Phase 6 — AI Family Shared Layer (v2) | Pending |
| FAM-04 | Phase 6 — AI Family Shared Layer (v2) | Pending |
| CODE-01 | Phase 7 — Code Reading (v2) | Pending |
| CODE-02 | Phase 7 — Code Reading (v2) | Pending |
| CODE-03 | Phase 7 — Code Reading (v2) | Pending |
| CODE-04 | Phase 7 — Code Reading (v2) | Pending |
| DRF-01 | Phase 8 — Drift Detection (v2) | Complete |
| DRF-02 | Phase 8 — Drift Detection (v2) | Complete |
| DRF-03 | Phase 8 — Drift Detection (v2) | Complete |
| DRF-04 | Phase 8 — Drift Detection (v2) | Complete |
| DRF-05 | Phase 8 — Drift Detection (v2) | Complete |
| DRF-06 | Phase 8 — Drift Detection (v2) | Complete |
| DRF-07 | Phase 8 — Drift Detection (v2) | Complete |
| DRF-08 | Phase 8 — Drift Detection (v2) | Complete |
| CLI-08 | Phase 8 — Drift Detection (v2) | Complete |
| CLI-09 | Phase 8 — Drift Detection (v2) | Complete |

**Coverage:**
- v1 requirements: 59 total (SIG×6, AXN×6, REL×5, SNT×4, LTM×5, STM×6, FLH×5, HKS×6, RAG×4, MOM×4, CLI×7, FAM×4, CODE×4)
- v1 core (Phases 0-5): 51 requirements mapped
- v2 planned (Phases 6-8): 18 requirements mapped
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 — traceability expanded to per-requirement rows after roadmap creation*
