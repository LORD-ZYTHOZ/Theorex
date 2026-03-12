# Phase 2: Short-Term Lobe - Research

**Researched:** 2026-03-11
**Domain:** JSONL append-only storage, BM25 keyword search, vector semantic search, hybrid RRF fusion, auto-graduation to long-term
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STM-01 | Write session entries to append-only JSONL files at data/short-term/YYYY-MM-DD.jsonl | Bun.JSONL built-in + Bun.file().stream() append pattern |
| STM-02 | Auto-delete JSONL files older than 14 days | `fs/promises` readdir + Date comparison + unlink pattern |
| STM-03 | BM25 keyword search with field weighting | wink-bm25-text-search v2.x — defineConfig fldWeights, addDoc, consolidate, search |
| STM-04 | Vector semantic search using local embeddings | LM Studio POST /v1/embeddings (OpenAI-compat), cosine similarity |
| STM-05 | Hybrid BM25 + vector via RRF; degrade to BM25-only when embedder unavailable | Reciprocal Rank Fusion (k=60), try/catch on fetch for graceful degradation |
| STM-06 | Graduate ACTIVE entries present 7+ consecutive days to long-term | Date range scan across JSONL files + existing writeMemoryAtomic writer |
| CLI-05 | `theorex search <query>` — hybrid search over short-term | Wire STM-03/04/05 to CLI dispatch in cli/index.ts |
| CLI-06 | `theorex graduate` — promote eligible short-term entries to long-term | Wire STM-06 to CLI dispatch + existing MEMORY.md parser/writer |
</phase_requirements>

---

## Summary

Phase 2 builds the short-term lobe on top of the completed Phase 1 infrastructure. Session entries are written as append-only JSONL lines in daily files under `data/short-term/`. Searching those files requires two parallel pipelines: BM25 keyword matching (wink-bm25-text-search, CJS, in-memory index rebuilt at query time from JSONL) and vector semantic search (LM Studio POST /v1/embeddings at localhost:1234). The two result lists are fused via Reciprocal Rank Fusion (RRF) — a rank-based merge that does not require score normalization and degrades naturally to BM25-only when the vector pipeline is unavailable.

Graduation logic (STM-06 / CLI-06) scans the 14-day JSONL window, identifies entries whose concept appears in ACTIVE status for 7 or more consecutive calendar days, and writes those entries as new sections into MEMORY.md via the existing `writeMemoryAtomic` + `parseMemory` / `serializeMemory` infrastructure from Phase 1. No new storage format is needed for graduation.

The dominant implementation risk is the CJS/ESM boundary for wink-bm25-text-search. Bun 1.3.10 resolves this transparently: `import` and `require` can coexist in the same file and Bun handles interop automatically. A minimal spike test should confirm this before the main implementation plan is written.

**Primary recommendation:** Use wink-bm25-text-search for BM25 (rebuild index from JSONL each query — dataset is ≤14 days, small), LM Studio /v1/embeddings for vectors, RRF(k=60) for fusion, try/catch on fetch for graceful degradation, and reuse Phase 1's writeMemoryAtomic + parseMemory for graduation writes.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| wink-bm25-text-search | ^2.2.3 (latest on npm) | BM25 full-text search with field weighting | Only production-grade BM25 in the Node/Bun ecosystem; defineConfig fldWeights directly supports field-level scoring |
| Bun.JSONL (built-in) | Bun 1.3.10 | Parse JSONL files into record arrays | Zero-dep, C++ implementation, already in runtime |
| Bun.file / node:fs/promises | Bun 1.3.10 | JSONL append writes and file rotation | Consistent with Phase 1 patterns (writeMemoryAtomic uses same primitives) |
| LM Studio /v1/embeddings | HTTP API | Local vector embeddings | Project decision — local only, no cloud dependency (see REQUIREMENTS.md Out of Scope) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| compromise (already installed) | ^14.15.0 | Tokenization for BM25 prep tasks | Reuse existing dependency for text normalization before addDoc |
| node:fs/promises (built-in) | Bun 1.3.10 | readdir, unlink for 14-day rotation | Use for file system operations outside Bun.file's scope |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| wink-bm25-text-search | minisearch | minisearch is ESM-first and has TypeScript types, but uses TF-IDF not BM25; project MEMORY.md already named wink-bm25 as the chosen library |
| wink-bm25-text-search | flexsearch | flexsearch has no BM25 mode — pure inverted index; doesn't satisfy STM-03 |
| LM Studio fetch | @lmstudio/sdk | SDK is higher-level but adds a dependency; raw fetch keeps the stack lean and the graceful-degradation pattern simpler |
| RRF | score normalization (min-max) | Score normalization causes inter-modality bias; RRF is rank-based so incompatible score scales never interact |

**Installation:**
```bash
bun add wink-bm25-text-search
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── short-term/
│   ├── store.ts         # JSONL append writer (STM-01), rotation (STM-02)
│   ├── search.ts        # hybrid search entry point — calls bm25Search + vectorSearch + rrf (STM-03/04/05)
│   ├── bm25.ts          # BM25 index build + search using wink-bm25-text-search
│   ├── embedder.ts      # LM Studio fetch wrapper with graceful degradation
│   ├── rrf.ts           # Reciprocal Rank Fusion implementation
│   └── graduate.ts      # 7-day consecutive ACTIVE detection + MEMORY.md write (STM-06)
tests/
└── short-term/
    ├── store.test.ts
    ├── bm25.test.ts
    ├── embedder.test.ts
    ├── rrf.test.ts
    └── graduate.test.ts
data/
└── short-term/           # YYYY-MM-DD.jsonl files (created at runtime)
```

### Pattern 1: JSONL Append Write (STM-01)

**What:** Each session event is serialized as a JSON line and appended to today's file.
**When to use:** Every time an entry is recorded to short-term memory.

JSONL files are append-only — no atomic rename needed for appends (append is safe on local filesystems at single-writer scale). However, Phase 3 will introduce concurrent hook writers; design the append function to accept a file handle or use `O_APPEND` semantics.

```typescript
// src/short-term/store.ts
// Source: Bun.file API docs (https://bun.sh/docs/api/file-io)
import { mkdir } from "node:fs/promises";

export interface ShortTermEntry {
  readonly id: string;           // crypto.randomUUID()
  readonly concept_id: number;   // from ConceptEvent
  readonly surface_form: string;
  readonly composite_score: number;
  readonly source_weight: number;
  readonly timestamp: string;    // ISO 8601
  readonly date: string;         // YYYY-MM-DD (derived from timestamp for fast rotation)
}

const STM_DIR = "data/short-term";

export async function appendEntry(entry: ShortTermEntry): Promise<void> {
  const path = `${STM_DIR}/${entry.date}.jsonl`;
  await mkdir(STM_DIR, { recursive: true });
  // Bun.write with content argument opens in append mode when file exists
  await Bun.write(
    Bun.file(path),
    JSON.stringify(entry) + "\n",
    { createPath: true }
  );
}
```

**IMPORTANT:** Bun.write with a BunFile reference replaces content. For true append, use node:fs `appendFile` or `open` with `flag: "a"`.

```typescript
// Correct append pattern using node:fs/promises
import { appendFile, mkdir } from "node:fs/promises";

export async function appendEntry(entry: ShortTermEntry): Promise<void> {
  const path = `${STM_DIR}/${entry.date}.jsonl`;
  await mkdir(STM_DIR, { recursive: true });
  await appendFile(path, JSON.stringify(entry) + "\n");
}
```

### Pattern 2: JSONL Rotation — Auto-Delete Files > 14 Days (STM-02)

**What:** On each `appendEntry` call (or on a scheduled scan), delete JSONL files whose date prefix is older than 14 days from today.
**When to use:** Called from `appendEntry` or a dedicated `rotateStm()` function.

```typescript
// src/short-term/store.ts
import { readdir, unlink } from "node:fs/promises";

export async function rotateStm(today: Date = new Date()): Promise<number> {
  const files = await readdir(STM_DIR).catch(() => [] as string[]);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 14);
  let deleted = 0;
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const dateStr = file.replace(".jsonl", ""); // "YYYY-MM-DD"
    const fileDate = new Date(dateStr + "T00:00:00Z");
    if (fileDate < cutoff) {
      await unlink(`${STM_DIR}/${file}`);
      deleted++;
    }
  }
  return deleted;
}
```

### Pattern 3: BM25 Index — Rebuild Per Query (STM-03)

**What:** wink-bm25-text-search is an in-memory engine. For ≤14 days of session data (small corpus), rebuild the index on each search call from the full JSONL window.
**When to use:** Every `search()` invocation. If query latency becomes an issue in Phase 3+, persist exportJSON/importJSON.

```typescript
// src/short-term/bm25.ts
// Source: https://github.com/winkjs/wink-bm25-text-search
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bm25 = require("wink-bm25-text-search");

export interface SearchResult {
  readonly id: string;
  readonly score: number;
  readonly entry: ShortTermEntry;
}

export function buildBm25Index(entries: ShortTermEntry[]) {
  const engine = bm25();
  engine.defineConfig({
    fldWeights: {
      surface_form: 3,   // concept label — highest weight
      composite_score: 0, // numeric — not tokenized, skip
    },
    ovFldNames: ["id"],  // retain id for result lookup
  });
  // Prep: lowercase + split into tokens
  engine.definePrepTasks([(text: string) => text.toLowerCase().split(/\s+/)]);

  entries.forEach((entry, i) => {
    engine.addDoc({ surface_form: entry.surface_form, id: entry.id }, i);
  });
  engine.consolidate();
  return engine;
}

export function bm25Search(
  engine: ReturnType<typeof bm25>,
  query: string,
  limit = 10
): Array<[number, number]> {
  // Returns [[uniqueId (index), score], ...]
  return engine.search(query, limit);
}
```

**CRITICAL:** wink-bm25-text-search is CJS. Use `createRequire(import.meta.url)` — Bun 1.3.10 handles CJS/ESM interop transparently.

### Pattern 4: Vector Embeddings with Graceful Degradation (STM-04/05)

**What:** POST to LM Studio /v1/embeddings. If unavailable (ECONNREFUSED, timeout, any error), return null and caller falls back to BM25-only.
**When to use:** Every `search()` call — always attempt, always handle failure.

```typescript
// src/short-term/embedder.ts
// Source: https://lmstudio.ai/docs/developer/openai-compat/embeddings

const LM_STUDIO_URL = "http://localhost:1234/v1/embeddings";
const EMBED_TIMEOUT_MS = 3000; // 3 second max wait

export async function embedText(text: string, model = "nomic-embed-text-v1.5"): Promise<number[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    const response = await fetch(LM_STUDIO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [text], model }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0]?.embedding ?? null;
  } catch {
    // LM Studio unavailable — caller degrades to BM25-only
    return null;
  }
}
```

### Pattern 5: Reciprocal Rank Fusion (STM-05)

**What:** RRF merges BM25 rank list and vector rank list into a single fused ranking without requiring score normalization. Standard constant k=60.
**When to use:** Always in hybrid mode; skip vector merge if vector results are null (degraded mode).

```typescript
// src/short-term/rrf.ts
// Formula: score(d) = Σ 1 / (k + rank_i(d))  where k = 60
// Source: Cormack et al., SIGIR 2009 — industry standard

const RRF_K = 60;

export interface RankedId {
  readonly id: string;
  readonly rank: number; // 1-based
}

export function reciprocalRankFusion(
  bm25Results: RankedId[],
  vectorResults: RankedId[] | null
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  const addResults = (results: RankedId[]) => {
    for (const { id, rank } of results) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
    }
  };

  addResults(bm25Results);
  if (vectorResults !== null) {
    addResults(vectorResults);
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

### Pattern 6: Graduation — 7 Consecutive ACTIVE Days (STM-06)

**What:** Read all JSONL files in the 14-day window. Group entries by concept_id. For each concept, find runs of consecutive calendar days where the entry was present (proxy for ACTIVE). If any run >= 7 days, write that concept to MEMORY.md using Phase 1's infrastructure.
**When to use:** `theorex graduate` CLI command.

```typescript
// src/short-term/graduate.ts
// Graduation writes to MEMORY.md via existing Phase 1 infrastructure:
// - readMemory, writeMemoryAtomic from src/memory/writer.ts
// - parseMemory, serializeMemory from src/memory/parser.ts

export async function findGraduateCandidates(
  entries: ShortTermEntry[]
): Promise<ShortTermEntry[]> {
  // Group by concept_id, collect unique calendar dates
  const byConceptId = new Map<number, Set<string>>();
  for (const entry of entries) {
    const set = byConceptId.get(entry.concept_id) ?? new Set<string>();
    set.add(entry.date);
    byConceptId.set(entry.concept_id, set);
  }

  const candidates: ShortTermEntry[] = [];
  for (const [conceptId, dates] of byConceptId) {
    if (hasConsecutiveRun(dates, 7)) {
      // Use the most recent entry for this concept as the graduation record
      const latest = entries
        .filter((e) => e.concept_id === conceptId)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      if (latest) candidates.push(latest);
    }
  }
  return candidates;
}

function hasConsecutiveRun(dateStrings: Set<string>, minDays: number): boolean {
  const sorted = Array.from(dateStrings).sort();
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00Z");
    const curr = new Date(sorted[i] + "T00:00:00Z");
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
    run = diffDays === 1 ? run + 1 : 1;
    if (run >= minDays) return true;
  }
  return run >= minDays;
}
```

### Anti-Patterns to Avoid

- **In-memory-only index between searches:** Fine for Phase 2 (small corpus, rebuild on query), but must export/import if corpus grows. Don't assume rebuild is always acceptable.
- **Calling Bun.write(Bun.file(path), content) expecting append:** Bun.write replaces. Use `appendFile` from `node:fs/promises` for true append semantics.
- **Hardcoding LM Studio model name:** Model name varies by what the user has loaded. Use a configurable default or accept from config.json.
- **Blocking on vector embeddings:** The 3-second timeout MUST be enforced. A slow or unresponsive LM Studio server must not block the CLI.
- **Mutating parsed MEMORY.md sections in-place:** Phase 1 invariant — always use `parseMemory` + immutable section spread + `serializeMemory` + `writeMemoryAtomic`. Never concatenate strings directly to MEMORY.md.
- **No consecutive-day window for graduation:** Simply checking "was active on 7 distinct days" is insufficient — must be 7 CONSECUTIVE calendar days per STM-06 spec.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BM25 scoring | Custom TF-IDF or inverted index | wink-bm25-text-search | BM25 has non-obvious IDF formula; field weighting, term saturation (k1), length normalization (b) are all handled correctly by the library |
| Vector cosine similarity ranking | Custom kNN over stored embeddings | Simple dot product on query vector vs. stored vectors — cosine similarity is ~5 lines of code | No need for a vector database at Phase 2 scale (≤14 days). Hand-roll cosine similarity but do NOT hand-roll BM25 |
| JSONL parsing | Custom line-split parser | `Bun.JSONL.parse()` | Already in runtime, C++ performance, handles edge cases |
| Rank fusion formula | Custom score blending | RRF formula (1/(k+rank)) | Score normalization is a known failure mode; RRF avoids the problem entirely by using ranks |

**Key insight:** The BM25 formula looks simple but has subtle correctness requirements (IDF smoothing, document length normalization). wink-bm25-text-search has been in production use since 2017 with many real-world validations.

---

## Common Pitfalls

### Pitfall 1: Bun.write Does Not Append

**What goes wrong:** `await Bun.write(Bun.file("path"), line)` replaces the file content. The second entry overwrites the first — JSONL file contains only the last entry written.
**Why it happens:** Bun.write is an atomic replace-write, not an append. The BunFile abstraction does not expose `O_APPEND`.
**How to avoid:** Use `appendFile(path, line)` from `node:fs/promises` for all JSONL appends.
**Warning signs:** JSONL files contain only one entry; test that writes two entries and reads both back fails.

### Pitfall 2: wink-bm25-text-search CJS Import in ESM Project

**What goes wrong:** `import bm25 from 'wink-bm25-text-search'` fails with SyntaxError or `bm25 is not a function` because the package is CJS with no ESM export.
**Why it happens:** package.json has no `"type": "module"` and no `"exports"` field — it is pure CJS.
**How to avoid:** Use `createRequire(import.meta.url)` pattern. Bun 1.3.10 handles CJS/ESM interop — no special Bun configuration needed.
**Warning signs:** Runtime error about `module.exports` or `require is not defined`.

### Pitfall 3: BM25 Engine Must Be Consolidated Before Search

**What goes wrong:** Calling `engine.search()` before `engine.consolidate()` throws or returns empty results. This is a hard pre-condition enforced by wink-bm25-text-search.
**Why it happens:** BM25 IDF scores require knowing the full corpus size. `consolidate()` computes global IDF statistics.
**How to avoid:** Always call `addDoc()` for all documents, then `consolidate()`, then `search()` — in that exact order.
**Warning signs:** Empty results or thrown errors on first search call.

### Pitfall 4: LM Studio May Not Have an Embedding Model Loaded

**What goes wrong:** Request to /v1/embeddings returns 400 or 500 because no embedding model is loaded in LM Studio (only a chat model is active).
**Why it happens:** LM Studio loads models on demand; the user may not have loaded an embedding model.
**How to avoid:** The embedder MUST treat ANY non-200 response as "unavailable" and return null. The test suite for STM-04 must mock the LM Studio endpoint.
**Warning signs:** `theorex search` crashes or hangs when LM Studio is open but no embedding model is active.

### Pitfall 5: Graduation Writes Duplicate Sections to MEMORY.md

**What goes wrong:** Running `theorex graduate` twice promotes the same concept twice, creating duplicate sections in MEMORY.md.
**Why it happens:** No idempotency check before writing.
**How to avoid:** Before writing a graduated entry, check if a section with the same heading already exists in `parseMemory(await readMemory()).sections`. Skip if found.
**Warning signs:** MEMORY.md grows on every `graduate` run even when no new candidates exist.

### Pitfall 6: Cosine Similarity with Math.hypot() Fails on Large Embedding Vectors

**What goes wrong:** `Math.hypot(...vecA)` uses the spread operator. For embedding dimensions > ~1000, this can exceed the call stack or V8 argument limit.
**Why it happens:** JavaScript function calls have a maximum argument count (~65,536 in V8).
**How to avoid:** Compute magnitude with a reduce loop: `Math.sqrt(vecA.reduce((sum, v) => sum + v * v, 0))`.
**Warning signs:** Stack overflow or `RangeError: Maximum call stack size exceeded` when processing embeddings from large models.

---

## Code Examples

Verified patterns from official sources:

### Bun.JSONL.parse() — Read All Records from a JSONL File

```typescript
// Source: https://bun.sh/docs/runtime/jsonl
async function readShortTermFile(path: string): Promise<ShortTermEntry[]> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) return [];
  const text = await file.text();
  return Bun.JSONL.parse(text) as ShortTermEntry[];
}
```

### LM Studio Embeddings — OpenAI-Compatible Request

```typescript
// Source: https://lmstudio.ai/docs/developer/openai-compat/embeddings
// Base URL: http://localhost:1234/v1
// Auth: any non-empty string (LM Studio ignores API keys in local mode)
const response = await fetch("http://localhost:1234/v1/embeddings", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer lm-studio",  // required by spec, value ignored
  },
  body: JSON.stringify({
    input: ["text to embed"],
    model: "nomic-embed-text-v1.5",  // model name must match what's loaded in LM Studio
  }),
});
const data = await response.json();
const vector: number[] = data.data[0].embedding;
```

### Cosine Similarity — Large Vector Safe

```typescript
// Source: https://alexop.dev/posts/how-to-implement-a-cosine-similarity-function-in-typescript-for-vector-comparison/
// Modified: use reduce() instead of Math.hypot(...) for large embedding dimensions
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Dimension mismatch");
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}
```

### wink-bm25-text-search — CJS Import in ESM/Bun Project

```typescript
// Source: Bun docs (https://bun.sh/blog/commonjs-is-not-going-away) + GitHub winkjs/wink-bm25-text-search
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bm25: () => ReturnType<typeof import("wink-bm25-text-search")> = require("wink-bm25-text-search");
const engine = bm25();

engine.defineConfig({
  fldWeights: { surface_form: 3 },
  ovFldNames: ["id"],
});
engine.definePrepTasks([(t: string) => t.toLowerCase().split(/\W+/).filter(Boolean)]);
engine.addDoc({ surface_form: "machine learning", id: "entry-001" }, 0);
engine.consolidate();
const results = engine.search("learning", 5);
// results: [[0, 0.234], ...]  [uniqueId, score]
```

### Config Extension for Phase 2

```typescript
// src/config.ts — add to existing Config interface
export interface Config {
  halfLifeDays: number;
  activeThreshold: number;
  mildThreshold: number;
  pruneThresholdDays: number;
  edgePruneThreshold: number;
  // Phase 2 additions:
  stmRetentionDays: number;      // default: 14
  stmGraduateDays: number;       // default: 7
  lmStudioUrl: string;           // default: "http://localhost:1234"
  lmStudioEmbedModel: string;    // default: "nomic-embed-text-v1.5"
  lmStudioTimeoutMs: number;     // default: 3000
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual score normalization for hybrid search | Reciprocal Rank Fusion (RRF) | Cormack et al. 2009 / mainstream ~2022 | No score calibration needed; works correctly even when BM25 and vector scores are on incompatible scales |
| Node.js readline for JSONL parsing | Bun.JSONL.parse() built-in | Bun 1.1+ | Zero-dependency, C++ speed, simpler code |
| External embedding APIs | Local models via LM Studio | 2023-2024 | Privacy-preserving, no latency variability, no cost per call |

**Deprecated/outdated:**
- SQLite for short-term storage: Out of scope per REQUIREMENTS.md — "SQLite or any database: Flat-file architecture correct at v1 scale; JSONL + JSON only"
- Generic document search / RAG-as-retrieval: Explicitly out of scope per REQUIREMENTS.md

---

## Open Questions

1. **wink-bm25-text-search Bun interop at runtime (not just import)**
   - What we know: Package is CJS; Bun 1.3.10 handles CJS/ESM interop transparently; `createRequire` pattern works in Node.js and Bun
   - What's unclear: Whether wink-bm25-text-search uses any CJS-specific globals that Bun's CJS shim doesn't cover
   - Recommendation: First task in Phase 2 plan should be a spike test — `bun run` a 5-line file that imports via createRequire, adds a doc, consolidates, and searches. Gate the main implementation on this passing.

2. **Graduation write format — what section heading to use in MEMORY.md?**
   - What we know: MEMORY.md uses `## SectionName` headings per parser.ts; existing sections are human-authored (e.g., `## System`, `## Tools & Resources`)
   - What's unclear: Should graduated short-term entries become their own `## ConceptName` sections, or be appended into an existing `## Short-Term Graduates` section?
   - Recommendation: Create a `## Short-Term Graduates` section on first graduation run; append graduated entries as `### ConceptName` subsections within it. This preserves the byte-identical round-trip invariant and keeps automated content separate from human-authored sections.

3. **BM25 index rebuild latency at 14-day window scale**
   - What we know: wink-bm25-text-search is in-memory; 14 days of session entries is likely <1000 entries total; index rebuild is O(n * avg_tokens)
   - What's unclear: Actual latency in Bun on M4 Pro for a realistic corpus size
   - Recommendation: Implement rebuild-per-query for Phase 2 (YAGNI). Add exportJSON/importJSON caching only if bun test shows rebuild > 100ms.

---

## Sources

### Primary (HIGH confidence)
- `https://bun.sh/docs/runtime/jsonl` — Bun.JSONL.parse(), parseChunk(), streaming API
- `https://lmstudio.ai/docs/developer/openai-compat/embeddings` — LM Studio /v1/embeddings endpoint format, base URL, request/response shape
- `https://github.com/winkjs/wink-bm25-text-search` — defineConfig, addDoc, consolidate, search API (verified via README fetch)

### Secondary (MEDIUM confidence)
- `https://alexop.dev/posts/how-to-implement-a-cosine-similarity-function-in-typescript-for-vector-comparison/` — TypeScript cosine similarity with reduce() — verified pattern, not library
- `https://weaviate.io/blog/hybrid-search-explained` — RRF(k=60) as industry standard for hybrid BM25 + vector fusion
- `https://bun.sh/blog/commonjs-is-not-going-away` — Bun CJS/ESM interop: import and require can coexist

### Tertiary (LOW confidence)
- WebSearch result: wink-bm25-text-search package.json has no `"type": "module"` field — inferred CJS-only, not directly verified from raw file (GitHub returned 429)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — wink-bm25-text-search API verified from GitHub README; Bun.JSONL verified from official Bun docs; LM Studio /v1/embeddings verified from official LM Studio docs
- Architecture: HIGH — patterns derived from verified library APIs and existing Phase 1 codebase patterns (writeMemoryAtomic, parseMemory)
- Pitfalls: HIGH for Bun.write/append and BM25 consolidate (verified from API docs); MEDIUM for CJS import (wink package.json inferred from WebSearch, not direct read)

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable libraries — 30 days reasonable)
