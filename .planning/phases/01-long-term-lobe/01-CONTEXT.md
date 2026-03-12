# Phase 1: Long-Term Lobe - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning
**Source:** cortex.md (Theorex design memory) + STATE.md decisions

<domain>
## Phase Boundary

Phase 1 delivers the living concept web and MEMORY.md management layer:
- `axon.json` — the Graphology-backed concept web with nodes (concepts) and edges (co-occurrence relationships), each carrying importance weight, relevance tier, and sentiment tier
- MEMORY.md parser — reads and writes the human/AI-readable long-term memory file with byte-identical round-trip fidelity (HARD GATE before anything else writes to long-term)
- Relevance tier engine — ACTIVE/MILD/LESS classification via exponential decay + frequency
- Sentiment tier engine — PREFERRED/NEUTRAL/DISPREFERRED with one-hop cross-pollination (0.5 dampening)
- Pruning — moves LESS nodes past 30-day threshold to data/archive/
- CLI commands: `theorex scan`, `theorex status`, `theorex ref <keyword>`, `theorex prune`

Phase 1 consumes ConceptEvent[] from Phase 0 to ingest new concepts into the web. Everything downstream (Short-Term, Flash, RAG) depends on this layer being stable.

</domain>

<decisions>
## Implementation Decisions

### Graph Library
- Graphology 0.26 — the chosen graph library for the Axon concept web
- Nodes: concepts with numeric ID, importance_weight, relevance_tier, sentiment_tier, last_seen, frequency_count
- Edges: co-occurrence relationships with strength weight
- Serialized to axon.json (Graphology's built-in serialization)

### MEMORY.md Round-Trip Fidelity — HARD GATE
- MEMORY.md round-trip fidelity is a HARD gate for Phase 1
- byte-identical test MUST pass before any other phase writes to long-term storage
- Approach: parse MEMORY.md into structured sections, write back out — result must be byte-identical to input
- Use temp file + atomic rename for writes (prevents partial state under concurrent sessions)
- Never write directly to MEMORY.md — always write to MEMORY.md.tmp then rename

### Relevance Tiers (per node)
```
ACTIVE    →  recent, frequently referenced, high signal
MILD      →  occasionally referenced, still relevant
LESS      →  old, rarely touched, fading → pruned after threshold
```
Scoring driven by:
- Recency: exponential decay (half-life configurable, default ~7 days)
- Frequency: log-normalized count
- Co-occurrence with ACTIVE neighbors (amplifies relevance)

### Sentiment Tiers (per node)
```
PREFERRED      →  patterns that work, approaches that succeed
NEUTRAL        →  starting point — everything begins here
DISPREFERRED   →  patterns that fail, approaches that cause problems
```
- Every new node starts NEUTRAL — experience moves it
- Sentiment cross-pollinates through edges: one hop, 0.5 dampening
- A DISPREFERRED node pulls connected cluster toward negative weight
- A node can be ACTIVE + DISPREFERRED (recurring problem) or LESS + PREFERRED (solution worth keeping)

### One-Hop Cross-Pollination
- `theorex ref <keyword>` activates a node
- Activation propagates to direct neighbors at 50% of original amount (0.5 dampening)
- Second-hop nodes do NOT change — strictly one hop
- This is the living relevance propagation mechanism

### Pruning
- `theorex prune` targets LESS-tier nodes past 30-day threshold
- Moves them to data/archive/ as JSONL records — NOT deleted permanently
- Removes from axon.json and MEMORY.md
- Moment nodes (Phase 5) are exempt from pruning always

### CLI Surface
- `theorex scan` — re-score all nodes (decay + tier update), MEMORY.md untouched
- `theorex status` — display all concepts as a table with tiers
- `theorex ref <keyword>` — activate a concept + one-hop propagation
- `theorex prune` — move stale LESS nodes to archive
- CLI entry point: use Bun's built-in arg parsing, not a framework

### Storage Layout
```
data/
  axon.json          — Graphology serialized concept web
  archive/           — pruned concept records (JSONL)
MEMORY.md            — human/AI readable long-term memory (never partially written)
.theorex-meta.json   — classification metadata (separate from MEMORY.md content)
```

### Ingestion from Phase 0
- `theorex scan` (or a separate ingest step) processes ConceptEvent[] from Phase 0 pipeline
- New concepts create nodes in axon.json; existing concepts update frequency + last_seen
- Co-occurring concepts in the same processText() call get edges created/strengthened

### Claude's Discretion
- Exact exponential decay formula and half-life default
- Specific ACTIVE/MILD/LESS score thresholds
- axon.json schema details (within Graphology serialization format)
- .theorex-meta.json schema
- CLI output formatting details for `theorex status`
- Whether to implement `theorex ingest <text>` as a separate command or integrate with scan

</decisions>

<specifics>
## Specific Ideas

### Concept Web Visualization (from cortex.md)
```
[Theorex:001] ←── 0.92 ──→ [significance:003]
      │                            │
    0.87                         0.78
      │                            │
[flash:002]  ←── 0.71 ──→ [frequency:004]
```

### axon.json node schema
```json
{
  "concept_id": 123456789,
  "surface_form": "machine learning",
  "importance_weight": 0.82,
  "relevance_tier": "ACTIVE",
  "sentiment_tier": "PREFERRED",
  "last_seen": "2026-03-10T00:00:00Z",
  "frequency_count": 14
}
```

### Stack
- Runtime: Bun 1.3.10 (already installed)
- Graph: Graphology 0.26
- CLI: Bun built-in arg parsing
- Storage: axon.json + MEMORY.md + data/archive/

### MEMORY.md atomic write pattern
```typescript
await Bun.write("MEMORY.md.tmp", content)
await fs.rename("MEMORY.md.tmp", "MEMORY.md")
```

</specifics>

<deferred>
## Deferred Ideas

- Cross-tier promotion from short-term to long-term → Phase 2
- Embedding-based edge seeding (RAG bootstrap) → Phase 4
- Moment nodes → Phase 5
- Multi-agent shared writes → Phase 6
- ML-tuned decay/threshold parameters → after data collection in Phases 1-2
- `theorex search` → Phase 2 (short-term lobe)

</deferred>

---

*Phase: 01-long-term-lobe*
*Context gathered: 2026-03-10 from Theorex design memory (cortex.md)*
