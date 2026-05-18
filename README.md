<div align="center">

```
████████╗██╗  ██╗███████╗ ██████╗ ██████╗ ███████╗██╗  ██╗
╚══██╔══╝██║  ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝
   ██║   ███████║█████╗  ██║   ██║██████╔╝█████╗   ╚███╔╝
   ██║   ██╔══██║██╔══╝  ██║   ██║██╔══██╗██╔══╝   ██╔██╗
   ██║   ██║  ██║███████╗╚██████╔╝██║  ██║███████╗██╔╝ ██╗
   ╚═╝   ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

[![Bun](https://img.shields.io/badge/Bun-1.3+-fbf0df?style=flat-square&logo=bun&logoColor=000)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=fff)](https://www.typescript.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](LICENSE)

</div>

Persistent, self-improving memory system for multi-agent LLM environments. Graph-based concept store with Postgres-backed semantic memory, span analytics with full-text search, fleet-wide signal detection, and a closed learning loop that diagnoses its own failures and writes fixes back into memory.

---

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun 1.3+ |
| Storage | PostgreSQL — concepts, agent_spans, flash_events, outcomes, learnings |
| Semantic search | Nomic embeddings via LM Studio (localhost:1234) |
| Full-text search | Postgres FTS5 with ts_rank scoring |
| Span compression | TokenJuice — ~60–80% token reduction on stored spans |
| Large LLM | Qwen API (cloud) — Qwen Max / Qwen3.5-122B-A10B |
| Background dispatch | qwen-abliterated (:8000) — fire-and-forget background inference |
| External protocol | JSON-RPC 2.0 MCP server on `:18800` |
| Scheduling | OpenClaw cron (not PM2) for scan, evolve-review, health-check |

---

## Core Data Model

### Concepts (long-term memory)

```typescript
interface Concept {
  id: string;                  // UUID
  label: string;               // canonical surface form
  body: string | null;         // enriched body (from metadata or LLM summary)
  agent_id: string;            // owner agent
  memory_type: string;         // "decision" | "discovery" | "trace_fix" | ...
  wing: string | null;        // palace wing (e.g. "wins", "losses", "identity")
  room: string | null;         // palace room within wing
  meta: Record<string, unknown>; // contains: relevance_tier, importance_weight, frequency_count, observation_type
  created_at: string;
  updated_at: string;
}
```

### Agent Spans (session trace)

```typescript
interface AgentSpan {
  span_id: string;
  agent_id: string;
  task_type: string;
  prompt_sent: string | null;     // TokenJuice-compressed
  output_recv: string | null;      // TokenJuice-compressed
  raw_thought: string | null;      // TokenJuice-compressed
  tools_called: string[];
  session_id: string | null;
  regime_snapshot: Record<string, unknown>;
  latency_ms: number | null;
  token_usage: number | null;
  metadata: Record<string, unknown>;
  fts_content: tsvector;           // FTS5 generated column (auto-populated)
  session_summary: string | null;  // LLM-generated one-line outcome
  resolved: boolean;
  reward_score: number | null;
}
```

### Flash Events (fleet signal bus)

```typescript
type FlashEventType =
  | "WIN" | "LOSS" | "TIMEOUT"
  | "KELLY_CHANGE"
  | "APPROVAL" | "REJECTION"
  | "REGIME_SHIFT";
```

Partitioned `flash_events` table — written by trade outcome pipeline, Kelly sizing changes, Nova approval/rejection events. Powers Fleet-GE signal detection.

---

## Memory Pipeline

```
Claude Code session (tool call)
       │
       │ SpanStore.emitSpan() — TokenJuice compression → Postgres
       ▼
agent_spans (compressed, FTS5-indexed)
       │
       │ 3am OC cron: theorex evolve-review --agent all
       ▼
concepts (enriched via enrich_bodies, promoted via scan)
       │
       │ theorex boot-inject — Postgres source, semantic grouping
       ▼
~/.openclaw/workspace/theorex/SHARED_CONTEXT.md  ← injected at session start
```

### Boot Inject — Semantic Grouping

Concepts grouped by palace structure at inject time:

```
## 🟢 Wins (ACTIVE, score >= 0.6)
## 🔴 Losses (ACTIVE, score >= 0.6)
## 🟡 Identity (MILD, score >= 0.3)
```

Depth modes: `summary` (top 10 per group) or `full` (top 50 per agent).

---

## Execution Layer

### Dispatch (Phase 16)

Fire-and-forget to qwen-abliterated on :8000. Pre-generated `trace_id` — EventBus uses it so the trace file is addressable before it's written.

```typescript
interface DispatchTask {
  id: string;
  agent_id: string;
  task: string;
  context_pct: number;        // trigger threshold (default 50%)
  query_tokens: number;
  tags: string[];
  outcome_id?: string;        // if set, trace_id patched onto outcome after dispatch
  tier_override?: "large" | "medium" | "small";
}

interface DispatchResult {
  task_id: string;
  model_used: string;
  response: string;
  latency_ms: number;
  success: boolean;
  written_to_axon: boolean;
  trace_id?: string;
}
```

### Routing priority (highest → lowest)

1. **Role registry** — operative's `model_preference` wins if it matches query type
2. **EnergyDispatch** — `pmset` battery check, downgrades `large→medium` below 20%
3. **ConfidenceMatrix** — empirical win-rate data; composite score = `0.6 × success_rate + 0.4 × (1 − normalized_latency)`
4. **HeuristicRouter** — 7 keyword tiers: `code`, `math`, `retrieval`, `synthesis`, `creative`, `safety`, `general`

### EventBus

```typescript
// LM_INFERENCE_START → LM_INFERENCE_END auto-assembles TraceRecord
bus.emit("LM_INFERENCE_START", { agent_id, model, prompt_tokens, query_type, trace_id });
bus.emit("LM_INFERENCE_END", { agent_id, model, ..., success, latency_ms });
// → TraceRecord written atomically (tmp → rename)
```

---

## Evolution Layer

### Outcome recording (Phase 13)

```typescript
interface TradeOutcome {
  trade_id: string;
  agent: string;
  direction: "long" | "short" | "flat";
  entry_price: number;
  exit_price: number;
  pnl: number;
  meta?: Record<string, unknown>;
}
```

Shadows Singularity trade outcomes → Postgres → flash event (WIN/LOSS/TIMEOUT). Read via:

```bash
theorex outcomes --agent singularity --summary
theorex outcomes --agent singularity --limit 20
```

### Learnings (Nova's structured lesson store)

```bash
theorex learn --agent secretarius --event escalation \
  --context "unreachable host" --pattern "direct LAN more reliable than relay" \
  --outcome positive

theorex learn --query --agent meridian --context "RISK_OFF"
theorex learn --summary
```

### Trace Review (Phase 20)

Nightly pass — for every failure with `compositeScore ≤ 0.3`:

1. Load linked trace
2. Build structured prompt
3. Call reviewer (Qwen API)
4. `writeToAgent(agent_id, "trace_fix: {fix_description}", "trace_fix")`
5. Return `TraceReviewRecord`

---

## Fleet-GE Signal Scanner

Scans runtime signals (watchdog events, PM2 logs, Theorex spans) for patterns. Matches against gene registry. Emits signals + GEP directives to Postgres.

```bash
bun run src/ge/signal-scanner.ts --source watchdog
bun run src/ge/signal-scanner.ts --source pm2
bun run src/ge/signal-scanner.ts --source theorex
```

Gene registry: `fleet-brain/genes/` — 6 active genes tracking:
- `gene_divergence_win_rate_anomaly` (HIGH)
- `gene_horizon_outcome_tracking` (HIGH)
- `gene_singularity_position_cap` (CRITICAL — not deployed)
- `gene_hades_turboquant_health_monitor` (MEDIUM)
- `gene_hades_watchdog_cooldown_race` (HIGH — fixed)

### GEP Event Audit Trail

Every directive written to `evolution_events` with full audit trail. Nova ops guide: `fleet-brain/ops/NOVA_FLEET_GE_OPS.md`

---

## MCP Server

JSON-RPC 2.0 HTTP server. Exposes read/write/search over the agent axon to any external tool.

```bash
theorex mcp-start --port 18800 --agent main
```

**Supported methods**:

| name | params | description |
|------|--------|-------------|
| `status` | — | agent name, concept count, top ACTIVE concepts |
| `search` | `query: string` | FTS5 + vector hybrid search |
| `write` | `text: string` | extract concepts + write to axon |
| `search_spans` | `agent: string, query: string, limit?: number` | FTS5 span search (sessions can query own history) |
| `promote` | — | promote qualifying concepts to shared web |
| `boot-inject` | — | regenerate SHARED_CONTEXT.md |
| `retrieve_outcomes` | `agent: string, limit?: number` | read trade outcomes |
| `write_trade_outcome` | `outcome: TradeOutcome` | shadow a trade outcome |
| `write_learning` | `learning: Learning` | write to learnings store |
| `get_learnings` | `agent: string, context?: string` | query learnings |

### A2A Task Protocol

```typescript
interface A2ATask {
  id: string;
  from_agent: string;
  to_agent: string;
  task_type: string;
  payload: Record<string, unknown>;
  status: "submitted" | "working" | "completed" | "failed";
  submitted_at: string;
  completed_at?: string;
  result?: unknown;
}
```

Stored in Postgres via `src/a2a/tasks.ts`.

---

## Agent Roles

```typescript
interface AgentProfile {
  agent_id: string;
  role: "orchestrator" | "operative";
  capabilities: QueryType[];
  model_preference: string;
  active: boolean;
}
```

`routeToAgent(queryType, profiles)` — highest-priority operative whose capabilities match query type.

---

## Full Learning Loop

```
theorex dispatch(task, {outcome_id})
  ↓
emit LM_INFERENCE_START (trace_id = preGeneratedUUID)
  ↓
qwen-abliterated on :8000 → success/failure
  ↓
emit LM_INFERENCE_END
  ↓
EventBus → TraceRecord written
  ↓
patchOutcomeTraceId(outcome_id, trace_id)
  ↓
[3am OC cron] theorex evolve-review --agent all
  → reviewOutcomes() + refineFromReport()
  → reviewAllFailures() → trace_fix concepts written
  ↓
[OC cron: theorex promote + boot-inject]
  → trace_fix concepts in SHARED_CONTEXT.md at next session start
  → trace_fix half-life = 7 days
```

---

## Configuration

`config.json` in project root — merged with defaults at startup.

```json
{
  "TURBOQUANT_SEED": "42",
  "TURBOQUANT_WARNING": "CRITICAL: This seed is baked into all 4320 stored TurboCode compressed vectors. Changing this value invalidates ALL stored codes and requires full backfill.",
  "lmStudioUrl": "http://localhost:11434",
  "synthEndpoint": "http://localhost:11434",
  "lmStudioTimeoutMs": 30000,
  "halfLifeDays": 14,
  "activeThreshold": 0.6,
  "mildThreshold": 0.3,
  "promotionThreshold": 0.5,
  "evolveWindowDays": 7,
  "agentAxonDir": "~/.openclaw/agents",
  "sharedAxonPath": "~/.openclaw/workspace/theorex/shared-axon.json",
  "THEOREX_STORAGE": "postgres",
  "THEOREX_PG_HOST": "[pg-host]",
  "THEOREX_PG_PORT": 5432,
  "THEOREX_PG_USER": "claw",
  "THEOREX_PG_DB": "theorex"
}
```

---

## File Layout

```
src/
├── axon/           store.ts postgres-store.ts scan.ts prune.ts scorer.ts
│                   propagate.ts enrich-bodies.ts tokenjuice.ts flash-writer.ts
│                   learnings.ts outcomes.ts cold.ts compress.ts
├── spans/          store.ts types.ts          ← TokenJuice + FTS5 span storage
├── family/         write.ts paths.ts boot-inject.ts synthesize.ts
├── dispatch/       worker.ts index.ts router/
├── router/         heuristic.ts confidence-matrix.ts energy.ts
├── evolve/         outcome.ts review.ts refine.ts gated-learning.ts trace-review.ts
├── mcp/            server.ts
├── a2a/            index.ts tasks.ts
├── ge/             signal-scanner.ts audit-adversarial.ts gene-outcome-check.ts
├── cli/            index.ts commands/
│                   learn.ts outcomes.ts
└── tests/          (unit + integration)

scripts/
├── run-nightly.sh       ← called by OC cron (10fd0f7d)
├── run-idle-flush.sh    ← called by OC cron
└── (ops scripts for nightly/idle/health pipelines)

ecosystem.config.cjs  ← PM2 (theorex-scan only; OC cron drives schedule)
```

---

## CLI Reference

```
theorex <command> [options]

Memory
  write          --agent <id> [--type <obs_type>] <text>
  status         [--agent <id>]
  search         <query> [--agent <id>]
  scan / scan-agent --agent <id>
  prune / prune-agent --agent <id>
  promote        --agent <id>
  boot-inject    [--top <n>] [--depth summary|full]
  synthesize     --agent <id> <text>

Spans
  search-spans   --agent <id> <query> [--limit <n>]

Ingestion
  ingest         --agent <id> <files...>
  ingest-code    --agent <id> <dir>
  ingest-image   <path> [--agent <id>]
  ingest-video   <path> [--agent <id>]

Execution
  dispatch       "<task>" [--agent <id>] [--context <pct>] [--outcome-id <id>]
  route          <query>
  role-route     <query>
  roles
  energy-check

Traces
  trace-stats
  matrix-build
  matrix-show

Evolution
  outcome        --agent <id> --decision <text> --result <text> [--success|--fail]
                 [--tags tag1,tag2] [--score 0.0-1.0] [--thumbs-up|--thumbs-down]
  evolve-review  [--agent <id|all>] [--days <n>]
  evolve-status  [--agent <id>] [--n <count>]
  trace-review   [--agent <id|all>]
  policy-snapshot

Outcomes & Learnings
  outcomes       --agent <id> [--limit <n>] [--summary]
  learn          --agent <id> --event <type> --context <text> --pattern <text>
                 --outcome <positive|negative|neutral>
  learn          --query --agent <id> [--context <text>]
  learn          --summary

MCP / A2A
  mcp-start      [--port <n>] [--agent <id>]
  a2a-tasks      [--agent <id>]
```

---

## OpenClaw Cron Jobs (source of truth for scheduling)

| OC Cron ID | Schedule | Command | Purpose |
|-----------|----------|---------|---------|
| `c6bd399a` | `0 */4 * * *` | fleet-ge-signal-scan | Pattern detection + GEP directives |
| `10fd0f7d` | `0 3 * * *` | theorex-evolve-review | scan → prune → promote → boot-inject |
| `4f7a8761` | `*/5 * * * *` | theorex-health-check | Agent endpoint health + trace metrics |
| `66ddb18c` | `0 6 * * *` | monitor-partitions | Partition check (daily) |
| `5b65a0c7` | `0 2 * * 0` | security-sweep | Weekly security audit |

---

## Quick Start

```bash
git clone https://github.com/LORD-ZYTHOZ/theorex
cd theorex
bun install

# Write a concept
bun run src/cli/index.ts write --agent main "TTL invalidation prevents cache stampedes"

# Record a trade outcome
bun run src/cli/index.ts outcomes --agent singularity --summary

# Record a learning
bun run src/cli/index.ts learn --agent nova --event decision \
  --context "direct LAN vs relay for host access" \
  --pattern "direct LAN more reliable for host access" \
  --outcome positive

# Run evolution (scan + trace review)
bun run src/cli/index.ts evolve-review --agent all

# Boot inject — build session context from Postgres
bun run src/cli/index.ts boot-inject --top 50 --depth summary
```

---

## Architecture Summary

```
┌──────────────────────────────────────────────────────────┐
│  SESSION LAYER (append-only spans)                       │
│  emitSpan → TokenJuice → Postgres (FTS5-indexed)          │
│  Sessions can retroactively query their own history       │
├──────────────────────────────────────────────────────────┤
│  MEMORY LAYER (semantic graph)                           │
│  Concepts + embeddings + palace structure (wing/room)     │
│  Boot-inject: Postgres source → SHARED_CONTEXT.md        │
├──────────────────────────────────────────────────────────┤
│  SIGNAL LAYER (Fleet-GE)                                 │
│  flash_events (WIN/LOSS/KELLY_CHANGE/...)                 │
│  signal-scanner → gene registry → GEP directives          │
├──────────────────────────────────────────────────────────┤
│  LEARNING LAYER                                          │
│  outcomes pipeline (trade shadows)                       │
│  learnings system (structured lessons per agent)          │
│  evolve-review → trace_fix concepts                      │
└──────────────────────────────────────────────────────────┘

PostgreSQL backend is the single source of truth.
OC cron drives all scheduling. PM2 manages only theorex-scan (one-shot).
```

---

<div align="center">

MIT License · [Bun](https://bun.sh) · TypeScript

</div>