# Theorex

## What This Is

Theorex is a purpose-built cognitive memory architecture for AI systems. It gives AI agents living, weighted, self-classifying memory — not static storage — built around a concept web where nodes are ideas, edges are relationships, and relevance propagates through the network based on importance and usage. Built from scratch in Bun, designed for the AI family (Claude, Nova, Iris, Qwen3) running on the M4 Pro ecosystem.

## Core Value

An AI that knows what matters right now — not just what it was told — because its memory is alive, decays intelligently, and cross-pollinates relevance across a living concept web.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Significance engine — importance gate first, frequency amplifier second
- [ ] Concept web — numeric IDs, weighted nodes (relevance + sentiment), weighted edges (co-occurrence strength)
- [ ] Relevance tiers — ACTIVE / MILD / LESS with auto-promotion, demotion, and pruning
- [ ] Sentiment tiers — PREFERRED / NEUTRAL / DISPREFERRED per concept node
- [ ] Cross-pollination — activation propagates through edges, neighbors inherit relevance
- [ ] RAG bootstrap layer — embed new concepts, seed initial edges before experience fills them
- [ ] Long-term lobe — wraps MEMORY.md + .theorex-meta.json, stable crystallized knowledge
- [ ] Short-term lobe — 14-day rolling JSONL session log, hybrid BM25 + vector search
- [ ] Flash lobe — structured context window, no daemon, per-session ring buffer
- [ ] Moment nodes — AI photographs (code snapshots + timestamps + story), never pruned
- [ ] Claude Code hooks integration — flash events recorded via PostToolUse, flushed on SessionEnd
- [ ] AI family shared layer — Nova, Iris, Qwen3 can feed the shared concept web
- [ ] Code reading — raw codebase ingested as concept web (functions=nodes, calls=edges)
- [ ] CLI — theorex scan / status / search / ref / prune / graduate

### Out of Scope

- External API calls for embeddings — local only (LM Studio/Ministral), no cloud dependency
- Graphical UI — CLI and hook integration only for v1
- Human document search patterns — this is built for AI, not human retrieval workflows
- Borrowed code from QMD/LlamaIndex — learnings only, fresh implementation

## Context

- **Machine:** M4 Pro, 64GB RAM
- **AI ecosystem:** Claude (this system), Nova (Ministral-3B via LM Studio), Iris (iris-sentinel, market scanner), Qwen3-32B-8bit (MLX, port 8082)
- **Existing memory:** MEMORY.md at `~/.claude/projects/-Users-eoh/memory/MEMORY.md` — must not break
- **Existing hooks:** Claude Code hooks at `~/.claude/` — Theorex hooks are additive
- **Full design:** `~/.claude/projects/-Users-eoh/memory/cortex.md`
- **PM2:** Used for process management across the AI ecosystem
- **Key insight:** Flash memory = context window. Not a database. Presence, not retrieval.

## Constraints

- **Tech stack:** Bun runtime — lightweight, event-driven, low memory overhead
- **Storage:** Markdown + JSONL + JSON — no database, fully inspectable
- **Embeddings:** Local only — LM Studio endpoint, graceful BM25 fallback if unavailable
- **MEMORY.md:** Round-trip fidelity required — parse and write must preserve exact format
- **No mutation:** All data operations return new objects, never mutate in place
- **File size:** 200-400 lines per file, 800 max — many small files over few large ones

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Significance engine first | Everything else (relevance, sentiment, flash, short/long-term) depends on knowing what matters | — Pending |
| Numeric IDs for concepts | Synonyms collapse, fast lookup, no string comparison, enables graph math | — Pending |
| Fresh code throughout | Borrowed code carries borrowed assumptions; this architecture has no prior art to borrow | — Pending |
| Bun runtime | Low memory, fast startup, event-driven — suits always-watching flash layer | — Pending |
| Metadata separate from MEMORY.md | Classification data in .theorex-meta.json — MEMORY.md stays human/AI readable | — Pending |
| RAG as bootstrap only | RAG's retrieval pattern discarded; embedding layer kept for cold-start edge seeding | — Pending |
| Importance gate before frequency | Frequency without importance = noise tracking; importance first prevents noise amplification | — Pending |

---
*Last updated: 2026-03-10 after initialization*
