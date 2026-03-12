# Axon Integration

Theorex and [Axon](https://github.com/LORD-ZYTHOZ/axon) are complementary memory systems. Together they give AI agents both **conceptual memory** (what matters, decisions, patterns) and **code memory** (symbols, call graphs, API endpoints).

---

## Overview

| System | What it stores | Storage | Query |
|--------|---------------|---------|-------|
| **Theorex** | Concepts, decisions, patterns, episodic events | JSON concept graph | CLI / boot injection |
| **Axon** | Code symbols, API endpoints, dependencies, call graphs | pgvector (PostgreSQL) | REST API / MCP |

Both use **nomic-embed-text-v1.5** via LM Studio — same vector space, compatible similarity scores.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         AI Agent                              │
│                                                              │
│  Boots with SHARED_CONTEXT.md (Theorex concepts)            │
│  Queries Axon MCP for code context on demand                │
└───────────────┬──────────────────────────────┬──────────────┘
                │                              │
                ▼                              ▼
┌───────────────────────┐        ┌─────────────────────────────┐
│       Theorex         │        │           Axon              │
│                       │        │                             │
│  Concept web (JSON)   │        │  FastAPI + Celery           │
│  Decay + promotion    │        │  pgvector (PostgreSQL)      │
│  Boot injection       │        │  Redis cache                │
│  Multi-agent shared   │        │  MCP server (port 8001)     │
└───────────────────────┘        └─────────────────────────────┘
                │                              │
                └──────────┬───────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │      LM Studio          │
              │  nomic-embed-text-v1.5  │
              │  http://host:1234/v1    │
              └─────────────────────────┘
```

---

## Setting Up Axon

Axon runs as a Docker stack. Clone and configure:

```bash
git clone https://github.com/LORD-ZYTHOZ/axon
cd axon/docker
cp .env.example .env
```

Edit `.env` to point at your LM Studio instance:

```env
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=lm-studio
OPENAI_BASE_URL=http://<lm-studio-host>:1234/v1
OPENAI_EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
OPENAI_EMBEDDING_DIMENSION=768
```

Start the stack:

```bash
docker compose up -d
```

Services:
- **API:** `http://localhost:8080` — REST API for indexing and search
- **MCP:** `http://localhost:8001/mcp` — Model Context Protocol server
- **UI:** `http://localhost:80` — Web dashboard
- **Grafana:** `http://localhost:3000` — Observability

---

## Setting Up Theorex Embeddings

Theorex uses the same LM Studio endpoint for RAG bootstrap. Set in `config.json`:

```json
{
  "lmStudioUrl": "http://<lm-studio-host>:1234",
  "lmStudioEmbedModel": "nomic-embed-text-v1.5"
}
```

Make sure LM Studio has `nomic-embed-text-v1.5` loaded. Auth can be disabled in LM Studio settings for local use.

---

## Connecting Axon to Claude Code

Add the Axon MCP server to your Claude Code config (`~/.claude/claude_desktop_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "axon": {
      "url": "http://localhost:8001/mcp",
      "transport": "http"
    }
  }
}
```

Claude can then call Axon tools directly:
- `get_module_summary` — summarise a module's purpose
- `search_symbols` — find functions/classes by name or description
- `get_dependencies` — list what a service depends on
- `list_api_endpoints` — enumerate REST endpoints

---

## Indexing a Repository

Point Axon at your codebase via the API or UI:

```bash
# Via API
curl -X POST http://localhost:8080/api/v1/repositories \
  -H "X-API-Key: <admin-key>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/org/repo", "name": "my-service"}'
```

Axon will clone the repo, parse symbols, build the call graph, and generate embeddings using LM Studio. Theorex will pick up code symbols on the next `ingest-code` run.

---

## Theorex Code Ingestion

Theorex's Phase 7 code reader can ingest symbols directly from local source:

```bash
bun run src/cli/index.ts ingest-code --agent main ./src
```

Supported: TypeScript, JavaScript, Python, Go.

Code symbols become `code_function` nodes in the concept web — the same graph as conceptual memory. This means:

- A decision about "use async/await" and the functions that implement it share the same graph
- Frequently-called functions gain higher importance scores
- Dead code (not referenced, not discussed) decays naturally

---

## Data Flow Example

1. Agent discusses a bug in `auth/middleware.ts`
2. Theorex captures: `authentication`, `middleware`, `session_token` as concepts
3. Axon has already indexed `auth/middleware.ts` symbols
4. At next boot, agent gets SHARED_CONTEXT.md with `authentication` as ACTIVE concept
5. Agent queries Axon MCP → gets `validateSession()` symbol with full context
6. Full picture: what the agent knows + where it lives in code

---

## Shared Embedding Model

Using the same model (nomic-embed-text-v1.5) across both systems means:

- Concept vectors and code symbol vectors are in the **same 768-dim space**
- Future: cross-system similarity search (find code related to a concept directly)
- Consistent embedding quality across all memory layers

LM Studio serves both systems on the same endpoint — no duplication, no drift between models.
