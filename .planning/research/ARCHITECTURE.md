# Architecture Patterns

**Project:** Theorex — AI Cognitive Memory Architecture
**Domain:** Three-lobe AI memory system with concept web
**Researched:** 2026-03-10
**Overall confidence:** HIGH (design validated against cortex.md + current ecosystem research)

---

## Recommended Architecture

Theorex is organized around five concentric layers. The significance engine sits at the center — every other component delegates to it. Data flows outward from raw input to crystallized knowledge, and inward via context injection back into the active session.

```
┌─────────────────────────────────────────────────────────┐
│                    CLAUDE CODE SESSION                   │
│                                                         │
│  ┌──────────────┐    hooks    ┌────────────────────┐   │
│  │  Flash Lobe  │ ←──────── │   Hook Dispatcher  │   │
│  │ (ring buffer)│ ──inject──→│ PostToolUse/Stop   │   │
│  └──────┬───────┘            └────────────────────┘   │
│         │ flush on Stop                                  │
└─────────┼───────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│              SIGNIFICANCE ENGINE                         │
│                                                         │
│  raw text → ConceptExtractor → ImportanceGate           │
│                                    │                    │
│                              FrequencyAmplifier         │
│                                    │                    │
│                            CompositeSignal              │
│                         (score: 0.0 – 1.0)              │
└──────────┬──────────────────────────────────────────────┘
           │ scored concept events
           ▼
┌─────────────────────────────────────────────────────────┐
│                   CONCEPT WEB (Axon)                    │
│                                                         │
│  Nodes: { id, label[], relevance, sentiment, tier }     │
│  Edges: { from, to, strength, last_seen }               │
│                                                         │
│  CrossPollinator: activation spreads through edges      │
│  DecayRunner:    exponential decay on idle nodes        │
│  TierClassifier: ACTIVE / MILD / LESS assignment        │
└──────────┬──────────────────────────────────────────────┘
           │ graduates + moment nodes
           ▼
┌──────────────────────┐     ┌──────────────────────────┐
│    Short-Term Lobe   │────▶│       Long-Term Lobe     │
│  (14-day JSONL log)  │     │  MEMORY.md + meta.json   │
│  BM25 + vector search│     │  Axon map (axon.json)    │
│  ACTIVE/MILD/LESS    │     │  Moment nodes (permanent)│
└──────────────────────┘     └──────────────────────────┘
           ▲
           │ cold-start seeding
┌──────────────────────┐
│   RAG Bootstrap      │
│  (embed → neighbors  │
│   → seed weak edges) │
└──────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Reads From | Writes To | Communicates With |
|-----------|---------------|-----------|----------|-------------------|
| **Hook Dispatcher** | Captures tool events and session lifecycle | Claude Code stdin (JSON) | Flash ring buffer (append) | Flash Lobe only |
| **Flash Lobe** | Per-session ring buffer; presence not retrieval | Hook Dispatcher | `~/.theorex/flash/{session-id}.jsonl` | Significance Engine (on flush), Hook Dispatcher (on inject) |
| **Significance Engine** | Importance gate then frequency amplifier; outputs composite score | Raw text / concept events | Concept Web node scores | Concept Web, Short-Term, Flash |
| **ConceptExtractor** | Tokenize text → numeric IDs; collapse synonyms | Raw text | `concepts.json` registry | Significance Engine |
| **ImportanceGate** | Binary yes/no: is this concept worth tracking? | Concept + context | Gate decision | FrequencyAmplifier |
| **FrequencyAmplifier** | Log-normalized count; confirms importance over time | Gate output + historical counts | Updated node frequency | CompositeSignal |
| **CompositeSignal** | Merge importance + frequency → 0.0–1.0 score | Gate + frequency | Node score update | Concept Web |
| **Concept Web (Axon)** | Graph of concepts; propagates activation; decays edges | Significance Engine | `axon.json` | CrossPollinator, DecayRunner, TierClassifier |
| **CrossPollinator** | Spread relevance change to neighbor nodes via edge weights | Axon edges | Neighbor node scores | Concept Web |
| **DecayRunner** | Scheduled exponential decay on all nodes | Axon nodes (last_seen) | Node relevance scores | TierClassifier |
| **TierClassifier** | Assign ACTIVE/MILD/LESS based on score | Node composite score | Node tier field | Short-Term (for pruning), Long-Term (for graduation) |
| **SentimentUpdater** | Move node PREFERRED/NEUTRAL/DISPREFERRED based on outcomes | Outcome signals | Node sentiment field | CrossPollinator (sentiment propagates) |
| **Short-Term Lobe** | 14-day rolling session log; hybrid search | Flash flush output | `sessions/{date}.jsonl` | Long-Term (graduation), Significance Engine (frequency lookups) |
| **BM25Index** | Keyword search over JSONL log | Session JSONL | In-memory index | Short-Term search queries |
| **VectorIndex** | Semantic search via local embeddings | Session JSONL + LM Studio | In-memory vectors | Short-Term search queries |
| **Long-Term Lobe** | Stable crystallized knowledge; never broken | Short-Term graduates + Moment nodes | `MEMORY.md`, `.theorex-meta.json`, `axon.json` | All lobes (source of truth) |
| **MEMORY.md Parser** | Round-trip fidelity parse/write; preserves exact format | `MEMORY.md` | `MEMORY.md` | Long-Term Lobe |
| **Moment Node Store** | Permanent AI photographs; never pruned | CLI input + auto-capture | `moments/{id}.json` | Long-Term Lobe |
| **RAG Bootstrap** | Cold-start edge seeder for new concepts | New concept + LM Studio embeddings | Weak initial Axon edges | Concept Web |
| **CLI** | Human interface: scan / status / search / ref / prune / graduate | All lobes | Orchestrates writes | All components |
| **PM2 Maintenance Runner** | Scheduled: decay, prune, graduate every 6 hours | Concept Web + Short-Term | Pruned/promoted data | DecayRunner, TierClassifier |

---

## Data Flow Direction

### Inbound flow (new information enters the system)

```
External event (tool use / user prompt / AI observation)
    │
    ▼
Hook Dispatcher (PostToolUse / UserPromptSubmit)
    │  async: true — non-blocking, < 1ms hand-off
    ▼
Flash Lobe  →  append to ring buffer (per-session JSONL)
    │
    │  on Stop hook (session end)
    ▼
Flush: significant flash events sent to Significance Engine
    │
    ▼
ConceptExtractor  →  ImportanceGate  →  FrequencyAmplifier  →  CompositeSignal
    │                                                              │
    │                                                              ▼
    │                                                    Concept Web update
    │                                                         │
    │                                              CrossPollinator fires
    │                                         (neighbor scores updated via edges)
    │
    ▼
Short-Term Lobe  →  append to sessions/{date}.jsonl
    │
    │  if ACTIVE for 7+ consecutive days
    ▼
Long-Term Lobe  →  MEMORY.md + .theorex-meta.json + axon.json update
```

### Outbound flow (context injected back into session)

```
SessionStart hook
    │
    ▼
Long-Term Lobe  →  read ACTIVE nodes from axon.json
Short-Term Lobe  →  BM25 + vector query for recent context
Flash Lobe      →  restore last session's ring buffer (if resuming)
    │
    ▼
additionalContext payload assembled
    │
    ▼
hookSpecificOutput.additionalContext  →  injected into Claude Code context
```

### Cross-pollination flow (relevance propagates through graph)

```
Node N receives score update (Δ = +0.3)
    │
    ▼
CrossPollinator: for each edge (N → M) with strength w
    M.relevance += Δ * w * damping_factor    (damping: 0.5 default)
    │
    ▼
Recurse one hop (not unbounded — 1 hop only to prevent runaway propagation)
    │
    ▼
TierClassifier re-evaluates M's tier
```

### Decay flow (scheduled, every 6 hours via PM2)

```
DecayRunner reads all nodes from axon.json
    │
    ▼
For each node N:
    Δt = now - N.last_seen
    N.relevance = N.relevance * e^(-λ * Δt)   [λ from half-life config]
    │
    ▼
TierClassifier:
    score > 0.65  →  ACTIVE
    0.35–0.65     →  MILD
    0.15–0.35     →  LESS (warn)
    < 0.15        →  prune (unless Moment Node or long-term crystallized)
    │
    ▼
Write updated axon.json (immutable: new object, not mutation)
```

---

## Significance Engine — Central Hub

The significance engine is the only component every other component depends on. It cannot depend on any lobe. Build order rule: significance engine ships first, everything else after.

```
Significance Engine Internals:

Input:  raw text segment + context (tool name, session ID, source agent)
        │
        ▼
ConceptExtractor
  - tokenize + normalize
  - resolve synonyms to canonical numeric ID
  - create new node if ID unseen (starts NEUTRAL, score 0.0)
        │
        ▼
ImportanceGate  [binary classifier]
  - signal features: semantic density, novelty vs known concepts,
    source agent weight, explicit AI signals ("this matters", "remember")
  - PASS: proceeds to frequency amplifier
  - FAIL: recorded as seen but score remains 0.0 (noise floor)
        │ (PASS only)
        ▼
FrequencyAmplifier
  - freq_score = log(1 + n_occurrences) / log(1 + max_occurrences)
  - prevents noise amplification: freq only matters after importance gate passes
        │
        ▼
CompositeSignal
  - composite = (importance_weight * gate_confidence) + (freq_weight * freq_score)
  - default weights: importance 0.7, frequency 0.3
  - output: 0.0–1.0 normalized score
        │
        ▼
Node update → Concept Web → CrossPollinator
```

**Confidence:** HIGH — this design is validated by Titans architecture research (novel signal → selective memory update), Mem0 research (importance-first extraction), and the project's own cortex.md specification.

---

## Patterns to Follow

### Pattern 1: Async Hook with Immediate Enqueue

**What:** PostToolUse hook runs with `async: true`. It reads stdin JSON and writes to a local queue file in < 1ms, then exits. A separate Bun worker drains the queue asynchronously.

**When:** Any hook that needs to do non-trivial work (significance scoring, embedding calls). Keeps Claude Code responsive.

**Why verified:** Claude Code docs confirm `async: true` hooks deliver `additionalContext` on the next conversation turn. This pattern is production-validated by claude-mem. Hook synchronous budget is effectively zero for complex processing.

```
[PostToolUse hook script]
  read stdin → append raw JSON to ~/.theorex/queue/{session-id}.jsonl
  exit 0  (< 1ms)

[Bun worker, always running via PM2]
  watch queue directory → drain events → significance engine → axon update
```

### Pattern 2: Per-Session Flash File

**What:** Each Claude Code session gets its own flash file at `~/.theorex/flash/{session-id}.jsonl`. Session ID from hook JSON input (`session_id` field).

**When:** Always. Per-session isolation prevents concurrent write corruption when multiple Claude Code instances run simultaneously.

**Why:** Multiple Claude Code windows running on M4 Pro simultaneously. Shared flash file = race condition. Per-session files = safe concurrent writes, trivial merge on SessionEnd.

### Pattern 3: Immutable Graph Updates

**What:** Every Axon update produces a new `axon.json` (or node patch object). Never mutate in place.

**When:** All Concept Web writes.

**Why:** Mandated by project coding style. Also enables diffing for debugging and rollback. JSONL append-only for short-term log achieves the same immutability for that tier.

### Pattern 4: Synonym Collapse at Extraction Time

**What:** ConceptExtractor maps surface forms to canonical numeric IDs before any scoring happens. "ML" and "machine learning" resolve to the same node ID.

**When:** ConceptExtractor, always.

**Why:** Graph math works on IDs. String comparison across synonyms breaks relevance accumulation. Score stays in one node rather than split across variants.

### Pattern 5: Decay Runs on Read (Lazy) + Scheduled (Eager)

**What:** Node scores are updated eagerly by the PM2 runner every 6 hours. But reads also apply elapsed decay before returning a score.

**When:** TierClassifier, any search returning node relevance.

**Why:** 6-hour batch keeps background processing minimal. Lazy correction ensures a search at hour 5 doesn't return a stale ACTIVE tier for a node that has actually decayed to LESS.

### Pattern 6: One-Hop Activation Propagation with Damping

**What:** When a node's relevance changes, CrossPollinator updates direct neighbors only (1 hop). Damping factor (0.5 default) scales the propagation.

**When:** Every node score change.

**Why:** Unbounded multi-hop propagation floods the graph and destroys tier meaning. One hop is sufficient for the "cross-pollination" effect — related concepts become relevant when a concept fires. Two-hop would cause all transitively connected nodes to inflate.

### Pattern 7: RAG as Bootstrap Only, Not Retrieval

**What:** When a new concept node is created, embed it and query LM Studio for nearest neighbors. Seed edges to neighbors at weight 0.1–0.2 (weak). Usage then confirms or dissolves these seed edges.

**When:** Only on new node creation (no prior edges exist).

**Why:** Pure RAG retrieval discarded — retrieval-on-query conflicts with "always-alive web" model. Bootstrap edges solve the cold-start problem: without them, day-one concepts are isolated nodes with no graph connectivity.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Synchronous Hook for Significance Scoring

**What goes wrong:** Hook calls significance engine inline, blocks Claude Code for 5–30 seconds while scoring and embedding run.
**Why bad:** Breaks Claude Code UX. Users experience multi-second freezes on every tool use.
**Instead:** Hook enqueues raw event (< 1ms), Bun worker processes async. Context arrives on next turn via `additionalContext`.

### Anti-Pattern 2: Shared Mutable Flash File

**What goes wrong:** Multiple Claude Code sessions write to same `flash.jsonl`. Concurrent appends corrupt the file or lose events.
**Why bad:** Non-deterministic data loss.
**Instead:** Per-session flash files keyed by `session_id` from hook JSON input.

### Anti-Pattern 3: Frequency Before Importance

**What goes wrong:** Track everything that appears frequently regardless of importance. Result: common noise words ("the", "and", error messages from boilerplate) accumulate high frequency scores.
**Why bad:** Noise floods the concept web. Signal-to-noise collapses. The graph becomes meaningless.
**Instead:** ImportanceGate blocks the FrequencyAmplifier. Frequency only amplifies importance — it never creates it.

### Anti-Pattern 4: Multi-Hop Unbounded Propagation

**What goes wrong:** When node A fires, propagate to neighbors, then propagate from neighbors to their neighbors, recursively.
**Why bad:** Any large graph becomes fully activated after a few propagation steps. ACTIVE tier loses discrimination.
**Instead:** One hop only. Damped. Neighbors inherit relevance, not neighbors-of-neighbors.

### Anti-Pattern 5: Embedding-Gated Search with No BM25 Fallback

**What goes wrong:** Short-term search requires LM Studio embedding endpoint. LM Studio is down. Search returns nothing.
**Why bad:** Memory becomes inaccessible whenever the local model is unavailable.
**Instead:** BM25 is the always-available baseline. Vector search augments when embeddings are reachable. Graceful degradation is required.

### Anti-Pattern 6: MEMORY.md as Classification Store

**What goes wrong:** Writing relevance scores, sentiment tiers, and concept IDs into MEMORY.md alongside human-readable content.
**Why bad:** Breaks human/AI readability. Conflicts with MEMORY.md format constraints. Risks losing classification data on manual MEMORY.md edits.
**Instead:** Classification metadata lives exclusively in `.theorex-meta.json`. MEMORY.md stays human/AI readable in its original format. The two files are linked by concept labels, not embedded metadata.

### Anti-Pattern 7: Pruning Moment Nodes

**What goes wrong:** Decay runner reaches a Moment Node with low recency score and marks it for pruning.
**Why bad:** Moment nodes are the system's history. Losing them loses the narrative of how the AI ecosystem evolved.
**Instead:** Moment Nodes have an `is_permanent: true` flag checked before any pruning or decay score is applied. They exist outside the tier system.

---

## Build Order Implications

The dependency graph is strict. Each phase must fully ship before the next.

```
Phase 0: Significance Engine
  - ConceptExtractor (numeric IDs, synonym collapse)
  - ImportanceGate (binary classifier)
  - FrequencyAmplifier (log-normalized)
  - CompositeSignal (0.0–1.0 output)
  - No storage yet — pure function pipeline
  WHY FIRST: Every other component calls this. Cannot be partial.

Phase 1: Long-Term Lobe
  - MEMORY.md parser (round-trip fidelity, immutable write)
  - .theorex-meta.json schema + read/write
  - Axon graph store (axon.json, immutable node/edge ops)
  - TierClassifier + SentimentUpdater (no decay yet)
  WHY SECOND: Foundation store. Short-term graduates here. Flash flushes here.

Phase 2: Short-Term Lobe
  - sessions/{date}.jsonl append
  - BM25Index (in-memory, rebuilt from JSONL on startup)
  - VectorIndex (LM Studio embeddings, graceful fallback)
  - Graduation logic (7-day ACTIVE threshold → Long-Term)
  - 14-day pruning
  WHY THIRD: Requires significance engine (to score inbound) and long-term (to graduate into).

Phase 3: Flash Lobe + Hook Dispatcher
  - Per-session flash file ({session-id}.jsonl)
  - Ring buffer logic (N-event window)
  - PostToolUse hook (async: true, enqueue only)
  - Stop hook (flush to short-term + significance engine)
  - SessionStart hook (inject ACTIVE context via additionalContext)
  WHY FOURTH: Requires short-term (flush destination) and significance engine (flush scoring).

Phase 4: RAG Bootstrap Layer
  - LM Studio embedding client (with BM25 fallback)
  - Nearest-neighbor query on new concept creation
  - Weak edge seeding (0.1–0.2 initial weight)
  WHY FOURTH/FIFTH: Non-critical path. System works without it (cold-start nodes just have no edges initially). Bootstrap layer improves day-one graph quality.

Phase 5: Moment Nodes
  - moments/{id}.json schema
  - CLI capture command
  - Auto-capture hooks for significant session events
  - Permanent flag (bypass decay, bypass pruning)
  WHY FIFTH: Requires stable long-term lobe to anchor into. Lower priority than live memory flow.

Phase 6: AI Family Shared Layer
  - Source weight per agent (Claude vs Nova vs Iris vs Qwen3)
  - Shared axon.json with agent attribution on edges
  - Input adapters per agent type (conversation vs market data vs logs vs code)
  WHY SIXTH: Complex multi-producer coordination. Requires all single-agent paths stable first.

Phase 7: Code Reading
  - AST parser (Bun / TypeScript native)
  - Function → node, call → edge, complexity → significance
  - Codebase ingest as concept web
  WHY LAST: Standalone feature. Depends on everything else but nothing depends on it.
```

---

## Scalability Considerations

| Concern | At 1K nodes | At 100K nodes | At 1M nodes |
|---------|-------------|---------------|-------------|
| Axon graph size | Single JSON file, fine | JSON file gets large (>10MB), switch to JSONL-per-node or SQLite | SQLite required, JSON untenable |
| CrossPollinator | Single-hop scan is O(edges), fast | O(edges) still manageable if avg degree < 20 | Degree bounding required |
| BM25Index rebuild | In-memory from JSONL, < 100ms | Rebuild takes seconds, consider incremental index | Offline index with periodic full rebuild |
| VectorIndex | All vectors in memory, fine | Needs approximate nearest neighbor (already using embedding similarity, not exact search) | Chunked index or dedicated vector store |
| Flash ring buffer | N=50 events, trivial | N unchanged — ring buffer is bounded by design | N unchanged |
| PM2 maintenance run | 6-hour cycle, < 1 second | 6-hour cycle, seconds | May need distributed decay or longer cycle |

For v1 (M4 Pro, single user), the JSON + JSONL flat-file architecture is correct. No database required until concept web exceeds ~50K nodes.

---

## How the Significance Engine Connects to Everything

The significance engine is the hub. Every data-generating event passes through it.

```
SIGNIFICANCE ENGINE: Central Connection Map

Flash Lobe ──────────────────────────────────────▶ Significance Engine
  (flush on Stop: raw events scored before short-term write)

Short-Term Lobe ─────────────────────────────────▶ Significance Engine
  (frequency lookups: how often has this concept appeared in 14-day log?)

RAG Bootstrap ───────────────────────────────────▶ Significance Engine
  (new node: trigger cold-start edge seeding after ID assigned)

Concept Web ─────────────────────────────────────▶ Significance Engine
  (reads composite scores; Significance Engine writes node score updates)

CLI (theorex scan) ──────────────────────────────▶ Significance Engine
  (manual ingestion: run significance pipeline over new content)

AI Family agents ────────────────────────────────▶ Significance Engine
  (each agent's observations scored; source weight modifies gate threshold)

Significance Engine ─────────────────────────────▶ Concept Web
  (output: scored concept events update node relevance + trigger CrossPollinator)

Significance Engine ─────────────────────────────▶ Short-Term Lobe
  (output: scored events written with composite score attached)
```

Nothing bypasses the significance engine. If a piece of information doesn't pass through it, it doesn't enter the concept web.

---

## File Layout (Component-to-File Mapping)

```
~/theorex/
  src/
    significance/
      concept-extractor.ts       # tokenize → numeric IDs → synonym collapse
      importance-gate.ts         # binary yes/no classifier
      frequency-amplifier.ts     # log-normalized count
      composite-signal.ts        # merge importance + frequency → 0.0–1.0
      index.ts                   # public API: score(text, context) → ScoredEvent[]

    concept-web/
      axon-store.ts              # read/write axon.json (immutable ops)
      cross-pollinator.ts        # 1-hop activation spread with damping
      decay-runner.ts            # exponential decay scheduler
      tier-classifier.ts         # ACTIVE/MILD/LESS assignment
      sentiment-updater.ts       # PREFERRED/NEUTRAL/DISPREFERRED
      index.ts

    lobes/
      flash/
        ring-buffer.ts           # per-session JSONL ring buffer
        hook-dispatcher.ts       # PostToolUse + Stop + SessionStart handlers
        injector.ts              # assemble additionalContext payload
        index.ts

      short-term/
        session-log.ts           # append to sessions/{date}.jsonl
        bm25-index.ts            # in-memory BM25, rebuilt from JSONL
        vector-index.ts          # LM Studio embeddings + similarity
        search.ts                # hybrid query: BM25 + vector, RRF merge
        graduation.ts            # 7-day ACTIVE threshold → long-term
        pruner.ts                # 14-day cleanup
        index.ts

      long-term/
        memory-md.ts             # round-trip parse/write MEMORY.md
        meta-store.ts            # .theorex-meta.json read/write
        moment-store.ts          # moments/{id}.json (permanent nodes)
        index.ts

    rag-bootstrap/
      embedder.ts                # LM Studio client + BM25 fallback
      edge-seeder.ts             # nearest-neighbor → weak Axon edges
      index.ts

    ai-family/
      adapters/                  # per-agent input adapters
        nova-adapter.ts
        iris-adapter.ts
        qwen-adapter.ts
      source-weight.ts           # per-agent gate threshold modifier
      index.ts

    code-reading/
      ast-parser.ts              # function=node, call=edge, complexity=sig
      ingester.ts                # codebase → concept web
      index.ts

    cli/
      commands/
        scan.ts
        status.ts
        search.ts
        ref.ts
        prune.ts
        graduate.ts
      index.ts

  data/
    axon.json                    # concept web (nodes + edges)
    concepts.json                # numeric ID registry
    flash/                       # per-session ring buffers
    sessions/                    # 14-day JSONL session log
    moments/                     # permanent AI photographs

  hooks/
    post-tool-use.sh             # async: true — enqueues raw event
    stop.sh                      # flushes flash → significance pipeline
    session-start.sh             # injects context via additionalContext
```

---

## Sources

- cortex.md (project specification) — HIGH confidence
- [Memory in the Age of AI Agents (Tsinghua, Dec 2025)](https://arxiv.org/abs/2512.13564) — HIGH confidence
- [CortexGraph — temporal decay formula, promotion thresholds, two-tier JSONL/Markdown architecture](https://github.com/prefrontal-systems/cortexgraph) — HIGH confidence (official repo)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — HIGH confidence (official docs, verified directly)
- [Async hooks pattern for memory systems (claude-mem)](https://docs.claude-mem.ai/hooks-architecture) — MEDIUM confidence
- [Titans architecture — novelty signal as importance gate](https://research.google/blog/titans-miras-helping-ai-have-long-term-memory/) — HIGH confidence
- [Mem0 — importance-first extraction, composite signal](https://arxiv.org/pdf/2504.19413) — HIGH confidence
- [Hybrid BM25 + vector search patterns](https://dev.to/jakob_sandstrm_a11b3056c/vector-search-is-not-enough-why-i-added-bm25-hybrid-search-to-my-ai-memory-server-3h3l) — MEDIUM confidence
- [Redis — tiered memory promotion/demotion in AI agents](https://redis.io/blog/ai-agent-memory-stateful-systems/) — MEDIUM confidence
- [AI Agent Memory Architecture survey (letsdatascience.com)](https://www.letsdatascience.com/blog/ai-agent-memory-architecture) — MEDIUM confidence
