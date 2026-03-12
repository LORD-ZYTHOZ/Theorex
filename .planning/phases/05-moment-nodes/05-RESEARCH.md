# Phase 5: Moment Nodes — Research

**Researched:** 2026-03-11
**Domain:** Permanent concept anchors — immutable JSON store, search integration, context injection
**Confidence:** HIGH

## Summary

Phase 5 adds "moment nodes" — permanent AI photographs that are never pruned by decay or tier logic. Moments are stored as individual JSON files in `data/moments/`, separate from the Graphology axon graph and the short-term JSONL store. This separation is the key architectural choice: by living outside the axon graph, moment nodes are structurally immune to `pruneAxon`, `scanAxon` tier scoring, and edge dissolution — no guard code needed in prune or scan.

The phase is narrow and well-bounded. It needs: (1) a typed `MomentNode` shape and a store module (`src/moments/`), (2) a CLI handler `runMoment()` wired to the new `theorex moment <story>` subcommand, (3) BM25 search integration so `theorex search <query>` surfaces matching moments, and (4) context injection in `injectContext()` to include moments whose concept IDs overlap with current ACTIVE-tier nodes.

All infrastructure patterns are proven from prior phases. The file write, atomic save, BM25 index build, and inject patterns are all available as direct references. No new libraries are needed.

**Primary recommendation:** Store moments as individual JSON files in `data/moments/{uuid}.json` — one file per moment, never in the axon graph, never in JSONL. This makes the pruning immunity invariant structural rather than conditional.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MOM-01 | System can create moment nodes — permanent concept anchors tied to a specific point in time | `src/moments/store.ts` createMoment() writes `data/moments/{uuid}.json`; atomic write via Bun.write + rename |
| MOM-02 | Moment node stores: timestamp, story, code references (file:line), edges to related concepts | `MomentNode` interface; code references captured from current flash buffer or passed explicitly by CLI; related concept IDs resolved from processText() on the story |
| MOM-03 | Moment nodes are never pruned regardless of recency or frequency scores | Structural: moments live in `data/moments/` not in axon graph; pruneAxon never touches this directory |
| MOM-04 | Moment nodes are searchable and surface in context injection | BM25 search on story field; injectContext() reads `data/moments/` and matches by concept_id overlap with ACTIVE-tier nodes |
| CLI-07 | `theorex moment <story>` — create a moment node with current context | New `case "moment":` branch in `src/cli/index.ts`; handler `runMoment()` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:test` | Bun 1.3.10 | Test framework | Project standard per CLAUDE.md |
| `node:crypto` (`randomUUID`) | built-in | UUID for moment file names | Already used in short-term store; no extra dep |
| `node:fs/promises` (`mkdir`, `readdir`) | built-in | Directory creation and listing | Used throughout codebase |
| `Bun.file` / `Bun.write` | Bun 1.3.10 | Atomic JSON writes | Project preference per CLAUDE.md |
| `wink-bm25-text-search` | ^3.1.2 | BM25 search over moment stories | Already in package.json; same pattern as short-term search |

### No New Dependencies
All required functionality is available via existing libraries. No `npm install` needed.

**Installation:**
```bash
# No new packages — use existing dependencies
```

## Architecture Patterns

### Recommended Module Structure
```
src/moments/
├── store.ts         # createMoment, readMoments, loadMoment — file I/O only
└── search.ts        # buildMomentBm25Index, searchMoments — BM25 over stories

tests/moments/
├── store.test.ts    # unit: createMoment round-trip, atomic write, readMoments
└── search.test.ts   # unit: BM25 search over moment stories, MOM-04 overlap

data/moments/        # created lazily by createMoment (mkdir -p)
  {uuid}.json        # one file per moment
```

### Pattern 1: MomentNode Shape (MOM-02)
**What:** Typed interface for the JSON persisted in `data/moments/{uuid}.json`
**When to use:** Everywhere a moment is created, read, or searched

```typescript
// Fully locked shape — do not add mutable fields; all fields readonly
export interface MomentNode {
  readonly id: string;            // crypto.randomUUID() — also the file stem
  readonly timestamp: string;     // ISO 8601 — Date.now() at creation
  readonly story: string;         // human-readable description (from CLI arg)
  readonly code_refs: readonly CodeRef[];  // file:line references
  readonly concept_ids: readonly number[]; // IDs of related concepts from axon
}

export interface CodeRef {
  readonly file: string;   // relative path
  readonly line: number;   // line number
}
```

**Design notes:**
- `concept_ids` are IDs of axon concepts whose surface_form NLP-overlaps with the story text. Extracted via `processText()` from `src/index.ts` — the significance pipeline already does this.
- `code_refs` at CLI time: capture git-tracked modified files from `git diff --name-only HEAD` + current line 1 as a lightweight snapshot. This satisfies MOM-02 without requiring a full AST parser.
- Node type distinction: `MomentNode` is NOT a Graphology node — it is a standalone JSON document. The `NodeType = "moment"` discriminant in `src/types.ts` is already defined and is used in `ConceptEvent.node_type` when processing moment stories through the significance pipeline.

### Pattern 2: Atomic Write (MOM-01, MOM-03)
**What:** Write moment to temp file, rename atomically — same invariant as AxonStore.save() and LTM-04
**When to use:** `createMoment()` always

```typescript
// Source: established pattern from src/axon/store.ts and src/memory/writer.ts
export async function createMoment(
  moment: MomentNode,
  dir = MOMENTS_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${moment.id}.json`;
  const tmpPath = filePath + ".tmp";
  await Bun.write(tmpPath, JSON.stringify(moment, null, 2));
  await rename(tmpPath, filePath);
}
```

### Pattern 3: Read All Moments (MOM-03, MOM-04)
**What:** Read all `*.json` files from `data/moments/`; return empty array on missing dir
**When to use:** search, status, inject

```typescript
// Pattern matches readShortTermFiles() from src/short-term/store.ts
export async function readMoments(dir = MOMENTS_DIR): Promise<MomentNode[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const moments: MomentNode[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
    const raw = await Bun.file(`${dir}/${file}`).json().catch(() => null);
    if (raw !== null) moments.push(raw as MomentNode);
  }
  return moments;
}
```

### Pattern 4: BM25 Search over Moments (MOM-03)
**What:** Build wink-bm25 index over `story` field; return ranked MomentNode results
**When to use:** `theorex search <query>` must merge moment results with short-term results

```typescript
// Same wink-bm25-text-search CJS interop pattern as src/short-term/bm25.ts
// createRequire(import.meta.url) for CJS interop in Bun ESM
// Minimum 3 docs guard: pad with sentinels when moments.length < 3
```

**Search merge strategy for CLI-05:** `theorex search` currently returns `SearchResult[]` from `hybridSearch()`. For MOM-03, the simplest correct approach is to run BM25 over moments separately, then append moment results to the output with a `moment:` prefix in the displayed text. No RRF fusion needed — moments are a separate corpus.

### Pattern 5: Context Injection (MOM-04)
**What:** In `injectContext()`, after reading ACTIVE-tier axon nodes, check moments for concept_id overlap
**When to use:** SessionStart — already called by HKS-03

```typescript
// Extend flash/inject.ts — add a 3rd try/catch block after existing short-term block
// Overlap test: moment.concept_ids.some(id => activeConceptIds.has(id))
// Output: "--- Relevant moments ---" section with story text (first 200 chars)
```

**ACTIVE-tier concept IDs** are already collected in `injectContext()` from the axon graph. Pass them as a `Set<number>` for O(1) lookup.

### Pattern 6: CLI Capture (CLI-07)
**What:** `theorex moment <story>` handler that extracts concepts from story, finds related axon IDs, captures code refs, writes moment
**When to use:** New CLI subcommand

```typescript
export async function runMoment(
  story: string,
  axonPath: string,
  config: Config,
  momentsDir = MOMENTS_DIR,
): Promise<void> {
  const store = await AxonStore.load(axonPath);
  // Extract concept_ids from story using processText() + filter by axon membership
  // Capture code refs from git diff (best-effort; empty array on failure)
  const moment: MomentNode = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    story,
    code_refs: await captureCodeRefs(),
    concept_ids: extractConceptIds(story, store),
  };
  await createMoment(moment, momentsDir);
  console.log(`Moment saved: ${moment.id}`);
}
```

### Pattern 7: `theorex status` Moment Count (MOM-03)
**What:** `runStatus()` should show how many moment nodes exist so they are visible in status output
**When to use:** End of `runStatus()` output

```typescript
// Append to existing runStatus() after the concept table
const moments = await readMoments();
if (moments.length > 0) {
  console.log(`\nMoment Nodes — ${moments.length} permanent (never pruned)`);
  for (const m of moments.slice(0, 5)) {
    console.log(`  ${m.timestamp.slice(0, 10)}  ${m.story.slice(0, 60)}`);
  }
}
```

### Anti-Patterns to Avoid
- **Storing moments as Graphology nodes:** Graphology nodes are subject to pruneAxon; this would require adding guard code in prune, scan, and dissolution. Separate files are structurally immune.
- **Using JSONL for moments:** JSONL is append-only and rotation-based (14-day cutoff). Moment nodes must never be deleted by any time-based rotation logic. Individual JSON files sidestep this entirely.
- **Calling processText() with node_type="moment" and adding to axon:** This would put moment concepts into the decay cycle. The concept IDs are stored on the MomentNode as references only — the moment itself stays in `data/moments/`.
- **Mutating existing MomentNode files:** Moments are write-once. No update API. The `readonly` modifier on all fields enforces this in TypeScript.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BM25 text search | Custom keyword scorer | `wink-bm25-text-search` (already installed) | Same CJS interop pattern as `src/short-term/bm25.ts` |
| Atomic file write | Two-phase write from scratch | `Bun.write(tmp) + rename(tmp, final)` | Already established in AxonStore.save() and memory writer |
| UUID generation | Custom ID hash | `crypto.randomUUID()` | Already used in short-term store; browser-compatible API |
| Concept extraction from story | Ad-hoc word matching | `processText()` from `src/index.ts` | Significance pipeline already handles NLP extraction, aliasing, gating |
| Directory read | Custom file scanner | `readdir` from `node:fs/promises` | Already used in short-term rotation |

**Key insight:** Phase 5 is an assembly phase — all primitives exist. The work is defining the MomentNode shape, writing the store module, wiring BM25 search, extending inject, and adding the CLI subcommand.

## Common Pitfalls

### Pitfall 1: wink-bm25-text-search minimum 3 docs requirement
**What goes wrong:** wink throws if you call `consolidate()` with fewer than 3 documents indexed
**Why it happens:** BM25 IDF computation requires a minimum corpus size
**How to avoid:** Apply the same sentinel padding as `src/short-term/bm25.ts` — pad with `{ id: -1, surface_form: "", story: "" }` records when `moments.length < 3`
**Warning signs:** Test with 1 or 2 moments and observe the crash without the guard

### Pitfall 2: BM25 field schema for moments vs short-term entries
**What goes wrong:** `buildBm25Index` in short-term uses `surface_form` field; moments need `story` field
**Why it happens:** Different corpus schemas
**How to avoid:** Define a separate `buildMomentBm25Index` in `src/moments/search.ts` that uses `story` as the primary field (weight 3) and sets a different `uniqueId` mapping

### Pitfall 3: code_refs capture failure mode
**What goes wrong:** `git diff --name-only HEAD` fails in non-git directory or clean working tree
**Why it happens:** Shell command exits non-zero or returns empty output
**How to avoid:** Always return empty `code_refs: []` on any failure — `captureCodeRefs()` must be try/catch-wrapped; a moment with no code refs is still valid per MOM-02

### Pitfall 4: concept_ids becoming stale
**What goes wrong:** Concept IDs stored in a moment refer to nodes that are later pruned from the axon graph
**Why it happens:** Axon nodes are pruned; moment's `concept_ids` array is frozen at creation time
**How to avoid:** This is intentional by design — moments are snapshots. During context injection (MOM-04), simply skip concept IDs not currently in the active set; the overlap check already handles missing IDs gracefully via `Set.has()`.

### Pitfall 5: `theorex search` returning mixed results without type label
**What goes wrong:** User sees moment results intermixed with short-term results with no visual distinction
**Why it happens:** Both use the same `SearchResult` type
**How to avoid:** Prefix moment results with `[MOMENT]` in CLI output; keep the result types structurally distinct internally if needed for testing

### Pitfall 6: Bun 1.3.10 WASM SIGABRT crash in test teardown
**What goes wrong:** Running tests that import anything touching `@huggingface/transformers` (ONNX/WASM) crashes the test runner with SIGABRT after tests complete
**Why it happens:** Known Bun 1.3.10 bug (crash is in C++ cleanup, not in test logic)
**How to avoid:** Do not import `src/rag/embedder.ts` or any Phase 4 RAG module from Phase 5 test files. Moment search is BM25-only; no embedder import needed.

## Code Examples

Verified patterns from existing codebase:

### Atomic Write (from src/axon/store.ts)
```typescript
// Source: src/axon/store.ts AxonStore.save()
async save(path: string): Promise<void> {
  const tmp = path + ".tmp";
  await Bun.write(tmp, JSON.stringify(this._graph.export(), null, 2));
  await rename(tmp, path);
}
```

### Directory Read with ENOENT Guard (from src/short-term/store.ts)
```typescript
// Source: src/short-term/store.ts readShortTermFiles()
const files = await readdir(dir).catch(() => [] as string[]);
```

### wink-bm25 CJS Interop in Bun ESM (from src/short-term/bm25.ts)
```typescript
// Source: Phase 2 decision log — createRequire pattern for CJS modules
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const winkBm25 = require("wink-bm25-text-search");
```

### wink-bm25 Sentinel Padding (from src/short-term/bm25.ts)
```typescript
// Source: Phase 2 decision: wink requires minimum 3 docs for consolidation
while (entries.length < 3) {
  entries.push({ id: -entries.length, surface_form: "", composite_score: 0,
    concept_id: 0, source_weight: 0, timestamp: "", date: "" });
}
```

### UUID Generation (from src/short-term/store.ts)
```typescript
// Source: src/short-term/store.ts appendEntry()
const id = crypto.randomUUID();
```

### inject.ts try/catch block pattern (from src/flash/inject.ts)
```typescript
// Source: src/flash/inject.ts — independent try/catch for each lobe
try {
  // read data source
  // push to lines[]
} catch {
  // cold start or missing data — no output, never throw
}
```

### processText for concept extraction (from src/index.ts)
```typescript
// Source: src/index.ts — significance pipeline entry point
// node_type: "moment" already defined in src/types.ts NodeType union
import { processText } from "./src/index";
const events = processText({ text: story, sourceWeight: 1.0, nodeType: "moment", timestamp: new Date().toISOString() });
const conceptIds = events.map(e => e.concept_id);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Not applicable — Phase 5 is greenfield | — | — | — |

**Existing decisions that carry forward into Phase 5:**
- `node_type: "moment"` is already in `NodeType` union in `src/types.ts` — no type change needed
- Atomic write via temp+rename is the established invariant (LTM-04, AxonStore.save)
- `import.meta.main` guard for CLI handlers is the established pattern (Phase 1 decision)
- Handler function exports (`runMoment`) enables testability without spawning subprocess
- Config extension pattern: add `momentsDir: string` to Config with default `"data/moments"` — consistent with how `ragEmbeddingStorePath` was added in Phase 4

## Open Questions

1. **Code reference capture depth**
   - What we know: MOM-02 requires "code references (file:line)" — the CLI spec says "with current context"
   - What's unclear: Does "current context" mean (a) currently open files in the editor, (b) recently touched files from git diff, or (c) manually typed file:line pairs as CLI arguments?
   - Recommendation: Implement `--ref file:line` optional repeatable flag on `theorex moment`. Fall back to `git diff --name-only HEAD` for auto-detection. If neither available, `code_refs: []`. This satisfies MOM-02 without blocking on ambiguity.

2. **`theorex search` result merge presentation**
   - What we know: `theorex search` today returns `SearchResult[]` from `hybridSearch()` (short-term only)
   - What's unclear: Whether moment results should be interleaved by score, appended after short-term results, or shown in a separate section
   - Recommendation: Append after short-term results with a `--- Moment Nodes ---` separator. This is simpler to implement, visually distinct, and aligns with how `injectContext` uses separators (`--- Recent short-term ---`).

3. **Maximum moments displayed in status**
   - What we know: `theorex status` currently shows all concept nodes
   - What's unclear: No cap is specified for moment count in status
   - Recommendation: Show all moments (no cap) — they are permanent by design and expected to be few. If the list grows large, truncate at 20 with a "... and N more" tail.

## Validation Architecture

> `workflow.nyquist_validation` is not present in `.planning/config.json` — skip this section.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis — `src/axon/prune.ts`, `src/axon/scan.ts`, `src/axon/store.ts`, `src/flash/inject.ts`, `src/short-term/bm25.ts`, `src/short-term/store.ts`, `src/config.ts`, `src/types.ts`, `src/cli/index.ts`
- `.planning/STATE.md` decisions log — all architectural invariants documented in-project
- `.planning/REQUIREMENTS.md` — MOM-01 through MOM-04, CLI-07 verbatim requirements

### Secondary (MEDIUM confidence)
- `tests/cli/cli.test.ts` — established test pattern for handler-based CLI testing
- `tests/flash/inject.test.ts` — established pattern for injectContext dependency injection

### Tertiary (LOW confidence)
- None — all findings are based on direct codebase inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in package.json, no new deps
- Architecture: HIGH — all patterns verified from existing source files
- Pitfalls: HIGH — sourced from STATE.md decisions log and direct code inspection

**Research date:** 2026-03-11
**Valid until:** 2026-04-10 (stable; dependencies are locked)
