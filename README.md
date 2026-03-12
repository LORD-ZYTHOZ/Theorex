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

## What Is This?

Theorex gives AI agents **persistent memory that thinks like they do**.

An **axon** is each agent's personal concept web — a graph of ideas, decisions, and patterns that gets smarter over time. Concepts that matter rise to the top. Concepts that go unused fade and disappear. The ones that really matter get shared across your whole agent fleet.

Every time an agent starts a new session, Theorex **injects its most important active concepts at boot** — so the agent already knows what matters before the first message. No prompting required. No searching. Just context, ready.

---

## What It Feels Like

> You spend a session debugging an auth bug. Theorex watches silently via hooks.  
> Next session, before you type a word, your agent already has:
>
> ```
> # Active Memory
> - authentication      [ACTIVE · 2 days ago]
> - session_token       [ACTIVE · 2 days ago]  
> - middleware          [ACTIVE · 3 days ago]
> - validateSession()   [ACTIVE · code · 2 days ago]
> ```
>
> It remembers where you left off. Every session.

That file — `SHARED_CONTEXT.md` — is the **boot injection**: a compact snapshot of what your agents collectively know, regenerated automatically, loaded at every session start.

---

## The Problem With Existing Solutions

Most AI memory systems are **human tools with an AI wrapper** — static documents, flat vector search, query-retrieve cycles. They treat memory like a filing cabinet.

The problems:
- **RAG retrieves** — but only when you ask. If you don't know to ask, the memory is lost.
- **No decay** — stale information from 6 months ago weighs the same as yesterday's decision.
- **No shared understanding** — agent A learns something, agent B never knows.
- **No boot context** — every session starts cold. The agent has no idea what's been happening.

Theorex fixes all four.

---

## How It Works

Every concept gets a **node** in a graph. Every node has a **score** that changes with experience.

```
                         ┌─────────────────┐
                         │  CONCEPT  WEB   │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
       [memory:001]        [context:003]        [agents:002]
       score: 0.91          score: 0.78         score: 0.85
       tier: ACTIVE         tier: ACTIVE        tier: ACTIVE
            │                    │                   │
          0.92                 0.71                0.87
            │                    │                   │
            └──────────[decay:004]────────────────┘
                        score: 0.63
                        tier:  MILD

    ● ACTIVE   — injected at boot, always in context
    ○ MILD     — available on query
    · LESS     — fading, scheduled for pruning
```

The **score** is a composite of three signals:

| Signal | What it measures |
|--------|-----------------|
| **Recency** | How recently was this concept seen? Decays with half-life. |
| **Frequency** | How often does it appear? Log-normalized. |
| **Connections** | Is it co-occurring with other important concepts? Activation propagates through edges. |

Concepts **earn their place** or disappear:

- **First encounter** → enters NEUTRAL, score 0.0
- **Seen again** → frequency score rises
- **Co-occurs with important concepts** → edge forms, activation propagates
- **Not seen for 14 days** → score halves *(configurable)*
- **Not seen for 30 days** → pruned
- **Consistently high score** → promoted to the shared multi-agent web

---

## Key Concepts Explained

**Axon** — each agent's private concept web. A JSON graph file. No database needed. Lives at `~/.theorex/agents/<id>/theorex/axon.json`.

**Boot injection** — at the start of every session, Theorex reads your agent's ACTIVE-tier concepts and writes them into `SHARED_CONTEXT.md`. Add that file to your agent's memory paths once, and your agent wakes up informed every time.

**Decay** — importance is not permanent. A concept unseen for 14 days has its score halved. Unseen for 30 days, it's pruned. Your agent naturally forgets what stopped mattering — like you do.

**Promotion** — when a concept's score crosses a threshold, it gets pushed to the shared web. This is how agent A's discovery becomes agent B's knowledge.

**Moments** — episodic memories. Not concepts — events. "Fixed the session bug at 3am" is a moment. Moments are permanent and never pruned. They anchor history.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         FLASH  BUFFER                            │
│  Hooks watch every tool call · captures significant events live  │
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
│                     LONG-TERM  AXON  (per agent)                 │
│   Graphology concept web · decay scoring · tier classification   │
│                                                                  │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│   │  Nodes   │   │  Edges   │   │ Moments  │   │   Code   │    │
│   │concepts  │   │co-occur  │   │episodic  │   │ symbols  │    │
│   │+sentiment│   │strength  │   │permanent │   │AST nodes │    │
│   └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
└────────────────────────────┬─────────────────────────────────────┘
                             │ promote when score > threshold
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SHARED  AXON  (all agents)                    │
│         Best concepts from every agent · source-weighted         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ boot-inject (runs automatically)
                             ▼
                    SHARED_CONTEXT.md
         ← loaded at the start of every agent session →
```

### Phases

| # | Phase | What it adds |
|---|-------|-------------|
| 0 | **Significance** | Core scoring — recency × frequency × co-occurrence |
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

# See what your agent knows
bun run src/cli/index.ts status --agent main
```

At end of a session:

```bash
bun run src/cli/index.ts session-summary --agent main \
  --investigated "looked at auth middleware" \
  --learned "session tokens not invalidated on logout" \
  --completed "patched validateSession()" \
  --next "deploy and monitor"
```

Then promote and regenerate boot context:

```bash
bun run src/cli/index.ts promote --agent main
bun run src/cli/index.ts boot-inject
# → SHARED_CONTEXT.md is now ready to inject at next session start
```

---

## CLI Reference

```
bun run src/cli/index.ts <command> --agent <id> [options]

Commands:
  write            Write a concept or observation
  status           Show top concepts by composite score
  search           Hybrid BM25 + vector search
  scan-agent       Re-score all concepts (apply decay + frequency)
  prune-agent      Remove LESS-tier concepts past threshold
  promote          Push qualifying concepts to shared web
  boot-inject      Regenerate SHARED_CONTEXT.md from shared axon
  ingest-code      Parse codebase into code_function nodes
  session-summary  Bulk end-of-session write with typed observations

Observation types (--type):
  Conceptual:  decision | discovery | bugfix | feature | refactor | change
  Code:        function | class | method | arrow
```

---

## Configuration

Drop a `config.json` in the project root. All fields are optional.

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
| `activeThreshold` | `0.6` | Score floor for ACTIVE tier (auto-injected at boot) |
| `pruneThresholdDays` | `30` | Days in LESS tier before a concept is deleted |
| `promotionThreshold` | `0.5` | Score required to enter the shared multi-agent web |
| `lmStudioUrl` | `http://localhost:1234` | LM Studio OpenAI-compatible endpoint |
| `agentAxonDir` | `~/.theorex/agents` | Root directory for all per-agent axon files |

---

## Multi-Agent Setup

Each agent owns a private axon. High-scoring concepts are promoted to a shared web that every agent boots with.

```
~/.theorex/
├── agents/
│   ├── nova/theorex/axon.json           ← Nova's private concepts
│   ├── secretarius/theorex/axon.json    ← Secretarius' concepts
│   └── researcher/theorex/axon.json     ← Researcher's concepts
└── shared/
    ├── shared-axon.json                 ← Promoted concepts, all agents
    └── SHARED_CONTEXT.md                ← Injected at every session start
```

Add `SHARED_CONTEXT.md` to your agent's memory search paths once. Theorex handles the rest.

**Automate with PM2:**

```bash
# Auto-promote idle agents every 10 minutes
pm2 start theorex-idle-flush.sh --name theorex-idle-flush --cron "*/10 * * * *"

# Full nightly decay + prune + promote at 3am
pm2 start theorex-nightly.sh --name theorex-nightly --cron "0 3 * * *"

pm2 save
```

---

## Claude Code Hooks

Add to `.claude/settings.json` to capture concepts automatically during sessions — no manual writes needed.

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

The `Stop` hook runs `synthesize → promote → boot-inject` automatically when your session ends. Next session starts informed.

---

## Axon Integration

Theorex pairs with [Axon](AXON-INTEGRATION.md) for code-level memory. Together they give agents the full picture.

```
   Theorex                          Axon
   ───────                          ────
   What matters to the agent   ←→   Where it lives in code
   Decisions & patterns             Symbols & call graphs
   Concept web (JSON)               pgvector (PostgreSQL)

   Both use nomic-embed-text-v1.5 — same 768-dim vector space
```

→ [AXON-INTEGRATION.md](./AXON-INTEGRATION.md)

---

## Why Not RAG?

RAG retrieves. Theorex **knows**.

| | RAG | Theorex |
|-|-----|---------|
| **How it works** | You query → it finds relevant chunks | Concepts live, decay, and surface automatically |
| **Relevance** | Cosine similarity at query time | Score earned through repeated experience |
| **Stale information** | Stays forever unless manually deleted | Decays naturally — half-life removes the noise |
| **Cross-agent knowledge** | Not built in | Native shared web, source-weighted |
| **Session start** | Cold — agent knows nothing | Warm — ACTIVE concepts injected automatically |
| **Code memory** | Embeds raw source files | AST → typed concept nodes + call edges |

RAG is still used inside Theorex — as a cold-start edge seeder (Phase 4). A tool, not the foundation.

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
| Embeddings | [@huggingface/transformers](https://huggingface.co/docs/transformers.js) (ONNX, runs locally) |
| LM Studio | [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) |
| Storage | JSON files — no database required |

</div>

---

<div align="center">

**MIT License** · Built with [Bun](https://bun.sh)

</div>
