# Research Summary

**Project:** Theorex — AI Cognitive Memory Architecture
**Domain:** AI-native multi-lobe memory system with living concept graph
**Researched:** 2026-03-10
**Confidence:** MEDIUM-HIGH

---

## Executive Summary

Theorex sits in a young but rapidly crowding space. By early 2026, production AI memory systems (Zep/Graphiti, Mem0, Cognee, Letta, LangMem) have converged on a set of table-stakes patterns: persistent cross-session storage, semantic retrieval via vector embeddings, memory tiering, entity extraction, and time-aware fact management. Research confirms that Theorex's core build order — significance engine first, concept web second, three-lobe storage third — is correct. The significance-first approach (importance gate before frequency amplifier) is validated by Mem0's production architecture and Google's Titans research, which independently arrived at the same conclusion: frequency without importance tracking produces noise amplification that degrades retrieval quality over time.

What distinguishes Theorex from everything surveyed is the combination of features that no single existing system ships together: sentiment tiers (PREFERRED/NEUTRAL/DISPREFERRED) propagating through concept graph edges, moment nodes as permanent episodic anchors outside the decay system, and the explicit architectural commitment to treating RAG as a cold-start bootstrap tool rather than a retrieval pattern. Zep's 2025 research documents a 40% failure rate for RAG-as-retrieval in production agents due to temporal staleness — Theorex's living concept web directly addresses this. The BM25-first, embeddings-optional approach is also genuinely novel in production deployments, where cloud embedding APIs are the default.

The critical build risk is not in any single phase — it is in Phase 0 (Significance Engine). Every other component inherits whatever quality decisions are made there. If the importance gate is weak, frequency amplifies noise throughout the entire system. If cross-pollination lacks proper dampening, the concept web diverges into uniformly high relevance, destroying tier discrimination. If the source weight field is absent from the data model at Phase 0, all later phases must be retrofitted. These are not implementation details — they are architectural load-bearing decisions. Get Phase 0 right before building anything else.

---

## Validated Decisions

Research confirmed all of the following design decisions from cortex.md:

| Decision | Validation Source | Confidence |
|----------|------------------|------------|
| Significance engine built first — everything depends on it | Mem0 arXiv paper, Titans architecture research | HIGH |
| Importance gate before frequency amplifier | MemoryBank noise studies; Mem0 production failure modes | HIGH |
| RAG as bootstrap only, not retrieval pattern | Zep June 2025 production analysis (40% failure rate) | HIGH |
| MEMORY.md metadata stored separately in .theorex-meta.json | Round-trip fidelity pitfall analysis; format conflicts | HIGH |
| BM25 as always-available fallback, vectors as optional enrichment | Surveyed systems fail gracefully only when search has a non-embedding path | HIGH |
| Per-session flash files to prevent concurrent write corruption | Multi-instance M4 Pro usage pattern; file locking complexity | HIGH |
| One-hop activation propagation with edge-weight dampening | Graph theory: unbounded multi-hop produces divergence | HIGH |
| Numeric IDs for concepts with synonym collapse at ingestion | String comparison fragments relevance accumulation; graph math requires stable IDs | HIGH |
| No database — JSON/JSONL flat files sufficient for < 50K nodes | M4 Pro 64GB; 10K node graph is < 5MB; flat scan on 384-dim vectors < 50ms | HIGH |

---

## Novel Contributions

Features Theorex has that no surveyed system implements:

| Feature | What Makes It Novel | Confidence |
|---------|---------------------|------------|
| Sentiment tiers (PREFERRED/NEUTRAL/DISPREFERRED) on graph nodes | LangMem's procedural memory is closest analog but operates at prompt level, not node level in a weighted graph | MEDIUM |
| Sentiment cross-pollination through edges | Surveyed systems track facts and recency; none propagate sentiment aversion/preference through graph structure | MEDIUM |
| Moment nodes — permanent episodic anchors outside the decay system | Letta/Zep sliding-window episodic memory decays or summarizes old episodes; no surveyed system explicitly marks memories as permanent anchors | MEDIUM |
| Importance gate as a strict prerequisite step, not a weighted factor | Other systems balance importance and frequency post-hoc; Theorex's gate architecture prevents noise from entering the pipeline | HIGH |
| Living concept web where code graph and memory graph are the same structure | Code-graph RAG tools (CodePrism, Code-Graph-RAG) treat code as documents to retrieve; Theorex treats code structure as memory structure | MEDIUM (verify vs Cognee ECL) |
| Source-weighted shared concept web across heterogeneous AI agents | Multi-agent shared memory is emerging; no surveyed system implements per-source weight modifiers on a shared weighted graph | LOW (sparse literature) |

---

## Key Findings

### Recommended Stack

The full stack is lean by design. Every choice prioritizes Bun native APIs over npm packages, and eliminates categories of dependency (no database, no cloud APIs, no CLI framework). All critical packages are pure JavaScript with no native bindings, ensuring Bun compatibility.

**Core technologies:**

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| Bun | >= 1.3.7 | Runtime, package manager, test runner, bundler | Native JSONL API (Bun.JSONL since 1.3.7), 3x faster file I/O than Node.js, built-in TypeScript |
| graphology | 0.26.0 | In-memory weighted directed graph (Axon web) | 811k weekly downloads, full algorithm library (PageRank, BFS, Dijkstra), pure JS, Bun-compatible |
| graphology-metrics | peer | Weighted PageRank for activation propagation | Ships `getEdgeWeight` parameter needed for cross-pollination |
| graphology-traversal | peer | BFS/DFS for activation spread | Standard library, no custom implementation needed |
| wink-bm25-text-search | latest | BM25 full-text search over JSONL session logs | Field-weighted documents (concept_name vs story_text score differently), NLP preprocessing built in |
| @huggingface/transformers | 3.x | Local ONNX embedding pipeline (fallback path) | Explicit Bun support in v3; WASM backend if native ONNX bindings fail |
| Xenova/all-MiniLM-L6-v2 | ONNX weights | Embedding model — 384 dimensions | 22MB, well-benchmarked, ONNX pre-converted, available without internet |
| compromise | 14.x | Concept extraction, noun/entity detection | Pure JS, no native deps, English NER + noun phrase chunking |
| LM Studio REST API | OpenAI-compat | Primary embedding path when Ministral-3B is loaded | `POST http://localhost:1234/v1/embeddings` — already in the AI ecosystem |

**Critical version constraint:** Bun >= 1.3.7 required. `Bun.JSONL.parse()` and `Bun.JSONL.parseChunk()` ship in 1.3.7. These are core to the short-term lobe. Do not assume older Bun installs are compatible.

**ONNX risk note:** `@huggingface/transformers` may fall back to WASM backend in Bun if native C++ bindings fail. WASM is ~3x slower but still fully local and acceptable for infrequent cold-start embedding operations. Test at Phase 4.

**What is explicitly NOT in the stack:**
- No vector database (flat Float32Array scan sufficient at < 10K nodes)
- No CLI framework (six subcommands, hand-rolled 50-line dispatch)
- No ORM or schema validation library (hand-rolled type guards, single-author system)
- No cloud embedding APIs

---

### Expected Features

**Table stakes — all production AI memory systems implement these; absence makes the product feel broken:**
- Persistent cross-session memory (JSONL or DB log)
- Semantic retrieval via vector embeddings
- Memory tiering (short-term / long-term at minimum)
- Memory update / upsert logic (facts change; append-only corrupts over time)
- Forgetting / pruning (unbounded growth degrades retrieval quality)
- Entity extraction (raw text → structured facts)
- Session boundary awareness
- CLI or programmatic API for human inspection
- Graceful cold-start before history accumulates

**Differentiators — what makes Theorex distinct:**
- Weighted concept graph with activation propagation (Zep/Cognee implement this; most RAG systems do not)
- Temporal knowledge — facts timestamped, conflicts resolved by recency
- Importance-gated significance (not frequency-first) — explicit architectural commitment absent from surveyed systems
- Sentiment tiers per concept node, cross-pollinating through edges — NOVEL
- Moment nodes — permanent episodic anchors — NOVEL
- Code as first-class memory structure — NOVEL (verify vs Cognee ECL)
- Source-weighted multi-agent shared concept web — NOVEL (low confidence)
- Local-only embeddings with BM25 fallback — genuine operational differentiator

**Defer to v2+:**
- Sentiment tiers and cross-pollination (needs stable concept graph data first)
- Multi-agent shared layer / Phase 6 (requires single-agent system proven)
- Code reading / Phase 7 (standalone, nothing depends on it)
- Graphical UI (not needed for AI-to-AI use case)

**Anti-features — explicitly do not build:**
- RAG as retrieval pattern (40% production failure rate for temporal facts; use as bootstrap only)
- Frequency-first significance (noise amplification)
- Equal-weight memory chunks
- Append-only memory with no decay
- Cloud embedding APIs
- Shared mutable flash file across sessions
- Mutation of stored memory objects (immutable patterns only)
- Metadata embedded in MEMORY.md (use .theorex-meta.json)

---

### Architecture Approach

Theorex is a five-layer concentric architecture with the significance engine at the center. Data flows outward from raw event to crystallized knowledge, inward via context injection. The significance engine is the only mandatory intermediary — every data-generating event passes through it; nothing bypasses it. The three lobes (Flash, Short-Term, Long-Term) form a pipeline: Flash captures per-session events in a bounded ring buffer, Short-Term persists 14 days of session history with hybrid search, Long-Term stores crystallized knowledge in human-readable MEMORY.md backed by machine-readable classification metadata.

**Major components and responsibilities:**

| Component | Responsibility |
|-----------|---------------|
| Significance Engine | Importance gate (binary) then frequency amplifier; outputs composite 0.0–1.0 score — nothing enters the concept web without passing through this |
| ConceptExtractor | Tokenize text, resolve synonyms to canonical numeric IDs, create new nodes at score 0.0 |
| ImportanceGate | Binary classifier: PASS or FAIL; FAIL means frequency is never counted |
| FrequencyAmplifier | Log-normalized occurrence count; only runs after gate PASS |
| CompositeSignal | Merge importance (0.7 weight) and frequency (0.3 weight) → single node score |
| Concept Web (Axon) | graphology in-memory weighted graph; nodes = concepts with tier + sentiment; edges = co-occurrence strength |
| CrossPollinator | 1-hop only, edge-weight dampened activation spread; no unbounded recursion |
| DecayRunner | Exponential decay per node type; Moment nodes exempt; scheduled via PM2 every 6 hours |
| TierClassifier | ACTIVE (>0.65) / MILD (0.35–0.65) / LESS (0.15–0.35) / prune (<0.15) |
| Flash Lobe | Per-session JSONL ring buffer; hard token cap (2,000–4,000 tokens); presence not retrieval |
| Hook Dispatcher | PostToolUse enqueues raw event (< 1ms); Stop flushes; SessionStart injects ACTIVE context |
| Short-Term Lobe | 14-day rolling JSONL + BM25Index (in-memory) + VectorIndex (LM Studio or ONNX) |
| Long-Term Lobe | MEMORY.md (human-readable, round-trip fidelity required) + .theorex-meta.json + axon.json |
| Moment Node Store | Permanent JSON files; bypass decay; bypass pruning; narrative + code + log references |
| RAG Bootstrap | New node → embed → find neighbors → seed weak edges (weight 0.1–0.15, type: seeded) |
| CLI | Six subcommands: scan / status / search / ref / prune / graduate |

**Key architectural patterns confirmed by research:**
- Async hook with immediate enqueue (< 1ms) — Bun worker drains async; never block Claude Code
- Per-session flash files keyed by session_id — prevents concurrent write corruption
- Immutable graph updates — new object on every write; enables diff and rollback
- Synonym collapse at extraction time — not at query time
- Lazy decay on read + eager scheduled decay every 6 hours (PM2)
- BM25 score normalized to [0,1] before fusion with vector scores (0.7 BM25 / 0.3 vector for keyword-heavy short-term logs)

---

### Critical Pitfalls

**Pitfall 1: Frequency runs before the importance gate**
Frequency is easy to implement; importance is hard. Teams reach for counters first. Result: noise accumulates at ACTIVE tier, signal sits at LESS. Prevention: the importance gate is a strict, required prerequisite step — code it as a separate function that FAIL-returns before any frequency counting begins. Write a test that asserts a 1000x-repeated unimportant concept scores lower than a once-encountered confirmed important concept.

**Pitfall 2: Uniform exponential decay applied to all node types**
A single decay time constant applied globally causes Moment nodes to decay, foundational system concepts to fade, and recent trivial events to inflate. Prevention: decay is type-aware. Moment nodes: no decay ever. Long-term crystallized nodes: months-scale half-life. Short-term session nodes: days-scale. Decay function takes node type as an explicit parameter — no uniform application.

**Pitfall 3: MEMORY.md round-trip fidelity failure**
Markdown has no canonical parse/serialize round-trip. Programmatic writers follow spec, not the human conventions in the original file. Result: blank lines shift, heading levels change, format degrades. Prevention: never use a general Markdown parser. Split on section headings, treat each section's body as an opaque string, replace only the specific section lines that changed. Write a byte-identical round-trip test before any code that touches MEMORY.md merges.

**Pitfall 4: Context window bloat from flash over-injection**
"More context = more informed AI" feels correct but is wrong. Research confirms context rot: recall accuracy decreases as injected tokens increase. The PostToolUse hook fires on every tool use — even trivial reads. Without a hard cap, flash grows unboundedly. Prevention: 2,000–4,000 token hard cap enforced in code, tested in CI. Never automatically inject Moment nodes. Curate at write time, not at load time.

**Pitfall 5: Cross-pollination feedback loops diverging**
In a dense cluster, node A raises B, B raises A, all neighbors raise each other. Loop gain > 1.0 produces unbounded inflation. Prevention: 1-hop only; total activation added per cycle is capped (e.g., max +0.2 regardless of incoming signals); no node propagates back to its own source in the same cycle; convergence test required (5-node fully connected cluster, inject activation, assert stable values within 10 steps).

**Pitfall 6: Claude Code hooks breaking existing integrations**
Hooks in `~/.claude/settings.json` fire globally — for all projects, all sessions. A Theorex hook that exits non-zero or produces malformed JSON to stdout breaks every Claude Code session on the machine. Known bugs: hooks failing in subdirectories (v2.0.27), shell startup output contaminating JSON stdout. Prevention: every hook script must check working directory at entry, exit 0 immediately if not a Theorex session. Suppress all startup output. Exit 0 even on failure — log errors to a separate file, never block Claude Code.

---

## Implications for Roadmap

The build order defined in cortex.md is architecturally correct and confirmed by research. The dependency graph is strict — no phase can safely proceed without the previous phase being stable. The roadmap should reflect this as a hard constraint, not a preference.

### Phase 0: Significance Engine (Foundation)

**Rationale:** Every other component calls this. If incomplete or incorrect, all downstream phases inherit the defect. No phase can ship without it.
**Delivers:** Pure function pipeline — ConceptExtractor, ImportanceGate, FrequencyAmplifier, CompositeSignal. No storage. Input: raw text + context. Output: scored concept events with 0.0–1.0 scores.
**Addresses:** Table-stakes entity extraction, importance-gated significance (key differentiator)
**Must avoid:** Frequency before importance (Pitfall 1), cross-pollination divergence (Pitfall 5), feedback loops
**Must define now (even though used later):** Source weight field on every event; seeded vs. observed edge type distinction; node type field for decay routing; domain field for cross-agent contamination prevention
**Research flag:** Standard patterns well-documented for BM25 concept extraction and log-normalized frequency. Importance classification (the gate itself) is the least documented element — the threshold and features for the binary classifier need empirical calibration during implementation.

### Phase 1: Long-Term Lobe

**Rationale:** Foundation store for all other lobes. Short-term graduates here; flash flushes here. Nothing can graduate if there is nowhere to go.
**Delivers:** MEMORY.md parser (round-trip fidelity), .theorex-meta.json schema + read/write, Axon graph store (axon.json, immutable ops), TierClassifier, SentimentUpdater.
**Addresses:** Persistent cross-session memory, memory update logic, MEMORY.md compatibility
**Must avoid:** Round-trip fidelity failure (Pitfall 3), pruning Moment nodes (must define is_permanent flag now), MEMORY.md as classification store (Anti-Pattern 6)
**Gate:** Byte-identical round-trip test must pass before any other phase writes to long-term storage.
**Research flag:** MEMORY.md round-trip is uniquely complex for this project because the existing file is hand-authored with human conventions. No standard library handles this correctly. Needs careful implementation with a section-boundary parser approach.

### Phase 2: Short-Term Lobe

**Rationale:** Requires significance engine (to score inbound events) and long-term lobe (as graduation destination). Is the flush destination for the Flash lobe that comes next.
**Delivers:** 14-day rolling JSONL session log, BM25Index (in-memory, rebuilt from JSONL on startup), VectorIndex (LM Studio + ONNX fallback), hybrid search with RRF merge, graduation logic (7-day ACTIVE threshold), 14-day pruning.
**Uses:** wink-bm25-text-search, @huggingface/transformers, LM Studio REST API
**Addresses:** Semantic retrieval, hybrid search, memory forgetting/pruning, session boundary awareness, BM25 fallback when embeddings unavailable
**Must avoid:** Concurrent write corruption (file locking, per-session files), BM25/vector score scale mismatch (normalize BM25 to [0,1] before fusion), JSONL cleanup never running (delete-on-write, not deferred)
**Research flag:** BM25 + vector fusion weights (0.7/0.3 default) are a starting point, not validated for this data shape. Test with real queries before shipping.

### Phase 3: Flash Lobe + Hook Dispatcher

**Rationale:** Requires short-term (flush destination) and significance engine (flush scoring). Hooks are the always-on event capture layer — must be built on proven storage infrastructure.
**Delivers:** Per-session flash file ({session-id}.jsonl), ring buffer logic with hard token cap, PostToolUse hook (async: true, enqueue only, < 1ms), Stop hook (flush to short-term + significance engine), SessionStart hook (inject ACTIVE context via additionalContext).
**Must avoid:** Synchronous hook blocking Claude Code (Pitfall from Architecture anti-patterns), shared mutable flash file, context window bloat (hard cap 2,000–4,000 tokens enforced in code), hooks breaking existing integrations (Pitfall 6 — working directory guard, suppress startup output)
**Research flag:** Claude Code hooks have known bugs (subdirectory firing in v2.0.27, JSON stdout contamination from shell startup). Test hook behavior in non-Theorex directories explicitly. The additive-only contract must be integration tested before touching global Claude Code configuration.

### Phase 4: RAG Bootstrap Layer

**Rationale:** Non-critical path — the system works before this phase (cold-start nodes have no edges). This phase improves day-one graph quality but does not unblock anything.
**Delivers:** LM Studio embedding client, BM25 fallback for embedding path, nearest-neighbor query on new concept creation, weak initial edge seeding (weight 0.1–0.15, type: seeded, 3x faster decay than observed edges).
**Addresses:** Graceful cold-start table stakes
**Must avoid:** Cold-start importing wrong relationships from embedding prior (Pitfall 5) — seed at 0.1–0.15 only; seeded edges labeled explicitly; dissolve if no co-occurrence confirmation within N sessions
**Research flag:** @huggingface/transformers ONNX backend behavior in Bun is MEDIUM confidence. Test native vs WASM path at this phase. Confirm model download works offline (model cached in node_modules).

### Phase 5: Moment Nodes

**Rationale:** Requires stable long-term lobe as anchor. Lower priority than live memory flow — capture can be manual initially.
**Delivers:** moments/{id}.json schema, CLI capture command, permanent flag (bypass decay, bypass pruning), auto-capture hooks for significant session events.
**Must avoid:** Decay runner reaching Moment nodes — is_permanent flag must be checked before any decay scoring (define this at Phase 0 data model, enforce here)
**Research flag:** Standard patterns — JSON schema, CLI command. Low complexity. No additional research needed.

### Phase 6: AI Family Shared Layer

**Rationale:** Adds multi-producer complexity. Requires all single-agent paths stable and well-tested first.
**Delivers:** Source weight per agent (Claude:1.0, Qwen3:0.9, Nova:0.7, Iris:0.7), shared axon.json with agent attribution on edges, input adapters per agent type, cross-domain propagation attenuation.
**Must avoid:** Cross-agent contamination — market concepts from Nova appearing in Claude's coding flash (Pitfall 9). Implement session-scoped relevance as a view over the shared web.
**Research flag:** Multi-agent shared memory is an emerging area with sparse literature. The source weighting and domain attenuation approach is novel — no reference implementation exists. Needs careful implementation with explicit contamination integration tests before enabling any cross-agent writes.

### Phase 7: Code Reading

**Rationale:** Standalone feature. Nothing depends on it. Highest implementation complexity (AST parsing, language-specific adapters). Correct to defer.
**Delivers:** AST parser (Bun/TypeScript native), function → node, call → edge, complexity → significance, codebase ingest as concept web.
**Must avoid:** Code graph growing unboundedly — code-reading graph should have its own size cap and pruning separate from the concept web.
**Research flag:** Cognee's ECL pipeline supports code ingestion — verify whether their approach for treating code as a concept web overlaps with Theorex's design before building from scratch. This is the one phase where prior art may save significant implementation time.

---

### Phase Ordering Rationale

- **Dependency graph is strict:** No phase can safely skip or reorder. Significance engine is the dependency of all dependencies.
- **Storage before capture:** Long-Term Lobe (Phase 1) before Short-Term (Phase 2) before Flash (Phase 3) — data must have somewhere to go before the capture layer writes it.
- **Single-agent before multi-agent:** Phases 0–5 prove the core system works for Claude before Phase 6 introduces multi-producer coordination complexity.
- **Standalone last:** Code reading (Phase 7) has no dependents and highest implementation cost — correct to defer until the live memory system is proven.
- **Pitfall prevention is front-loaded:** The most critical architectural decisions (importance gate ordering, decay type-awareness, source weight field, seeded vs observed edge types) must be defined in Phase 0's data model even though they are used in later phases. Retrofitting these would require touching every component.

---

### Research Flags by Phase

**Needs `/gsd:research-phase` during planning:**
- Phase 3 (Flash Lobe + Hooks): Claude Code hook edge cases and known bugs require targeted research before implementation. Global hook behavior in non-Theorex directories must be confirmed.
- Phase 6 (AI Family Shared Layer): Sparse literature on source-weighted shared concept webs. Novel territory — no reference implementation. Needs deeper research on concurrent write safety and cross-domain propagation attenuation.
- Phase 7 (Code Reading): Verify Cognee ECL pipeline overlap before building from scratch. AST parsing in Bun/TypeScript for concept web ingestion has limited reference implementations.

**Standard patterns, skip research-phase:**
- Phase 0 (Significance Engine): Core components (BM25, NLP extraction, log-normalization) are well-documented. The importance gate threshold calibration is empirical — discover during implementation, not research.
- Phase 1 (Long-Term Lobe): MEMORY.md round-trip is a known-hard problem with a known solution (section-boundary parser, not full Markdown parser). JSON file I/O is trivial.
- Phase 2 (Short-Term Lobe): Hybrid BM25 + vector search has established patterns. wink-bm25-text-search and @huggingface/transformers are well-documented.
- Phase 4 (RAG Bootstrap): Edge seeding pattern is straightforward once embedding client is built. Main risk (@huggingface/transformers in Bun) is a runtime test, not a research question.
- Phase 5 (Moment Nodes): Simple JSON schema + CLI command. No novel patterns.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Core choices (Bun, graphology, compromise) verified against npm and official docs. @huggingface/transformers Bun ONNX compatibility is MEDIUM — v3 has Bun examples but native bindings are not guaranteed. wink-bm25-text-search field weighting benefit is based on npm research, not benchmarked on this data shape. |
| Features | HIGH (table stakes), MEDIUM (differentiators), LOW (multi-agent) | Table stakes confirmed across 9 surveyed systems. Sentiment tiers and moment nodes novelty claims are based on survey scope — not comprehensive. Multi-agent shared web novelty is lowest confidence due to sparse literature. |
| Architecture | HIGH | Design validated against cortex.md specification + Titans research + Mem0 production paper + CortexGraph reference implementation. Claude Code hook patterns confirmed against official docs and known bug tracker issues. |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls corroborated by multiple sources (peer-reviewed papers, production post-mortems, official bug trackers). Hook-specific pitfalls are HIGH confidence from official Claude Code issues. Pitfall weights and thresholds (e.g., 0.1–0.15 for seeded edges, 2,000–4,000 token flash cap) are informed estimates, not empirically derived for this system. |

**Overall confidence:** MEDIUM-HIGH

---

### Gaps to Address

**Gap 1: Importance gate threshold and feature set**
The binary classifier's decision boundary is not defined. What signals constitute "important"? The design specifies: semantic density, novelty vs known concepts, source agent weight, explicit AI signals ("this matters"). But the threshold values and relative weights are unknown. Resolution: start with a hand-coded heuristic gate in Phase 0; collect Phase 1–2 data before tuning. Do not pre-optimize.

**Gap 2: BM25 + vector fusion weights empirical validation**
The 0.7/0.3 BM25/vector weighting is a reasonable default from literature but has not been validated on Theorex's data shape (structured JSONL entries with concept_name, story_text, tier, session_id fields). Resolution: create a small labeled test set during Phase 2 and measure NDCG@10 before settling weights.

**Gap 3: Cognee ECL pipeline overlap with Code Reading**
Cognee's Extended Concept Learning pipeline supports code ingestion. Before Phase 7 implementation, verify whether Cognee's approach for treating code as a concept web overlaps with Theorex's design. If substantial overlap exists, learnings from Cognee's implementation may save significant Phase 7 work.

**Gap 4: Cross-domain propagation attenuation algorithm**
Phase 6 requires dampening cross-agent propagation when concepts cross domain boundaries (market → coding, coding → market). No reference implementation was found. The "domain distance" metric is undefined. Resolution: define this during Phase 6 planning research. This is the highest-risk undefined algorithm in the system.

**Gap 5: @huggingface/transformers ONNX native binding in Bun**
Bun ONNX compatibility for `@huggingface/transformers` v3 is documented with examples but not guaranteed for all models and platforms. Resolution: test both native and WASM paths at the start of Phase 4. If native fails, WASM fallback is acceptable — document the decision.

---

## Sources

### Primary (HIGH confidence)
- Bun v1.3.7 release blog (Bun.JSONL) — https://bun.com/blog/bun-v1.3.7
- Claude Code Hooks Reference — https://code.claude.com/docs/en/hooks
- Mem0 Production-Ready AI Agents — arXiv April 2025 (https://arxiv.org/abs/2504.19413)
- Titans architecture (Google Research) — novelty signal as importance gate
- Zep Using Knowledge Graphs to Power LLM Agent Memory — whitepaper 2025
- CortexGraph reference implementation — temporal decay, tier promotion thresholds
- Stop Using RAG for Agent Memory (Zep, June 2025) — https://blog.getzep.com/stop-using-rag-for-agent-memory/
- Claude Code issue tracker — hooks not executing in subdirectories (#10367, #6305)
- Exponential History Integration with Diverse Temporal Scales — Science Advances
- Efficient Pruning of Large Knowledge Graphs — IJCAI 2018

### Secondary (MEDIUM confidence)
- graphology npm (0.26.0, 811k weekly downloads) — https://www.npmjs.com/package/graphology
- @huggingface/transformers v3 Bun support — https://huggingface.co/blog/transformersjs-v3
- wink-bm25-text-search GitHub — https://github.com/winkjs/wink-bm25-text-search
- Hybrid BM25 + vector search patterns — practitioner sources
- Memory in LLM-based Multi-agent Systems — TechRxiv preprint
- Survey of AI Agent Memory Frameworks (Graphlit) — https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks
- Rethinking Memory in AI: Taxonomy — arXiv May 2025
- LangMem SDK, Letta/MemGPT documentation, Cognee AI Memory Tools Evaluation

### Tertiary (LOW confidence)
- Multi-agent shared web novelty claims — based on survey scope only; not comprehensive
- Top 10 AI Memory Products 2026 (Medium) — community analysis
- Kore local AI memory (Show HN) — Ebbinghaus forgetting curve implementation

---

*Research completed: 2026-03-10*
*Ready for roadmap: yes*
