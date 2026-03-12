# Feature Landscape: AI Cognitive Memory Systems

**Domain:** AI-native cognitive memory architecture
**Project:** Theorex
**Researched:** 2026-03-10
**Research Mode:** Ecosystem survey — what exists vs. what Theorex uniquely does

---

## Research Basis

Systems surveyed: MemGPT/Letta, Zep/Graphiti, Mem0, Cognee, LangMem, LightRAG, MemoryBank, Memoria, MemOS.
Sources: Production documentation, academic papers (arxiv 2025), community analysis.

---

## Table Stakes

Features every production AI memory system has in 2025. Missing = product feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Persistent cross-session memory | Agents that forget every session are toys, not tools | Low | JSONL or DB log; any format |
| Semantic retrieval (vector search) | Keyword search alone fails for concept-level recall | Medium | Embedding model required |
| Memory tiering (short/long-term) | Context window is finite; history must graduate | Medium | At minimum two tiers |
| Memory write/update (not append-only) | Facts change; stale facts corrupt agent behavior | Medium | Upsert or merge logic |
| Forgetting / pruning | Unbounded growth degrades retrieval quality and latency | Medium | Time decay or size-based eviction |
| Entity extraction | Raw text → structured facts; without this, retrieval is bag-of-words | Medium | NER or LLM-assisted |
| Session boundary awareness | What happened this session vs. prior; without this, temporal reasoning breaks | Low | Session ID + timestamp |
| CLI or programmatic API | Humans must be able to inspect and debug what the AI knows | Low | Any interface |
| Graceful cold-start | System must be useful before it has history | Medium | Seed from documents or RAG bootstrap |

**Source confidence:** HIGH — all nine surveyed systems implement these. Absence from any of them is noted as a gap in comparative literature.

---

## Differentiators

Features that set the best systems apart. Not expected by default. Valued when present.

### Differentiator 1: Weighted Concept Graph (not flat key-value or vector-only)

**What it is:** Concepts as nodes with numeric weights; relationships as edges with co-occurrence strength. Activation spreads through the graph — neighbors of an important concept inherit relevance.

**Why valuable:** Vector search finds *similar things*. Graph traversal finds *connected things*. The difference matters for multi-hop reasoning ("what does this new information change about everything else I know?"). Zep's Graphiti, Cognee, and Mem0's graph variant implement this; most RAG-based systems do not.

**Theorex position:** ACTIVE/MILD/LESS tiering + numeric node IDs + weighted edges + cross-pollination is a full implementation of this pattern. The addition of PREFERRED/NEUTRAL/DISPREFERRED sentiment tiers on top of relevance is *not present in surveyed systems* — that is a genuine differentiator.

**Complexity:** High
**Dependencies:** Significance engine (must exist before edges can be weighted meaningfully)

---

### Differentiator 2: Temporal Knowledge (not static snapshots)

**What it is:** Facts are not just stored but timestamped. The system knows *when* something was true, tracks changes over time, and resolves conflicts by recency rather than overwrite.

**Why valuable:** Zep's founding insight (June 2025 blog): RAG fails when preferences change because vectors are isolated points with no temporal relationships. A user who preferred Adidas, then switched to Nike, will get the *wrong* recommendation from a RAG system because the old vector is still most similar to the query. Temporal graphs track state changes.

**Theorex position:** Exponential decay + recency scoring + ACTIVE tier promotion/demotion is a temporal system. The relevance tier architecture handles this without requiring explicit timestamps on every fact.

**Complexity:** Medium
**Dependencies:** Relevance tier system

---

### Differentiator 3: Importance-Gated Significance (not frequency-first)

**What it is:** Filtering by importance before amplifying by frequency. Frequency without importance = noise tracking.

**Why valuable:** Every surveyed system that implements memory decay uses some form of: `score = α * recency + β * frequency + γ * importance`. The weighting varies. MemoryBank and similar systems that lead with frequency accumulate noise (things mentioned often but unimportant). Theorex's explicit gate — "is this important?" before "how often?" — prevents noise amplification at ingestion.

**Theorex position:** This is the Phase 0 foundation decision. Not seen as an explicit architectural commitment in any surveyed system — they all balance factors post-hoc.

**Complexity:** High (classifier requires tuning)
**Dependencies:** None — this is the root dependency for everything else

---

### Differentiator 4: Sentiment Tiers on Concept Nodes

**What it is:** Per-concept PREFERRED/NEUTRAL/DISPREFERRED classification that cross-pollinates through edges. The AI develops *aversion* to failure patterns and *preference* for success patterns.

**Why valuable:** Surveyed systems track facts and recency. None track sentiment at the concept-graph level. LangMem's procedural memory (learned behaviors) is the closest analog, but it operates at the session/prompt level, not the node level in a graph. Theorex's sentiment spreading through edges — "a DISPREFERRED node pulls its cluster toward negative weight" — is novel in surveyed systems.

**Complexity:** High (sentiment classification + propagation logic)
**Dependencies:** Concept graph, weighted edges

---

### Differentiator 5: Moment Nodes (Permanent AI Photographs)

**What it is:** Captured moments with code references, log references, and narrative story. Never pruned, regardless of recency or frequency. Anchors history.

**Why valuable:** Episodic memory in surveyed systems (Letta's recall memory, Zep's episode tracking) is treated as a sliding window — old episodes decay or get summarized. Nothing in surveyed systems explicitly marks certain memories as *permanent anchors*. This is the difference between "I remember when" and "here is where everything started."

**Complexity:** Low (JSONL structure + permanent flag)
**Dependencies:** Short-term and long-term lobe storage

---

### Differentiator 6: Code as First-Class Memory (Codebase = Concept Web)

**What it is:** Functions as nodes, call relationships as edges, data flow as edge weight, complexity as node significance. The codebase is already a graph — Theorex maps it natively.

**Why valuable:** RAG-based code tools (Code-Graph-RAG, CodePrism, GraphRAG for devs) exist and are mature — they treat code as documents to retrieve. Theorex treats code as *memory structure*, feeding functions and call graphs directly into the concept web. The AI's memory of the code and the code's structure become the same thing.

**Complexity:** High (AST parsing, language-specific adapters needed)
**Dependencies:** Concept graph, significance engine

**Note (LOW confidence):** Code reading integrated into a living memory web rather than treated as a document corpus appears to be novel. Verify against Cognee's ECL pipeline which supports code ingestion — may overlap.

---

### Differentiator 7: Multi-Agent Shared Memory Layer

**What it is:** Nova, Iris, Qwen3, Claude all feeding the same concept web. Source weight affects significance — who generated the signal matters.

**Why valuable:** Multi-agent shared memory is an emerging area. Letta supports multi-agent architectures but agents maintain separate memory blocks. Mem0's production paper (April 2025) discusses multi-tenant isolation. No surveyed system implements *source-weighted shared concept web* where different AI agents contribute to a unified weighted graph.

**Complexity:** High (source weighting, concurrent write safety, per-agent signal normalization)
**Dependencies:** Concept graph, significance engine, shared storage layer

---

### Differentiator 8: Local-Only Embeddings with BM25 Fallback

**What it is:** LM Studio endpoint for embeddings; BM25 keyword search as graceful fallback if the embedding model is unavailable. No external API calls.

**Why valuable:** Most surveyed systems require OpenAI or another cloud embedding API. Mem0 defaults to OpenAI. Zep uses hosted embeddings. Local-only embedding is a genuine operational differentiator for users with privacy requirements or airgapped systems.

**Complexity:** Low-Medium (BM25 is mature; local LM Studio integration is straightforward)
**Dependencies:** None

---

## Anti-Features

Features to explicitly NOT build. Each has a reason and a replacement.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| RAG as retrieval pattern | Vector search returns *similar* not *relevant*; fails on temporal changes; 40% failure rate in production (Zep, 2025) | Living concept web with weighted edges; RAG kept only as cold-start bootstrap seeder |
| Equal-weight memory chunks | Flattens signal — important facts and noise stored identically | Weighted nodes with significance scores |
| Append-only memory with no decay | Unbounded growth; retrieval degrades over time; stale facts accumulate | Relevance tier demotion + pruning on LESS threshold |
| Query-then-respond pattern | Puts retrieval burden at query time; agent must ask for what it needs | Always-watching flash layer; presence not retrieval |
| Frequency-first significance | Frequently mentioned noise gets amplified; important rare events get buried | Importance gate first, frequency as amplifier only |
| Graphical UI (v1) | Adds surface area, delays core system; not needed for AI-to-AI use | CLI only; hooks integration; inspectable file formats |
| Cloud embedding APIs | External dependency; privacy concern; breaks airgapped operation | Local LM Studio / Ministral; BM25 fallback |
| Borrowed architecture from LlamaIndex/LangChain | Their assumptions embedded in their code; Theorex has no prior art to borrow | Fresh implementation; learnings only |
| Human document search UX | Humans search for documents; AI agents need ambient awareness | Flash layer for presence; no query UX in v1 |
| Session-scoped memory only | Agent loses context between sessions; feels amnesiac | Cross-session persistence; short-term graduation to long-term |
| String comparison for concepts | Synonyms fragment the graph; "ML" and "machine learning" become different nodes | Numeric IDs; synonym collapse at ingestion |
| Mutation of stored memory objects | Hidden side effects; debugging becomes impossible | Immutable patterns; new objects returned from all updates |

---

## Feature Dependencies

```
Significance Engine (Phase 0)
  └── is required by ALL other features

Concept Graph (nodes + edges)
  ├── requires: Significance Engine
  ├── enables: Relevance Tiers
  ├── enables: Sentiment Tiers
  ├── enables: Cross-Pollination / Activation Spreading
  ├── enables: Code Reading (codebase → graph)
  └── enables: Multi-Agent Shared Layer

Relevance Tiers (ACTIVE/MILD/LESS)
  ├── requires: Concept Graph
  └── enables: Auto-promotion, demotion, pruning

Sentiment Tiers (PREFERRED/NEUTRAL/DISPREFERRED)
  ├── requires: Concept Graph + Weighted Edges
  └── enables: Aversion/preference propagation

Long-Term Lobe (MEMORY.md + .theorex-meta.json)
  ├── requires: Significance Engine
  └── enables: Moment Nodes, cross-tier graduation target

Short-Term Lobe (14-day JSONL + hybrid search)
  ├── requires: Long-Term Lobe (graduation target)
  ├── requires: BM25 + local embeddings
  └── enables: Moment Nodes, session-close writes

Flash Lobe (ring buffer, context window presence)
  ├── requires: Short-Term Lobe (flush target)
  └── requires: Claude Code hooks (PostToolUse, Stop)

RAG Bootstrap Layer
  ├── requires: Concept Graph (edges to seed)
  └── requires: Local embedding endpoint

Moment Nodes
  ├── requires: Short-Term Lobe (storage)
  └── requires: Long-Term Lobe (permanent storage)

Multi-Agent Shared Layer
  ├── requires: Concept Graph (shared web target)
  └── requires: Source weighting in Significance Engine

Code Reading
  ├── requires: Concept Graph
  └── requires: Significance Engine (complexity → node weight)
```

---

## MVP Recommendation

MVP is Phase 0 + Phase 1 from the project's existing build order. It validates the core architectural bet before building the full lobe system.

**Prioritize:**
1. Significance engine — gates everything; proves the core classification approach
2. Long-term lobe — wraps existing MEMORY.md; immediately useful; validates round-trip fidelity
3. Concept web with relevance tiers — the living graph is the core differentiator; needs real-world validation early

**Defer:**
- Sentiment tiers — dependent on concept graph working well; high complexity; defer until Phase 2-3 data shows which edges matter
- Multi-agent shared layer — requires the single-agent system to be proven first; adds concurrent write complexity
- Code reading — high complexity, specialized use case; Phase 7 is correct
- RAG bootstrap — useful but not blocking; cold-start works with pure BM25 initially

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Table stakes features | HIGH | All nine surveyed systems implement these; literature confirms |
| Differentiators 1-3 (graph, temporal, importance gate) | HIGH | Confirmed by Zep, Cognee, Mem0 papers and production docs |
| Differentiators 4-5 (sentiment tiers, moment nodes) | MEDIUM | No direct comparisons found; claimed as novel based on survey scope |
| Differentiator 6 (code as memory) | MEDIUM | Code-graph tools exist but treating code graph as shared concept web is distinct; verify against Cognee ECL |
| Differentiator 7 (multi-agent shared web) | LOW | Sparse literature; multi-agent memory is emerging; source weighting on shared graph not seen in survey |
| Anti-features | HIGH | Supported by multiple sources (Zep, Letta, RAGFlow, Kin) |

---

## Sources

- [Stop Using RAG for Agent Memory — Zep, June 2025](https://blog.getzep.com/stop-using-rag-for-agent-memory/)
- [RAG is not Agent Memory — Letta](https://www.letta.com/blog/rag-vs-agent-memory)
- [Zep: State of the Art in Agent Memory](https://blog.getzep.com/state-of-the-art-agent-memory/)
- [Survey of AI Agent Memory Frameworks — Graphlit](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks)
- [Letta vs Mem0 vs Zep comparison — Medium](https://medium.com/asymptotic-spaghetti-integration/from-beta-to-battle-tested-picking-between-letta-mem0-zep-for-ai-memory-6850ca8703d1)
- [Mem0 Production-Ready AI Agents — arXiv April 2025](https://arxiv.org/abs/2504.19413)
- [Cognee AI Memory Tools Evaluation](https://www.cognee.ai/blog/deep-dives/ai-memory-tools-evaluation)
- [Graph Memory for AI Agents — Mem0, January 2026](https://mem0.ai/blog/graph-memory-solutions-ai-agents)
- [Rethinking Memory in AI: Taxonomy — arXiv May 2025](https://arxiv.org/html/2505.00675v1)
- [Cognitive Memory in Large Language Models — arXiv April 2025](https://arxiv.org/html/2504.02441v1)
- [Memory for AI Agents: A New Paradigm of Context Engineering — The New Stack](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/)
- [Beyond the Bubble: Context-Aware Memory Systems in 2025 — Tribe AI](https://www.tribe.ai/applied-ai/beyond-the-bubble-how-context-aware-memory-systems-are-changing-the-game-in-2025/)
- [LangMem SDK: Personalizing AI Agents — Analytics Vidhya](https://www.analyticsvidhya.com/blog/2025/03/langmem-sdk/)
- [Building a Graph-Based Code Analysis Engine — CodePrism](https://rustic-ai.github.io/codeprism/blog/graph-based-code-analysis-engine/)
- [Zep Temporal Knowledge Graph Architecture — Graphiti whitepaper](https://blog.getzep.com/content/files/2025/01/ZEP__USING_KNOWLEDGE_GRAPHS_TO_POWER_LLM_AGENT_MEMORY_2025011700.pdf)
- [MemGPT: Towards LLMs as Operating Systems — arXiv](https://arxiv.org/pdf/2310.08560)
- [Why Multi-Agent Systems Need Memory Engineering — O'Reilly](https://www.oreilly.com/radar/why-multi-agent-systems-need-memory-engineering/)
- [Top 10 AI Memory Products 2026 — Medium](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)
- [Show HN: Kore — local AI memory with Ebbinghaus forgetting curve](https://news.ycombinator.com/item?id=47070979)
