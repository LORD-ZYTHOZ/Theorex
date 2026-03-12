# Domain Pitfalls: AI Cognitive Memory Architecture

**Domain:** AI memory system (concept graph + relevance scoring + multi-lobe storage)
**Project:** Theorex
**Researched:** 2026-03-10
**Overall Confidence:** MEDIUM-HIGH (training data + multiple corroborating search sources; no single authoritative reference for this exact architecture)

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or architectural dead ends.

---

### Pitfall 1: Significance Scoring That Amplifies Noise Instead of Signal

**What goes wrong:**
The significance engine gets the order wrong — frequency runs before importance, so high-frequency noise (common words, repeated tool calls, boilerplate patterns) accumulates weight. The concept web fills with low-value nodes at ACTIVE tier while genuinely important but infrequent concepts sit at LESS.

**Why it happens:**
Frequency is easy to measure; importance is hard. Teams reach for frequency counters first because they produce visible output quickly. The bug is not in the counter — it is in calling frequency a proxy for importance when it is only a confirming signal.

**Consequences:**
- Concept web nodes representing noise outrank signal nodes
- Cross-pollination spreads noise relevance to neighboring clusters
- Flash context fills with meaningless activations
- Long-term memory graduates noise into crystallized knowledge (MEMORY.md contamination)
- Trust in the system collapses — AI reports irrelevant concepts as important

**Warning signs:**
- High-frequency stop words or tool names (Bash, Read, Write) appearing in ACTIVE tier
- Concept graph edges between unrelated but co-occurring tokens
- Flash context containing infrastructure concepts (file paths, timestamps) instead of domain concepts
- Significance scores that correlate with raw occurrence count, not with outcome quality

**Prevention:**
- Implement the importance gate as a strict prerequisite: a concept must pass importance classification before any frequency counting begins. Code the gate as a separate, required step — not a flag.
- Keep an explicit low-importance list (stop words, tool names, structural tokens) that cannot graduate regardless of frequency
- Score importance based on: concept novelty, outcome association, human/AI explicit signal, not corpus frequency
- Write tests that verify a 1000x-repeated unimportant concept still scores lower than a once-encountered confirmed important concept

**Phase that must address it:** Phase 0 (Significance Engine) — this is the foundation everything else inherits. Getting it wrong here invalidates all downstream phases.

---

### Pitfall 2: Graph Relevance Decay That Produces Wrong Results

**What goes wrong:**
A single exponential decay function with one time constant is applied uniformly to all nodes. Cognitive research shows biological memory uses multiple parallel time constants, not one. The result: recent unimportant events score higher than older critical ones; Moment nodes decay away; foundational concepts that are rarely referenced but are always true fade below the LESS threshold.

**Why it happens:**
Exponential decay is mathematically clean and easy to implement. Developers pick a half-life (e.g., 30 days) and apply it globally without distinguishing node type.

**Consequences:**
- Moment nodes (permanent by design) get pruned if decay is applied naively
- Foundational system concepts (e.g., "Bun runtime", "MEMORY.md") fade despite being perpetually relevant
- Short-lived context (a specific error message) inflates to high relevance because it just occurred
- Pruning logic removes nodes that should survive, keeping noise that is merely recent

**Warning signs:**
- System concepts with known high importance appearing at MILD or LESS tier after time passes
- Moment nodes appearing in prune candidates
- Relevance scores that track recency perfectly (r ≈ 1.0 with time) regardless of importance
- "Why did this get pruned?" questions that cannot be answered by the decay formula alone

**Prevention:**
- Decay is type-aware. Moment nodes: no decay, ever. Long-term crystallized nodes: very slow decay (half-life measured in months). Short-term session nodes: fast decay (days).
- Combine recency with importance: `relevance = importance_score * recency_factor + base_floor`. The base_floor prevents decay to zero for nodes above an importance threshold.
- Run a "would prune" simulation in tests before enabling live pruning. Assert that known-important nodes survive N decay cycles.
- Implement decay as a pure function that takes node type as an explicit parameter — prevents uniform application.

**Phase that must address it:** Phase 0 (relevance tier logic), reinforced in Phase 1 (long-term pruning) and Phase 5 (Moment nodes — must explicitly mark as decay-exempt).

---

### Pitfall 3: Context Injection That Bloats the Context Window

**What goes wrong:**
Flash memory injects too much. Every active concept, every short-term entry above MILD tier, every moment node — all pushed into the context window each session. The context window fills with memory scaffolding instead of task-relevant signal. This is "context stuffing": performance degrades, latency rises, and the model's effective attention on middle-of-context content drops sharply.

**Why it happens:**
"More context = more informed AI" feels correct. Injecting everything available seems safer than leaving something out. But research confirms context rot: as injected tokens increase, recall accuracy for specific items decreases. The model drowns in its own memory.

**Consequences:**
- Flash file grows unboundedly per session if not ring-buffered correctly
- Each tool use appends to flash, and the PostToolUse hook fires on every operation — even trivial reads
- 400K token context windows invite "just inject it all" thinking that destroys inference quality
- Prompt injection attack surface scales with context length — 200K tokens of memory is 200K tokens of potential injection surface

**Warning signs:**
- Flash file size approaching 10K+ tokens per session
- Concepts injected into flash that have no relevance to the current task
- Inference latency increasing across sessions despite no code changes
- AI responses that reference old memories instead of responding to current input

**Prevention:**
- Flash is a ring buffer with a hard token ceiling (recommended: 2,000-4,000 tokens for flash content). Not soft limit. Hard cap.
- Inject selectively: only concepts with direct co-occurrence with the current session's active concepts. Not everything above MILD. Only what is task-relevant.
- The flash file is not a dump — it is a curated view. Curation logic runs at write time (PostToolUse), not at read time (session load).
- Log flash token count per session in tests. Alert if it crosses 3,000 tokens. Fail CI if it crosses the hard cap.
- Never inject Moment nodes automatically — they are accessible on query, not ambient context.

**Phase that must address it:** Phase 3 (Flash Lobe) is the primary phase, but Phase 0 must define the token budget constraint upfront so Phase 3 is built within it.

---

### Pitfall 4: Round-Trip Fidelity Failures When Reading and Writing MEMORY.md

**What goes wrong:**
Theorex reads MEMORY.md, parses it into internal structures, modifies classifications, then writes it back. The write does not produce byte-identical output to the original for unchanged sections. Blank lines shift, heading levels change, list formatting normalizes differently across parsers, or metadata sections appear in a different order. The human-readable format that Claude Code relies on breaks.

**Why it happens:**
Markdown has no canonical parse-and-serialize round-trip. Different parsers handle edge cases differently (trailing spaces, soft line breaks, blank lines in lists). A parser that reads correctly may not serialize back to the original byte sequence. The existing MEMORY.md was hand-authored with human conventions; a programmatic writer follows spec, not convention.

**Consequences:**
- Claude Code reads its own MEMORY.md and finds garbled or reorganized content
- Future Claude Code sessions get degraded context because key sections moved or were lost
- Human inspection of MEMORY.md reveals unexpected formatting changes, breaking trust in the tool
- Diff noise in git history makes every Theorex write look like a massive change even when only metadata updated

**Warning signs:**
- Any difference between the original file and a parse-then-serialize round trip of unchanged content
- Heading levels shifting (e.g., `##` becoming `###`)
- List items losing or gaining blank lines between them
- Trailing spaces added or removed
- Section order changing between reads and writes

**Prevention:**
- Never parse MEMORY.md with a general markdown parser. Use a section-boundary parser: split on headings, treat each section's content as an opaque string, only rewrite the specific lines that changed.
- Write unit tests that: (1) read MEMORY.md, (2) immediately write it back without changes, (3) assert the output is byte-identical to the input. This test must pass before any phase that touches MEMORY.md goes to code review.
- Store metadata in `.theorex-meta.json`, not in MEMORY.md. MEMORY.md changes should be additive only (new sections, new entries) — never structural rewrites.
- If a section must be updated, replace only that section's content string. Use line-range targeting, not full-document serialization.

**Phase that must address it:** Phase 1 (Long-Term Lobe) — this phase wraps MEMORY.md. Round-trip fidelity must be proven before any other phase writes to long-term storage.

---

### Pitfall 5: Embedding Cold-Start Failure Before Experience Builds the Graph

**What goes wrong:**
On day one, Theorex has no concept web. A new concept arrives, is embedded, and the similarity search for initial edge seeding returns neighbors that are semantically near in the embedding space but contextually wrong for this AI ecosystem. The seeded edges are plausible but false — they import relationships from the embedding model's training distribution, not from the actual usage patterns of this system.

**Why it happens:**
Embedding similarity is domain-agnostic. "Ministral" the AI model and "minister" the government official may be far apart, but "flash" (memory lobe) and "flash" (storage format) are close. Cold-start edge seeding trusts the embedding's neighbor list as ground truth when it is only a rough prior.

**Consequences:**
- The concept web starts with wrong edges weighted at 0.3-0.5 (non-trivial)
- Cross-pollination spreads along these wrong edges
- Early sessions propagate relevance through incorrect relationships
- By the time usage data could correct the edges, the wrong edges have already influenced tier assignments
- BM25 fallback (when LM Studio is unavailable) provides no semantic edges at all — cold-start produces an empty graph

**Warning signs:**
- New concepts immediately appearing in wrong relevance clusters
- Concepts connected to thematically unrelated neighbors after embedding seed
- Any seeded edge that persists for 10+ sessions without a co-occurrence event should be suspect
- BM25-fallback sessions producing concept isolation (no edges) for new concepts

**Prevention:**
- Seed edges from embedding at weight 0.1-0.15 maximum — explicitly low. Label them `type: seeded` to distinguish from `type: observed`.
- Seeded edges decay 3x faster than observed edges. They dissolve if usage doesn't confirm them within N sessions.
- BM25 fallback path must be tested explicitly: what does the concept graph look like after 10 sessions of BM25-only operation? Assert it is functional, not empty.
- Write a cold-start integration test: create a fresh graph, ingest 5 sessions, assert that concept relationships reflect session content, not embedding prior.

**Phase that must address it:** Phase 4 (RAG Bootstrap Layer). Phase 0 should define the seeded vs. observed edge distinction as a data contract so Phase 4 implements correctly.

---

### Pitfall 6: Claude Code Hooks Breaking Existing Integrations

**What goes wrong:**
Theorex adds PostToolUse and Stop hooks to `~/.claude/`. These hooks execute on every matching tool use across all Claude Code sessions — not just Theorex-related ones. A bug in a Theorex hook (non-zero exit code, malformed JSON to stdout, long execution time) silently breaks or degrades all Claude Code operations.

**Why it happens:**
Claude Code hooks are global. Hooks in `~/.claude/settings.json` fire for all projects. A hook that writes to flash memory unconditionally will execute during unrelated sessions. Known bugs in the Claude Code hook system include: hooks failing to fire in subdirectories (v2.0.27), shell startup output (e.g., conda activation, zshrc welcome messages) prepending to hook stdout and breaking JSON parsing, and PascalCase tool name matching requirements being non-obvious.

**Consequences:**
- Existing MEMORY.md-based workflows break if a Theorex hook corrupts its output
- Claude Code sessions in other projects experience latency from flash write operations
- A crash in the Theorex hook daemon (if any) causes every PostToolUse to fail silently
- JSON parse errors from shell startup output cause hooks to produce no output — invisible failure

**Warning signs:**
- Claude Code sessions in non-Theorex directories showing unexpected latency
- Hook not firing at all (usually: not executable, wrong tool name case, or shell startup output corruption)
- Flash file written with content from unrelated projects
- MEMORY.md modified by hooks running in wrong project context

**Prevention:**
- Every Theorex hook script must be project-scoped: check working directory or an environment variable at the top, exit 0 immediately if not in a Theorex session.
- Hook scripts must suppress all shell startup output. Use `#!/usr/bin/env -S bun --quiet` or equivalent to prevent zshrc output contamination.
- Test hooks with `chmod +x` explicitly in the setup documentation.
- Hooks must exit within 500ms. Any operation that might take longer (disk write, process spawn) must be async fire-and-forget. Never block the hook thread.
- Implement a dead-man switch: if the flash write fails, log to a separate error file, exit 0. Never exit non-zero from a PostToolUse hook unless you intend to block Claude Code's operation.
- Run integration tests that verify the hook produces valid JSON on stdout with zero shell preamble.

**Phase that must address it:** Phase 3 (Flash Lobe, hooks integration). The additive-only contract must be proven before hooks touch any global Claude Code configuration.

---

## Moderate Pitfalls

Mistakes that cause incorrect behavior or significant rework, but not full rewrites.

---

### Pitfall 7: Cross-Pollination Creating Relevance Feedback Loops

**What goes wrong:**
Activation propagates from a highly-relevant node through edges to neighbors, increasing their relevance. Those neighbors then propagate back to the original node and to each other. In a dense cluster, every node in the cluster inflates every other. Loop gain exceeds 1.0 and the cluster diverges — all concepts in the cluster approach maximum relevance regardless of actual usage.

**Why it happens:**
Graph propagation without dampening is a positive feedback loop. If node A raises B by 0.1, and B raises A by 0.1, and they share 10 common neighbors doing the same, the cluster self-amplifies.

**Warning signs:**
- A cluster of 5-10 concepts all sitting at ACTIVE tier simultaneously with no recent direct usage
- Cross-pollination scores not converging after N propagation steps
- Propagation runs that complete only after hitting a hardcoded iteration limit
- Entire clusters graduating to long-term simultaneously when only one member was recently used

**Prevention:**
- Propagation must attenuate by edge weight at each hop. If edge weight is 0.7, the activation transferred is `activation * 0.7`. This is dampening.
- Total activation added to a node per propagation cycle is capped (e.g., max +0.2 per cycle regardless of incoming signals).
- Propagation terminates on convergence (delta < epsilon), not on iteration count alone.
- No node can propagate back to its own propagation source in the same cycle (break direct cycles).
- Write a test: create a 5-node fully connected cluster, inject activation into one node, assert the cluster converges to stable values within 10 steps without all reaching maximum relevance.

**Phase that must address it:** Phase 0 (cross-pollination logic in the Concept Web foundation).

---

### Pitfall 8: Unbounded Memory Growth Without Effective Pruning

**What goes wrong:**
Theorex accumulates concepts, edges, session logs, and flash events indefinitely. The pruning logic exists but either runs too rarely, sets the LESS threshold too conservatively, or never removes edges (only nodes). After months of operation, the concept web has tens of thousands of nodes, JSONL session logs consume gigabytes, and every operation (search, propagation, graduation) slows proportionally.

**Why it happens:**
Pruning is destructive — data loss is scary. Developers set conservative thresholds and long intervals. Edge pruning is often forgotten entirely (only node pruning is implemented). JSONL rolling windows sound clean but are often implemented as "append only, clean up later" which never runs.

**Warning signs:**
- Concept web node count growing without plateau
- JSONL short-term log directory exceeding expected size (>50MB after 30 days is a sign of missing cleanup)
- `theorex prune` dry-run showing thousands of candidates but zero actual pruning in recent runs
- Concept web search latency increasing linearly with node count

**Prevention:**
- Pruning runs on every PM2 maintenance cycle (every 6 hours), not just on demand.
- Edge pruning is a first-class operation: edges below weight threshold are removed before node pruning runs.
- JSONL rolling window: implement as a delete-on-write, not a deferred cleanup. When writing a new session entry, delete entries older than 14 days in the same operation.
- Set node count alert thresholds in tests: assert concept web size stays under N nodes after M simulated sessions.
- Implement `theorex status` output that shows node count, edge count, JSONL size, and growth rate. Observable growth rate is the early warning.

**Phase that must address it:** Phase 1 (Long-Term pruning) and Phase 2 (Short-Term JSONL cleanup). Growth rate monitoring should be in Phase 2's CLI (`theorex status`).

---

### Pitfall 9: Multi-Agent Cross-Pollination Contaminating the Shared Concept Web

**What goes wrong:**
Nova (market scanner), Iris (iris-sentinel), and Qwen3 all feed the shared concept web. Nova inserts market-specific concepts (ticker symbols, price action patterns) with high frequency. These concepts cross-pollinate into Claude's session context and appear in flash memory as high-relevance items during unrelated coding sessions.

**Why it happens:**
A shared web with equal source weight treats all inputs uniformly. High-frequency market data from Nova produces high-frequency concept signals. Without source isolation, these signals propagate into Claude's relevance cluster.

**Warning signs:**
- Market-related concepts appearing in coding session flash context
- Concepts from one agent's domain appearing as ACTIVE in another agent's sessions
- Source attribution missing from concept node metadata
- Cross-agent propagation score dominating over per-session signals

**Prevention:**
- Source weight is a first-class field on every edge and node creation event. Each agent has an explicit source weight multiplier (Claude:1.0, Qwen3:0.9, Nova:0.7, Iris:0.7).
- Cross-agent propagation is dampened by source domain distance. Nova's concepts propagate freely within market-domain clusters but attenuate sharply when crossing into coding-domain clusters.
- Implement session-scoped relevance as a view over the shared web: the flash layer only surfaces concepts that intersect the current session's domain.
- Phase 6 (AI Family Shared Layer) should include an explicit contamination test: simulate 100 Nova market events, verify Claude coding session flash shows zero market concepts.

**Phase that must address it:** Phase 6 (AI Family Shared Layer) — but the source weight field must be defined in Phase 0's data model so all phases build with it.

---

## Minor Pitfalls

Mistakes that create friction, technical debt, or debugging difficulty, but do not break the system.

---

### Pitfall 10: Synonym Collapse Losing Semantic Distinction

**What goes wrong:**
Two surface forms that are near-synonyms in the embedding space get collapsed to one node ID. But "flash memory" (Theorex's context lobe) and "flash storage" (SSD) have different meanings in this domain. Collapse merges their relevance signals. One meaning's usage inflates the other's score.

**Prevention:**
- Synonym collapse is domain-aware, not embedding-only. Keep a domain-specific disambiguation list.
- When collapsing, require co-occurrence evidence (they appear in the same context) not just embedding similarity.
- Never auto-collapse proper nouns or technical terms without a human/AI explicit signal.

**Phase that must address it:** Phase 0 (concept extractor component).

---

### Pitfall 11: BM25 and Vector Search Score Fusion Producing Counterintuitive Rankings

**What goes wrong:**
BM25 and vector similarity scores operate on different scales. A naive linear combination (`0.5 * bm25 + 0.5 * vector`) produces rankings that favor one method over the other depending on document length, vocabulary, and query type. Exact-match queries underperform because BM25 scores are unbounded while vector scores are bounded [0,1].

**Prevention:**
- Normalize BM25 scores to [0,1] before fusion. Use min-max normalization per query batch.
- Test fusion weights with real queries: create a small labeled test set for short-term search and measure NDCG@10.
- Default to BM25-heavy weighting (0.7/0.3) for short-term logs where keywords dominate. Reserve vector-heavy weighting for long-term concept semantic queries.

**Phase that must address it:** Phase 2 (Short-Term Lobe hybrid search).

---

### Pitfall 12: Concurrent Write Corruption to Flash and JSONL Files

**What goes wrong:**
Multiple Claude Code sessions run in parallel. All PostToolUse hooks fire concurrently and write to the same flash file or append to the same JSONL log. File corruption occurs: partial writes interleave, JSON lines get truncated, sessions clobber each other's data.

**Prevention:**
- Per-session flash files (already planned in the design — enforce this).
- JSONL append uses file locking (Bun's file lock or a lock file sentinel) before every write.
- Flash files are never shared across sessions. Session ID is part of the filename.
- Session consolidation (merging flash into short-term) is a single-writer, sequential operation — not concurrent.

**Phase that must address it:** Phase 2 (Short-Term) and Phase 3 (Flash). Session isolation must be designed before any write path is implemented.

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| Phase 0 | Significance engine | Frequency runs before importance gate | Gate is a required prerequisite step, tested independently |
| Phase 0 | Cross-pollination | Feedback loops diverge | Dampening by edge weight + convergence test |
| Phase 0 | Synonym collapse | Semantic distinction lost | Domain disambiguation list, co-occurrence required |
| Phase 0 | Source weight field | Missing from data model | Define in Phase 0 even though Phase 6 uses it |
| Phase 1 | MEMORY.md write | Round-trip fidelity breaks | Byte-identical round-trip test passes before merging |
| Phase 1 | Pruning thresholds | Too conservative, no effective pruning | Run `theorex prune --dry-run` after 30 simulated sessions in tests |
| Phase 2 | JSONL cleanup | Rolling window never runs | Delete-on-write, not deferred cleanup |
| Phase 2 | BM25+vector fusion | Score scale mismatch | Normalize BM25 to [0,1] before fusion |
| Phase 2 | Concurrent writes | File corruption in parallel sessions | File locking or per-session append files |
| Phase 3 | Hook scope | Hook fires in non-Theorex sessions | Working directory guard at hook entry point |
| Phase 3 | Shell startup output | Contaminates hook JSON stdout | Suppress all startup output in hook shebang |
| Phase 3 | Flash bloat | Ring buffer bypassed or ceiling too high | Hard token cap enforced in code, tested in CI |
| Phase 4 | Cold-start edges | Embedding prior imports wrong relationships | Seeded edges at 0.1-0.15 weight, labeled `seeded`, fast decay |
| Phase 5 | Moment node decay | Decay function applied uniformly | Moment nodes explicitly excluded from decay path |
| Phase 6 | Cross-agent contamination | Market concepts appear in coding flash | Source domain attenuation + contamination integration test |
| Phase 7 | Code graph size | Codebase produces millions of edges | Cap code-reading graph separately from concept web, with own pruning |

---

## Sources

- [Effective Context Engineering for AI Agents — Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (HIGH confidence — official Anthropic source)
- [Cutting Through the Noise: Efficient Context Management — JetBrains Research](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) (MEDIUM confidence — peer-reviewed research blog)
- [LLM Context Window Limitations: Impacts, Risks, and Fixes — Atlan](https://atlan.com/know/llm-context-window-limitations/) (MEDIUM confidence — practitioner source)
- [Ballooning Context in the MCP Era — CodeRabbit](https://www.coderabbit.ai/blog/handling-ballooning-context-in-the-mcp-era-context-engineering-on-steroids) (MEDIUM confidence — practitioner source)
- [Hooks Not Executing in Subdirectories Bug — anthropics/claude-code #10367](https://github.com/anthropics/claude-code/issues/10367) (HIGH confidence — official bug tracker)
- [PostToolUse Hooks Not Executing — anthropics/claude-code #6305](https://github.com/anthropics/claude-code/issues/6305) (HIGH confidence — official bug tracker)
- [Automate Workflows with Hooks — Claude Code Docs](https://code.claude.com/docs/en/hooks-guide) (HIGH confidence — official documentation)
- [Memory in LLM-based Multi-agent Systems — TechRxiv preprint](https://www.techrxiv.org/users/1007269/articles/1367390/master/file/data/LLM_MAS_Memory_Survey_preprint_/LLM_MAS_Memory_Survey_preprint_.pdf) (MEDIUM confidence — preprint, corroborated by multiple sources)
- [Why Multi-Agent Systems Need Memory Engineering — MongoDB/O'Reilly](https://www.oreilly.com/radar/why-multi-agent-systems-need-memory-engineering/) (MEDIUM confidence — practitioner source)
- [Exponential History Integration with Diverse Temporal Scales — Science Advances](https://www.science.org/doi/10.1126/sciadv.adj4897) (HIGH confidence — peer-reviewed)
- [G-SPARC: Cold-Start Problem in Graph Learning — arXiv](https://arxiv.org/html/2411.01532) (HIGH confidence — peer-reviewed)
- [Efficient Pruning of Large Knowledge Graphs — IJCAI 2018](https://www.ijcai.org/proceedings/2018/564) (HIGH confidence — peer-reviewed conference)
- [Hybrid Search 101: BM25, Vectors, and Reranking — Max Petrusenko](https://www.maxpetrusenko.com/blog/hybrid-search-101-bm25-vector-reranking) (MEDIUM confidence — practitioner)
- [Survey on Memory-Augmented Neural Networks — arXiv](https://arxiv.org/html/2312.06141v2) (HIGH confidence — peer-reviewed survey)
