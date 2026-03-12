# Theorex

> AI-native memory for multi-agent systems. Not adapted from human tools — built for how AI agents actually think.

Most memory systems bolt vector search onto human document retrieval. Theorex starts from scratch: a living concept web where importance is earned through experience, concepts decay when forgotten, and multiple agents share a common understanding.

---

## Core Idea

Every concept gets a node. Every node has a score. Scores change with experience.

```
[trading:001] ←── 0.92 ──→ [signal:003]
      │                           │
    0.87                        0.78
      │                           │
[risk:002]   ←── 0.71 ──→ [momentum:004]
```

- **New concept** → enters as NEUTRAL, importance 0.0
- **Seen again** → frequency score rises
- **Co-occurs with important concept** → edge forms, activation propagates
- **Not seen for 14 days** → score halves (configurable half-life)
- **Not seen for 30 days** → pruned from graph

Agents don't search — they **boot with context**. ACTIVE-tier concepts are injected at session start so the agent already knows what matters before the first message.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Concept Web                       │
│   Graphology undirected graph · JSON persistence    │
│   Nodes: concepts · Edges: co-occurrence strength   │
└────────────────┬────────────────────────────────────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌────────┐ ┌──────────┐
│ Short-  │ │  RAG   │ │ Moments  │
│  Term   │ │ Layer  │ │  Store   │
│ Memory  │ │        │ │          │
└────┬────┘ └────────┘ └──────────┘
     │ graduate (7 days)
     ▼
┌─────────────────────────────────────────────────────┐
│               Long-Term Axon (per agent)             │
│   Scored · Tiered · Decaying · Prunable              │
└────────────────────┬────────────────────────────────┘
                     │ promote (score > threshold)
                     ▼
┌─────────────────────────────────────────────────────┐
│              Shared Axon (multi-agent)               │
│   SHARED_CONTEXT.md — injected at agent boot         │
└─────────────────────────────────────────────────────┘
```

### Phases

| Phase | Name | What it does |
|-------|------|-------------|
| 0 | Significance | Core concept scoring — importance × recency × frequency |
| 1 | Long-Term Memory | Graphology concept web with typed nodes + edges |
| 2 | Short-Term Memory | Flash buffer → STM → graduation to long-term |
| 3 | Flash + Hooks | Claude Code hooks for zero-friction capture |
| 4 | RAG Bootstrap | nomic-embed-text embeddings seed initial concept edges |
| 5 | Moment Nodes | Episodic memory — significant events with full context |
| 6 | AI Family | Multi-agent shared concept web + boot injection |
| 7 | Code Reading | TypeScript/Python/Go AST → code_function nodes |
| 8 | Drift Detection | Tier instability + sentiment flip detection |

---

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) 1.3+, [LM Studio](https://lmstudio.ai) (for embeddings)

```bash
git clone https://github.com/LORD-ZYTHOZ/theorex
cd theorex
bun install
```

Create your agent data directory:

```bash
mkdir -p ~/.theorex/agents/main/theorex
```

Configure (optional — defaults work out of the box):

```bash
cp config.example.json config.json
# edit lmStudioUrl, agentAxonDir, sharedAxonPath as needed
```

Write your first concept:

```bash
bun run src/cli/index.ts write --agent main "semantic memory is better than keyword search"
```

Check what's in the axon:

```bash
bun run src/cli/index.ts status --agent main
```

---

## Configuration

All config lives in `config.json` (auto-created with defaults if missing).

| Key | Default | Description |
|-----|---------|-------------|
| `halfLifeDays` | `14` | Days before unseen concept score halves |
| `activeThreshold` | `0.6` | Score required for ACTIVE tier |
| `pruneThresholdDays` | `30` | Days before LESS-tier concept is pruned |
| `lmStudioUrl` | `http://localhost:1234` | LM Studio OpenAI-compatible endpoint |
| `lmStudioEmbedModel` | `nomic-embed-text-v1.5` | Embedding model for RAG bootstrap |
| `agentAxonDir` | `~/.theorex/agents` | Root dir for per-agent axon stores |
| `sharedAxonPath` | `~/.theorex/shared/shared-axon.json` | Shared multi-agent concept web |
| `promotionThreshold` | `0.5` | Score required to promote concept to shared web |

---

## CLI Reference

```bash
# Write a concept
bun run src/cli/index.ts write --agent <id> [--type <kind>] "text"

# Concept types: decision | discovery | bugfix | feature | refactor | change
# Code types:    function | class | method | arrow

# Scan and score all concepts
bun run src/cli/index.ts scan-agent --agent <id>

# Show top concepts
bun run src/cli/index.ts status --agent <id>

# Search concepts
bun run src/cli/index.ts search --agent <id> "query"

# Ingest code symbols
bun run src/cli/index.ts ingest-code --agent <id> ./src

# Promote to shared web
bun run src/cli/index.ts promote --agent <id>

# Regenerate SHARED_CONTEXT.md (boot injection file)
bun run src/cli/index.ts boot-inject

# Session summary (end-of-session bulk write)
bun run src/cli/index.ts session-summary --agent <id> \
  --investigated "looked at X" \
  --learned "Y causes Z" \
  --completed "fixed the bug" \
  --next "deploy to prod"
```

---

## Multi-Agent Setup

Each agent gets its own axon. A shared web aggregates the best concepts across all agents.

```
~/.theorex/
├── agents/
│   ├── nova/theorex/axon.json          # Nova's private concepts
│   ├── secretarius/theorex/axon.json   # Secretarius' private concepts
│   └── researcher/theorex/axon.json    # Researcher's private concepts
└── shared/
    ├── shared-axon.json                # Promoted concepts from all agents
    └── SHARED_CONTEXT.md               # Boot injection — loaded at session start
```

Agents with score above `promotionThreshold` get promoted to the shared web automatically.
`SHARED_CONTEXT.md` is regenerated after each promotion — add it to your agent's memory search paths.

### Automation (PM2)

```bash
# Auto-promote idle agents every 10 minutes
pm2 start theorex-idle-flush.sh --name theorex-idle-flush --cron "*/10 * * * *"

# Full nightly decay + prune + promote at 3am
pm2 start theorex-nightly.sh --name theorex-nightly --cron "0 3 * * *"

pm2 save
```

Set the `AGENTS` env var to match your agent IDs:

```bash
AGENTS="nova secretarius researcher" pm2 restart theorex-idle-flush
```

---

## Claude Code Hooks

Theorex integrates with Claude Code's hook system to capture concepts automatically during sessions.

Add to `.claude/settings.json` in your project:

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

Theorex works alongside [Axon](https://github.com/LORD-ZYTHOZ/axon) for code-level memory.

- **Theorex** → concept-level memory (what matters, decisions, patterns)
- **Axon** → code-level memory (symbols, call graphs, API endpoints)
- **Shared embedding model** → nomic-embed-text-v1.5 via LM Studio (same vector space)

See [AXON-INTEGRATION.md](./AXON-INTEGRATION.md) for setup details.

---

## Tests

```bash
bun test
```

450 tests across all phases. Coverage includes concept scoring, decay, graduation, promotion, code parsing, drift detection.

---

## Stack

- **Runtime:** Bun 1.3+
- **Graph:** Graphology 0.26
- **NLP:** compromise
- **Search:** wink-bm25-text-search
- **Embeddings:** @huggingface/transformers (ONNX, local) + LM Studio (nomic-embed-text)
- **Storage:** JSON files (axon.json, shared-axon.json) — no database required

---

## License

MIT
