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
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-826_passing-22C55E?style=flat-square)](#tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](LICENSE)

</div>

Persistent, self-improving memory system for multi-agent LLM environments. Graph-based concept store with decay scoring, multi-agent promotion, local LLM dispatch, and a closed learning loop that diagnoses its own failures and writes fixes back into memory.

---

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun 1.3+ |
| Graph store | Graphology 0.26 (in-memory, serialised to JSON) |
| NLP extraction | compromise (entity/concept extraction) |
| Full-text search | wink-bm25-text-search |
| Semantic search | HNSW-lite (append-only JSONL embedding store) |
| Embeddings | @huggingface/transformers ONNX, or LM Studio endpoint |
| Local LLM (large) | Qwen3 32B via MLX — `localhost:8082` |
| Local LLM (medium) | Ministral 3B via LM Studio — `localhost:1234` |
| External protocol | JSON-RPC 2.0 (MCP-compatible) on `:18800` |
| Storage | Flat JSON/JSONL files — no database |

---

## Core Data Model

### AxonNodeAttrs

```typescript
interface AxonNodeAttrs {
  canonical_form: string;
  concept_id: number;          // Bun.hash.wyhash of canonical_form
  node_type: string;           // "concept" | "code_function" | ...
  observation_type: string;    // "decision" | "discovery" | "trace_fix" | ...
  importance_weight: number;   // composite score 0.0–1.0
  relevance_tier: string;      // "ACTIVE" | "MILD" | "LESS" | "NEUTRAL" | "SLEEPING"
  frequency_count: number;
  last_seen: string;           // ISO 8601
  sentiment: number;           // -1.0 to 1.0
  agent_id: string;
  source_weight: number;       // agent source credibility 0.0–1.0
}
```

### Scoring

```
importance_weight = recency(last_seen, halfLifeDays)
                  × frequencyAmplifier(frequency_count)   // 1 + ln(count)
                  × coOccurrenceBoost(neighbor_strengths)

recency(t, h) = exp(-ln(2) / h × daysSince(t))

Tier thresholds (configurable):
  ACTIVE  score >= 0.6   → injected at boot
  MILD    score >= 0.3   → available on search
  LESS    score < 0.3    → scheduled for pruning
  SLEEPING               → cold-stored (Phase 9)
```

### observation_type half-lives

| Type | Half-life |
|------|-----------|
| All standard types | `config.halfLifeDays` (default 14) |
| `trace_fix` | `min(config.halfLifeDays, 7)` — stale fixes decay faster |

---

## Memory Pipeline

```
Claude Code session
       │
       │ PostToolUse hook
       ▼
data/flash/{session-id}.json          ← raw tool-use events, scored live
       │
       │ Stop hook (or manual: theorex flush)
       ▼
data/stm.jsonl                        ← Short-Term Memory, 14-day rolling JSONL
       │
       │ theorex graduate (score >= threshold × 7 consecutive days)
       ▼
~/.openclaw/agents/{id}/theorex/axon.json   ← Long-Term Axon (Graphology graph)
       │
       │ theorex promote (score > promotionThreshold)
       ▼
~/.openclaw/workspace/theorex/shared-axon.json   ← Shared multi-agent web
       │
       │ theorex boot-inject
       ▼
~/.openclaw/workspace/theorex/SHARED_CONTEXT.md  ← injected at session start
```

---

## Execution Layer

### Dispatch (Phase 16)

Fire-and-forget to local LLM. Caller pre-generates `trace_id` — EventBus uses it so the trace file is addressable before it's written.

```typescript
// DispatchTask
{
  id: string;
  agent_id: string;
  task: string;
  context_pct: number;        // trigger threshold (default 50%)
  query_tokens: number;
  tags: string[];
  outcome_id?: string;        // if set, trace_id is patched onto this outcome on success
}

// DispatchResult
{
  task_id: string;
  model_used: string;         // "qwen3-32b" | "ministral-3b"
  response: string;
  latency_ms: number;
  success: boolean;
  written_to_axon: boolean;
  trace_id?: string;          // the EventBus trace ID (deterministic, pre-generated)
}
```

### Routing priority (highest → lowest)

1. **Role registry** (`src/roles/registry.ts`) — operative's `model_preference` wins if it matches the query type
2. **EnergyDispatch** (`src/router/energy.ts`) — `pmset` battery check, downgrades `large→medium` below 20%
3. **ConfidenceMatrix** (`src/router/confidence-matrix.ts`) — empirical win-rate data after ≥5 samples per `(query_type, model)` cell; composite score = `0.6 × success_rate + 0.4 × (1 − normalized_latency)`
4. **HeuristicRouter** (`src/router/heuristic.ts`) — 7 keyword tiers: `code`, `math`, `retrieval`, `synthesis`, `creative`, `safety`, `general`

### EventBus (Phase 15.5)

```typescript
// LM_INFERENCE_START → LM_INFERENCE_END auto-assembles TraceRecord
// Caller-supplied trace_id is honoured — EventBus uses it instead of randomUUID()

bus.emit("LM_INFERENCE_START", {
  agent_id, model, prompt_tokens, query_type,
  trace_id: preGeneratedId,   // ← pre-generated by worker.ts
});
// ... inference ...
bus.emit("LM_INFERENCE_END", { agent_id, model, ..., success, latency_ms });
// → writes data/traces/{trace_id}.json atomically (tmp → rename)
```

TraceRecord `tags[0]` = `query_type` — the ConfidenceMatrix reads this to populate cells correctly.

---

## Evolution Layer

### Outcome recording (Phase 13)

```typescript
interface OutcomeRecord {
  id: string;
  agent_id: string;
  decision: string;
  result: string;
  success: boolean;
  concept_ids: number[];
  tags: string[];
  explicit_score?: number;    // 0.0–1.0 API-provided
  thumbs_up?: boolean;
  judge_score?: number;       // 0.0–1.0 async LLM judge
  trace_id?: string;          // linked TraceRecord — set automatically by dispatch()
}

// composite score: weighted average of whichever channels are present
// weights: explicit=40%, thumbs=20%, judge=40% (rebalanced if channels absent)
// fallback: success → 0.6, failure → 0.0
```

### Trace Review (Phase 20)

Nightly pass over `data/outcomes/` — for every failure with `compositeScore ≤ 0.3`:

1. Load linked `data/traces/{trace_id}.json`
2. Build structured prompt: `[outcome decision + result + tags] + [trace model/tokens/latency/error/events]`
3. POST to Qwen3 32B (`localhost:8082`), fallback Ministral 3B (`localhost:1234`), 45s timeout
4. Parse response JSON `{ score: 0.0–1.0, fix_description: string }`
5. `writeToAgent(agent_id, "trace_fix: {fix_description}", config, Date.now(), "trace_fix")`
6. Return `TraceReviewRecord` — always returned, even on LLM failure (stub with `written_to_axon: false`)

```bash
# Standalone
theorex trace-review --agent main

# Runs automatically inside evolve-review
theorex evolve-review --agent all
```

### Gated Learning (Phase 13)

Policy snapshots saved to `data/policy-snapshots/`. Gate threshold: 2% improvement required before a policy update is committed. Prevents thrashing on noisy outcome data.

---

## MCP Server (Phase 19)

JSON-RPC 2.0 HTTP server. Exposes read/write/search over the agent axon to any external tool.

```bash
theorex mcp-start --port 18800 --agent main
```

**Supported methods** (`tools/call` with `name`):

| name | params | description |
|------|--------|-------------|
| `status` | — | agent name, concept count, top ACTIVE concepts |
| `search` | `query: string` | BM25 + vector hybrid search |
| `write` | `text: string` | extract concepts + write to axon |
| `promote` | — | promote qualifying concepts to shared web |
| `boot-inject` | — | regenerate SHARED_CONTEXT.md |

### A2A Task Protocol (Phase 19)

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

Tasks stored in `data/a2a/{to_agent}/`. Agents poll via `theorex a2a-tasks --agent <id>`.

---

## Agent Roles (Phase 18)

```typescript
interface AgentProfile {
  agent_id: string;
  role: "orchestrator" | "operative";
  capabilities: QueryType[];   // "code" | "math" | "retrieval" | "synthesis" | "general"
  model_preference: string;    // "qwen3-32b" | "ministral-3b" | "claude-sonnet"
  active: boolean;
}
```

`routeToAgent(queryType, profiles)` — returns the highest-priority operative whose capabilities include the query type. Used by dispatch to override heuristic model selection.

---

## Full Learning Loop

```
dispatch(task, {outcome_id})
  ↓
emit LM_INFERENCE_START (trace_id = preGeneratedUUID)
  ↓
callLmStudio() → success/failure
  ↓
emit LM_INFERENCE_END
  ↓
EventBus.handleInferenceEnd()
  → TraceRecord written to data/traces/{trace_id}.json
  ↓
patchOutcomeTraceId(outcome_id, trace_id)   ← atomic, immutable
  ↓
[3am PM2 cron] theorex evolve-review --agent all
  → reviewOutcomes() + refineFromReport()   ← pattern win-rate analysis
  → reviewAllFailures()
       filter: success=false AND compositeScore ≤ 0.3
       for each:
         loadTrace(outcome.trace_id)
         buildTraceReviewPrompt(outcome, trace)
         callReviewer() → Qwen3 primary / Ministral fallback
         parseReviewerResponse() → {score, fix_description}
         writeToAgent(agent_id, "trace_fix: ...", "trace_fix")
  ↓
[3am PM2 cron continues] theorex promote + boot-inject
  → trace_fix concepts in SHARED_CONTEXT.md at next session start
  → trace_fix half-life = 7 days (decays in scan.ts)
```

---

## Configuration

`config.json` in project root — all optional, merged with defaults at startup.

```json
{
  "halfLifeDays": 14,
  "activeThreshold": 0.6,
  "mildThreshold": 0.3,
  "pruneThresholdDays": 30,
  "promotionThreshold": 0.5,
  "evolveWindowDays": 7,
  "lmStudioUrl": "http://localhost:1234",
  "lmStudioEmbedModel": "nomic-embed-text-v1.5",
  "agentAxonDir": "~/.openclaw/agents",
  "sharedAxonPath": "~/.openclaw/workspace/theorex/shared-axon.json",
  "outcomesDir": "data/outcomes",
  "coldStorePath": "data/cold-store.db"
}
```

---

## File Layout

```
src/
├── axon/           scan.ts prune.ts store.ts scorer.ts propagate.ts
├── short-term/     store.ts search.ts graduate.ts
├── flash/          store.ts inject.ts
├── moments/        capture.ts store.ts search.ts
├── family/         write.ts paths.ts
├── rag/            semantic-index.ts bootstrap.ts
├── trace/          bus.ts index.ts
├── router/         heuristic.ts confidence-matrix.ts energy.ts
├── dispatch/       worker.ts index.ts
├── roles/          registry.ts index.ts
├── evolve/         outcome.ts review.ts refine.ts gated-learning.ts trace-review.ts
├── memory/         boot-aware.ts
├── mcp/            server.ts
├── a2a/            tasks.ts
├── audit/          logger.ts reader.ts scorer.ts
├── vision/         video.ts ingest.ts store.ts
├── code/           parse.ts parse-multi.ts ingest.ts
└── cli/            index.ts

data/               (gitignored)
├── axon.json
├── stm.jsonl
├── embeddings.jsonl
├── traces/
├── outcomes/
├── moments/
├── flash/
├── traces/
└── evolution.jsonl

tests/              826 tests across all modules + e2e CLI
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
  boot-inject
  session-summary --agent <id> --investigated --learned --completed --next
  synthesize     --agent <id> <text>

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
  boot-aware     [--model <name>] [--agent <id>]

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

MCP / A2A
  mcp-start      [--port <n>] [--agent <id>]
  a2a-tasks      [--agent <id>]

Multi-agent
  query-shared
  ingest         --agent <id> <files>
  context-monitor --session <id>
```

---

## Tests

```bash
bun test               # 826 tests, all phases
bun test tests/evolve  # Evolution layer only
bun test src/tests/e2e.test.ts  # CLI integration (spawns real subprocesses)
```

Tests use `process.execPath` (not `"bun"`) for subprocess spawning — works on any machine regardless of PATH.

---

## Quick Start

```bash
git clone https://github.com/LORD-ZYTHOZ/theorex
cd theorex
bun install

# Write a concept
bun run src/cli/index.ts write --agent main "TTL invalidation prevents cache stampedes"

# Record a dispatch outcome and link it
bun run src/cli/index.ts outcome --agent main \
  --decision "use aggressive in-process cache" \
  --result "stale data served for 10 minutes after deploy" \
  --fail --tags caching

# Dispatch background analysis (links trace to outcome automatically)
bun run src/cli/index.ts dispatch "diagnose cache invalidation failure" \
  --agent main --context 60 --outcome-id <id>

# Run evolution (includes trace review)
bun run src/cli/index.ts evolve-review --agent main

# Regenerate boot context
bun run src/cli/index.ts promote --agent main
bun run src/cli/index.ts boot-inject
```

---

<div align="center">

MIT License · [Bun](https://bun.sh) · TypeScript

</div>
