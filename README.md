<div align="center">

```
████████╗██╗  ██╗███████╗ ██████╗ ██████╗ ███████╗██╗  ██╗
╚══██╔══╝██║  ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝
   ██║   ███████║█████╗  ██║   ██║██████╔╝█████╗   ╚███╔╝ 
   ██║   ██╔══██║██╔══╝  ██║   ██║██╔══██╗██╔══╝   ██╔██╗ 
   ██║   ██║  ██║███████╗╚██████╔╝██║  ██║███████╗██╔╝ ██╗
   ╚═╝   ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

**AI-native memory for multi-agent systems.**  
Not adapted from human tools — built for how agents actually think.

[![License: MIT](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.3+-fbf0df?style=flat-square&logo=bun&logoColor=000)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-450_passing-22C55E?style=flat-square)](#tests)
[![Phases](https://img.shields.io/badge/Phases-0--8_complete-22C55E?style=flat-square)](#architecture)
[![Multi-Agent](https://img.shields.io/badge/Multi--Agent-ready-6366f1?style=flat-square)](#multi-agent-setup)

</div>

---

## The Problem

Most AI memory systems are **human tools with an AI wrapper** — static documents, flat vector search, query-retrieve cycles. They treat memory like a filing cabinet.

Agents don't think that way.

Theorex starts from scratch: a **living concept web** where importance is earned through experience, knowledge decays when forgotten, and insights shared across an entire fleet of agents.

---

## How It Works

Every concept gets a node. Every node earns its score.

```
                         ┌─────────────────┐
                         │  CONCEPT  WEB   │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
       [trading:001]        [signal:003]        [risk:002]
       score: 0.91          score: 0.78         score: 0.85
       tier: ACTIVE         tier: ACTIVE        tier: ACTIVE
            │                    │                   │
          0.92                 0.71                0.87
            │                    │                   │
            └──────────[momentum:004]────────────────┘
                        score: 0.63
                        tier:  MILD
                        
    ● ACTIVE   — injected at boot, always in context
    ○ MILD     — available on query
    · LESS     — fading, scheduled for pruning
```

Concepts **earn their place** or get pruned:

- **First encounter** → enters NEUTRAL, score 0.0
- **Seen again** → frequency score rises
- **Co-occurs with important concepts** → edge forms, activation propagates
- **Not seen for 14 days** → score halves *(configurable half-life)*
- **Not seen for 30 days** → pruned from graph
- **Survives long enough** → promoted to shared multi-agent web

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         FLASH  BUFFER                            │
│           Per-session ring buffer · hooks-driven capture         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ significant events (score ≥ 0.5)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SHORT-TERM  MEMORY                          │
│        14-day rolling JSONL · BM25 + vector hybrid search        │
└────────────────────────────┬─────────────────────────────────────┘
                             │ graduate after 7 consecutive active days
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                     LONG-TERM  AXON                              │
│   Graphology concept web · decay scoring · tier classification   │
│                                                                  │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│   │  Nodes   │   │  Edges   │   │ Moments  │   │   Code   │    │
│   │concepts  │   │co-occur  │   │episodic  │   │ symbols  │    │
│   │+sentiment│   │strength  │   │permanent │   │AST nodes │    │
│   └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
└────────────────────────────┬─────────────────────────────────────┘
                             │ promote (composite_score > threshold)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SHARED  AXON  (multi-agent)                   │
│         Aggregated web across all agents · source-weighted       │
└────────────────────────────┬─────────────────────────────────────┘
                             │ boot-inject
                             ▼
                   SHARED_CONTEXT.md
              injected at every agent session start
```

### Phases

| # | Phase | What it adds |
|---|-------|-------------|
| 0 | **Significance** | Core scoring — importance × recency × frequency |
| 1 | **Long-Term Memory** | Graphology concept web, typed nodes + edges |
| 2 | **Short-Term Memory** | Flash → STM → graduation pipeline |
| 3 | **Flash + Hooks** | Claude Code hooks for zero-friction capture |
| 4 | **RAG Bootstrap** | Embedding-seeded initial edges, cold-start solved |
| 5 | **Moment Nodes** | Episodic memory — significant events, never pruned |
| 6 | **AI Family** | Multi-agent shared web + boot injection |
| 7 | **Code Reading** | TypeScript / Python / Go AST → `code_function` nodes |
| 8 | **Drift Detection** | Tier instability + sentiment flip detection |

---

## Quick Start

**Requires:** [Bun](https://bun.sh) 1.3+ · [LM Studio](https://lmstudio.ai) with `nomic-embed-text-v1.5`

```bash
git clone https://github.com/LORD-ZYTHOZ/theorex
cd theorex
bun install
```

```bash
# Create your agent store
mkdir -p ~/.theorex/agents/main/theorex

# Write your first concept
bun run src/cli/index.ts write --agent main "semantic memory beats keyword search"

# See what the agent knows
bun run src/cli/index.ts status --agent main
```

```bash
# Session workflow
bun run src/cli/index.ts session-summary --agent main \
  --investigated "looked at auth middleware" \
  --learned "session tokens not invalidated on logout" \
  --completed "patched validateSession()" \
  --next "deploy and monitor"
```

---

## CLI Reference

```
theorex <command> --agent <id> [options]

Commands:
  write          Write a concept or observation
  status         Show top concepts by score
  search         Hybrid BM25 + vector search
  scan-agent     Score all concepts (decay + frequency)
  prune-agent    Remove LESS-tier concepts past threshold
  promote        Push qualifying concepts to shared web
  boot-inject    Regenerate SHARED_CONTEXT.md
  ingest-code    Parse codebase into code_function nodes
  session-summary  Bulk end-of-session write

Observation types (--type):
  Conceptual:  decision | discovery | bugfix | feature | refactor | change
  Code:        function | class | method | arrow
```

---

## Configuration

Drop a `config.json` in the project root. All fields are optional — defaults work out of the box.

```json
{
  "halfLifeDays": 14,
  "activeThreshold": 0.6,
  "pruneThresholdDays": 30,
  "promotionThreshold": 0.5,
  "lmStudioUrl": "http://localhost:1234",
  "lmStudioEmbedModel": "nomic-embed-text-v1.5",
  "agentAxonDir": "~/.theorex/agents",
  "sharedAxonPath": "~/.theorex/shared/shared-axon.json"
}
```

| Key | Default | What it controls |
|-----|---------|-----------------|
| `halfLifeDays` | `14` | Days before an unseen concept's score halves |
| `activeThreshold` | `0.6` | Score floor for ACTIVE tier (boot-injected) |
| `pruneThresholdDays` | `30` | Days in LESS tier before pruning |
| `promotionThreshold` | `0.5` | Score required to enter the shared multi-agent web |
| `lmStudioUrl` | `http://localhost:1234` | LM Studio OpenAI-compatible endpoint |
| `agentAxonDir` | `~/.theorex/agents` | Root for all per-agent axon stores |

---

## Multi-Agent Setup

Each agent owns a private axon. High-scoring concepts are promoted to a shared web that all agents boot with.

```
~/.theorex/
├── agents/
│   ├── nova/theorex/axon.json           ← Nova's private concepts
│   ├── secretarius/theorex/axon.json    ← Secretarius' concepts
│   └── researcher/theorex/axon.json     ← Researcher's concepts
└── shared/
    ├── shared-axon.json                 ← Promoted concepts, all agents
    └── SHARED_CONTEXT.md                ← Boot injection file
```

**Automate with PM2:**

```bash
# Auto-promote idle agents every 10 minutes
pm2 start theorex-idle-flush.sh --name theorex-idle-flush --cron "*/10 * * * *"

# Full nightly decay cycle at 3am
pm2 start theorex-nightly.sh --name theorex-nightly --cron "0 3 * * *"

pm2 save
```

Set `AGENTS` to match your agent IDs:

```bash
AGENTS="nova secretarius researcher" pm2 restart theorex-idle-flush
```

---

## Claude Code Hooks

Theorex integrates with [Claude Code](https://claude.ai/code) hooks to capture concepts automatically — no manual writes needed during a session.

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{ 
        "type": "command",
        "command": "cd ~/theorex && bun run src/cli/index.ts flash --agent main --session $CLAUDE_SESSION_ID"
      }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command", 
        "command": "~/.local/bin/theorex-session-end main"
      }]
    }]
  }
}
```

---

## Axon Integration

Theorex pairs with [Axon](AXON-INTEGRATION.md) — a code-indexing system built on pgvector — to give agents both **conceptual memory** and **code memory** in the same vector space.

```
   Theorex                          Axon
   ───────                          ────
   What matters to the agent   ←→   Where it lives in code
   Decisions & patterns             Symbols & call graphs
   Concept web (JSON)               pgvector (PostgreSQL)
   
   Both use nomic-embed-text-v1.5 via LM Studio
   Same 768-dim space · compatible similarity scores
```

→ [AXON-INTEGRATION.md](./AXON-INTEGRATION.md)

---

## Tests

```bash
bun test
```

450 tests across all phases — concept scoring, decay, STM graduation, promotion, RAG bootstrap, code parsing, drift detection, multi-agent family layer.

---

## Stack

<div align="center">

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) 1.3+ |
| Graph | [Graphology](https://graphology.github.io) 0.26 |
| NLP | [compromise](https://github.com/spencermountain/compromise) |
| Search | [wink-bm25-text-search](https://github.com/winkjs/wink-bm25-text-search) |
| Embeddings | [@huggingface/transformers](https://huggingface.co/docs/transformers.js) (ONNX local) |
| LM Studio | [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) |
| Storage | JSON files — no database required |

</div>

---

## Why Not RAG?

RAG retrieves. Theorex **knows**.

| | RAG | Theorex |
|-|-----|---------|
| **Memory model** | Query → retrieve chunks | Living concept web |
| **Relevance** | Cosine similarity at query time | Earned score over time |
| **Decay** | None — stale docs stay forever | Half-life decay, automatic pruning |
| **Cross-agent** | Not built in | Native shared web |
| **Boot context** | Manual prompt injection | Automatic from ACTIVE tier |
| **Code memory** | Embed source files | AST → concept nodes + call edges |

RAG is still useful for cold-start edge seeding (Phase 4) — but as a tool, not the foundation.

---

<div align="center">

**MIT License** · Built with [Bun](https://bun.sh)

</div>
