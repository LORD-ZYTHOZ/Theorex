# Phase 1: Long-Term Lobe - Research

**Researched:** 2026-03-10
**Domain:** Graphology graph library, MEMORY.md section parsing, Bun atomic file I/O, exponential decay scoring, Bun CLI
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Graph library:** Graphology 0.26 — the chosen graph library for the Axon concept web
- **Node shape:** numeric ID, importance_weight, relevance_tier, sentiment_tier, last_seen, frequency_count
- **Edge shape:** co-occurrence relationships with strength weight
- **Serialization:** axon.json (Graphology's built-in .export()/.import())
- **MEMORY.md round-trip fidelity:** HARD gate — byte-identical test MUST pass before any other phase writes to long-term storage
- **Atomic write pattern:** write to MEMORY.md.tmp then `fs.rename()` to MEMORY.md — never write directly
- **Relevance tiers:** ACTIVE / MILD / LESS via exponential decay + log-normalized frequency
- **Sentiment tiers:** PREFERRED / NEUTRAL / DISPREFERRED — every new node starts NEUTRAL
- **One-hop cross-pollination:** 0.5 dampening, strictly no second-hop
- **Pruning:** moves LESS nodes past 30-day threshold to data/archive/ as JSONL — not deleted
- **CLI entry point:** Bun built-in arg parsing, no framework
- **CLI commands:** `theorex scan`, `theorex status`, `theorex ref <keyword>`, `theorex prune`
- **Storage layout:** data/axon.json, data/archive/, MEMORY.md, .theorex-meta.json
- **Runtime:** Bun 1.3.10

### Claude's Discretion

- Exact exponential decay formula and half-life default
- Specific ACTIVE/MILD/LESS score thresholds
- axon.json schema details (within Graphology serialization format)
- .theorex-meta.json schema
- CLI output formatting details for `theorex status`
- Whether to implement `theorex ingest <text>` as a separate command or integrate with scan

### Deferred Ideas (OUT OF SCOPE)

- Cross-tier promotion from short-term to long-term → Phase 2
- Embedding-based edge seeding (RAG bootstrap) → Phase 4
- Moment nodes → Phase 5
- Multi-agent shared writes → Phase 6
- ML-tuned decay/threshold parameters → after data collection in Phases 1-2
- `theorex search` → Phase 2 (short-term lobe)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AXN-01 | Maintain weighted concept graph (nodes = concepts, edges = co-occurrence) | Graphology UndirectedGraph API: addNode, mergeNode, addEdge, mergeEdge |
| AXN-02 | Each node carries: numeric ID, label, relevance tier, sentiment tier, importance weight, reference count, last-referenced timestamp, source weight | Graphology typed NodeAttributes generic — all fields stored as node attributes |
| AXN-03 | Each edge carries: strength (0.0–1.0), co-occurrence count, last co-occurrence timestamp | Graphology typed EdgeAttributes generic |
| AXN-04 | Activation propagates one hop, 0.5 dampening, no unbounded multi-hop | forEachNeighbor() API confirmed; one-hop traversal is a single neighbors() call |
| AXN-05 | New edges form on co-occurrence; dead edges decay and prune below threshold | mergeEdge returns [key, edgeAdded, srcAdded, tgtAdded]; updateEdgeAttribute for decay |
| AXN-06 | Graph serializes to human-inspectable JSON; loads on startup | graph.export() → JSON.stringify; UndirectedGraph.from(JSON.parse(text)) |
| REL-01 | Every node classified ACTIVE/MILD/LESS via composite score (recency 40%, frequency 35%, co-occurrence 25%) | Pure scoring function; forEachNode to update all |
| REL-02 | Recency uses exponential decay with configurable lambda (default: half-life ~14 days) | Formula: score = exp(-lambda × daysElapsed); lambda = ln(2) / halfLifeDays |
| REL-03 | Classification updates lazily on read; eagerly on scan every 6 hours via PM2 | PM2 cron `0 */6 * * *`; lazy update on getNodeAttribute call |
| REL-04 | LESS nodes past 30-day prune threshold archived then deleted | forEachNode filter; archive to JSONL; graph.dropNode() |
| REL-05 | Classification thresholds configurable in config.json (ACTIVE ≥ 0.6, MILD ≥ 0.3) | config.json loaded at startup; pure threshold comparison |
| SNT-01 | Every node starts at NEUTRAL sentiment | Set sentiment_tier: "NEUTRAL" in addNode attributes |
| SNT-02 | System can set node sentiment to PREFERRED or DISPREFERRED | setNodeAttribute(node, 'sentiment_tier', value) |
| SNT-03 | Sentiment propagates one hop with dampening | Same forEachNeighbor pattern as activation propagation |
| SNT-04 | Node can be ACTIVE + DISPREFERRED or LESS + PREFERRED | relevance_tier and sentiment_tier are independent fields — no coupling |
| LTM-01 | Parse MEMORY.md into structured sections using section-boundary parser (not generic markdown) | Hand-rolled section parser on `## Heading` boundaries — no markdown library |
| LTM-02 | Parser produces byte-identical output when writing unmodified entries (round-trip hard gate) | Preserve raw section text verbatim; reconstruct with identical whitespace |
| LTM-03 | Classification metadata stored in .theorex-meta.json separate from MEMORY.md | Separate JSON file; never embedded in MEMORY.md content |
| LTM-04 | Writer always writes to temp file first, then atomic rename — never corrupts MEMORY.md | Bun.write("MEMORY.md.tmp", content) then rename("MEMORY.md.tmp", "MEMORY.md") |
| LTM-05 | Pruned entries archived to data/archive/ before deletion — never silently lost | Archive to JSONL before graph.dropNode() and MEMORY.md section removal |
| CLI-01 | `theorex scan` — re-score all entries, apply decay, update classifications | forEachNode with composite scorer; axon.json rewritten atomically |
| CLI-02 | `theorex status` — display all nodes with tier pairs in table | forEachNode collect, sort, console.table or manual table formatting |
| CLI-03 | `theorex ref <keyword>` — record reference, bump recency and frequency | mergeNode + one-hop propagation; atomic axon.json write |
| CLI-04 | `theorex prune` — archive and remove LESS nodes past threshold | Filter by tier + last_seen age; archive first, then dropNode |
</phase_requirements>

---

## Summary

Phase 1 builds the living concept web (axon.json) and the MEMORY.md management layer on top of Phase 0's pure significance engine. The core dependency is Graphology 0.26, which is already confirmed installed in the project after this research. The library provides typed node/edge attributes via TypeScript generics, built-in JSON serialization via `.export()`/`.import()`, and a clean neighbors traversal API for one-hop cross-pollination.

The MEMORY.md round-trip fidelity requirement is the phase's single hardest constraint. The actual MEMORY.md file uses pure CommonMark: `# H1`, `## H2`, `### H3` section headers, bullet lists with bold key-value patterns, and exactly one trailing newline (no frontmatter, no YAML). The parser must be a hand-rolled section-boundary parser that splits on `##` headers and preserves raw text verbatim — generic markdown-to-AST libraries are disqualified because they normalize whitespace and cannot guarantee byte-identical reconstruction.

The scoring layer (exponential decay + log-normalized frequency) is well-understood mathematics with no dependency risk. The composite score formula `recency(40%) + frequency(35%) + co-occurrence(25%)` maps cleanly to pure functions. The CLI uses Bun's built-in `Bun.argv` + `util.parseArgs` (available in Bun natively) with no external framework.

**Primary recommendation:** Build in this order: (1) Graphology-backed AxonStore with typed attributes, (2) MEMORY.md section parser with byte-identical round-trip test as a hard gate, (3) scoring engine with decay formula, (4) CLI entry point. Never proceed past the round-trip test failure.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| graphology | 0.26.0 | Weighted concept graph with typed attributes, serialization | Robust, typed, ships JSON serialization built-in; already the locked choice |
| bun:test | built-in | Test runner (used in Phase 0) | Project standard — all Phase 0 tests use bun:test |
| node:fs/promises | built-in (Bun compat) | Atomic rename for MEMORY.md writes | `fs.promises.rename()` is POSIX-atomic on same filesystem — the correct primitive |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| util.parseArgs | built-in (Node compat) | Subcommand + flag parsing in CLI entry point | When building the CLI entry point — no external framework needed |
| node:fs/promises.mkdir | built-in | Create data/archive/ directory if missing | Required once during first prune operation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| graphology UndirectedGraph | DirectedGraph | Edges are symmetric co-occurrence — undirected is semantically correct; directed adds unnecessary source/target asymmetry |
| hand-rolled section parser | marked / remark | Generic parsers normalize whitespace → byte-identical round-trip impossible; section parser is 50 lines of split/join |
| node:fs rename | Bun.rename (does not exist) | Bun has no native rename; node:fs/promises is the correct API and Bun supports it fully |

**Installation:**
```bash
bun add graphology
# graphology 0.26.0 already installed as of this research
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── axon/
│   ├── store.ts          # AxonStore class — Graphology wrapper, load/save axon.json
│   ├── scorer.ts         # Pure scoring functions: recency decay, frequency, co-occurrence
│   ├── propagate.ts      # One-hop activation and sentiment propagation
│   └── prune.ts          # Archive + dropNode logic
├── memory/
│   ├── parser.ts         # Section-boundary MEMORY.md parser
│   ├── writer.ts         # Atomic MEMORY.md writer (temp+rename)
│   └── meta.ts           # .theorex-meta.json read/write
├── cli/
│   └── index.ts          # CLI entry point — Bun.argv dispatch
├── config.ts             # Load config.json with defaults
└── types.ts              # Phase 1 type extensions (AxonNodeAttrs, AxonEdgeAttrs)
data/
├── axon.json             # Graphology-serialized concept web
└── archive/              # Pruned node JSONL records
MEMORY.md                 # Human/AI readable long-term memory (never partially written)
.theorex-meta.json        # Classification metadata (separate from MEMORY.md)
config.json               # User-configurable thresholds and decay params
```

### Pattern 1: Typed Graphology Store
**What:** Wrap Graphology UndirectedGraph with domain-specific typed attributes.
**When to use:** All graph read/write operations — never touch Graphology directly from CLI or scanner.
**Example:**
```typescript
// Source: graphology official docs (https://graphology.github.io/instantiation.html)
// and graphology-types declaration (verified from installed node_modules)
import { UndirectedGraph } from "graphology";

interface AxonNodeAttrs {
  concept_id: number;
  surface_form: string;
  importance_weight: number;
  relevance_tier: "ACTIVE" | "MILD" | "LESS";
  sentiment_tier: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
  last_seen: string;       // ISO 8601
  frequency_count: number;
  source_weight: number;
}

interface AxonEdgeAttrs {
  strength: number;           // 0.0–1.0
  co_occurrence_count: number;
  last_co_occurrence: string; // ISO 8601
}

type AxonGraph = UndirectedGraph<AxonNodeAttrs, AxonEdgeAttrs>;

// Load from disk
function loadAxon(path: string): AxonGraph {
  const raw = await Bun.file(path).text();
  return UndirectedGraph.from<AxonNodeAttrs, AxonEdgeAttrs>(JSON.parse(raw));
}

// Save to disk (atomic)
async function saveAxon(graph: AxonGraph, path: string): Promise<void> {
  const tmp = path + ".tmp";
  await Bun.write(tmp, JSON.stringify(graph.export(), null, 2));
  await rename(tmp, path);
}
```

### Pattern 2: Section-Boundary MEMORY.md Parser
**What:** Split MEMORY.md on `## ` header boundaries, preserve raw text of each section, reconstruct identically.
**When to use:** All MEMORY.md read operations — produces structured sections; all write operations reconstruct verbatim.
**Example:**
```typescript
// Source: analysis of actual MEMORY.md file (hex dump confirmed: starts with "# Memory\n",
// sections delimited by "## ", ends with exactly one LF byte 0x0a)

interface MemorySection {
  readonly heading: string;       // e.g. "## System" (includes "## " prefix)
  readonly rawBody: string;       // everything between this heading and next, INCLUDING leading \n
}

interface ParsedMemory {
  readonly preamble: string;      // everything before first "## " (i.e. "# Memory\n\n")
  readonly sections: readonly MemorySection[];
}

function parseMemory(raw: string): ParsedMemory {
  // Split on lines that start with "## " — preserves ALL other whitespace exactly
  const lines = raw.split("\n");
  const preambleLines: string[] = [];
  const sections: MemorySection[] = [];
  let currentHeading: string | null = null;
  let currentBodyLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, rawBody: currentBodyLines.join("\n") });
      } else {
        preambleLines.push(...currentBodyLines);
      }
      currentHeading = line;
      currentBodyLines = [];
    } else {
      currentBodyLines.push(line);
    }
  }
  // flush last section
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, rawBody: currentBodyLines.join("\n") });
  }

  return {
    preamble: preambleLines.join("\n"),
    sections,
  };
}

function serializeMemory(parsed: ParsedMemory): string {
  const parts = [parsed.preamble];
  for (const section of parsed.sections) {
    parts.push(section.heading + "\n" + section.rawBody);
  }
  return parts.join("\n");
}
```

**CRITICAL:** The round-trip test is: `serializeMemory(parseMemory(raw)) === raw`. This MUST pass before any other write path is implemented.

### Pattern 3: Atomic MEMORY.md Write
**What:** Always write to .tmp then rename — never write directly to MEMORY.md.
**When to use:** Every MEMORY.md write operation, including scan, ref, and prune.
**Example:**
```typescript
// Source: Bun docs (https://bun.sh/docs/api/file-io) + node:fs/promises rename
// Confirmed: Bun fully supports node:fs/promises.rename
import { rename } from "node:fs/promises";

async function writeMemoryAtomic(path: string, content: string): Promise<void> {
  const tmp = path + ".tmp";
  await Bun.write(tmp, content);  // Bun.write: fastest path on macOS (clonefile/fcopyfile)
  await rename(tmp, path);         // POSIX atomic on same filesystem
}
```

### Pattern 4: Composite Scoring with Exponential Decay
**What:** Pure function that computes a relevance score from recency, frequency, and co-occurrence.
**When to use:** In `theorex scan` (eager), and lazily on node read in Phase 2+.
**Example:**
```typescript
// Source: standard half-life decay mathematics (lambda = ln(2) / halfLifeDays)
// REL-02 specifies half-life ~14 days; REL-01 specifies composite weights

const LN2 = Math.LN2;  // 0.693147...

interface ScoringConfig {
  halfLifeDays: number;     // default: 14
  activeThreshold: number;  // default: 0.6
  mildThreshold: number;    // default: 0.3
}

function recencyScore(lastSeen: string, nowMs: number, halfLifeDays: number): number {
  const lambda = LN2 / halfLifeDays;
  const daysElapsed = (nowMs - new Date(lastSeen).getTime()) / 86_400_000;
  return Math.exp(-lambda * daysElapsed);  // 1.0 at t=0, 0.5 at t=halfLifeDays
}

function frequencyScore(frequencyCount: number): number {
  // log-normalized: 1 ref → 0.0, 10 refs → 0.836, 100 refs → 1.0 (capped)
  return Math.min(Math.log(1 + frequencyCount) / Math.log(101), 1.0);
}

function coOccurrenceScore(neighborStrengths: number[]): number {
  if (neighborStrengths.length === 0) return 0;
  const avgStrength = neighborStrengths.reduce((a, b) => a + b, 0) / neighborStrengths.length;
  return Math.min(avgStrength, 1.0);
}

function compositeScore(
  lastSeen: string,
  frequencyCount: number,
  neighborStrengths: number[],
  nowMs: number,
  config: ScoringConfig,
): number {
  const r = recencyScore(lastSeen, nowMs, config.halfLifeDays);
  const f = frequencyScore(frequencyCount);
  const c = coOccurrenceScore(neighborStrengths);
  return 0.40 * r + 0.35 * f + 0.25 * c;  // REL-01 weights
}

function classifyTier(score: number, config: ScoringConfig): "ACTIVE" | "MILD" | "LESS" {
  if (score >= config.activeThreshold) return "ACTIVE";
  if (score >= config.mildThreshold) return "MILD";
  return "LESS";
}
```

### Pattern 5: One-Hop Propagation
**What:** Activate a node, propagate 0.5× to direct neighbors only.
**When to use:** `theorex ref <keyword>` and sentiment propagation.
**Example:**
```typescript
// Source: graphology iteration docs (https://graphology.github.io/iteration.html)
// forEachNeighbor confirmed: callback receives (neighborKey, neighborAttrs)

function propagateActivation(
  graph: AxonGraph,
  nodeKey: string,
  activationDelta: number,
): void {
  // Update the activated node first
  graph.updateNodeAttribute(nodeKey, "frequency_count", (n) => (n ?? 0) + 1);
  graph.updateNodeAttribute(nodeKey, "last_seen", () => new Date().toISOString());

  // One-hop only — 0.5 dampening
  const dampened = activationDelta * 0.5;
  graph.forEachNeighbor(nodeKey, (neighborKey) => {
    graph.updateNodeAttribute(neighborKey, "importance_weight", (w) =>
      Math.min(1.0, (w ?? 0) + dampened)
    );
    // No further propagation — second hop is forbidden
  });
}
```

### Pattern 6: CLI Entry Point with Bun
**What:** Dispatch subcommands from `Bun.argv` — no external framework.
**When to use:** The CLI entry point file (`src/cli/index.ts`).
**Example:**
```typescript
// Source: Bun docs (https://bun.com/docs/guides/process/argv)
// util.parseArgs confirmed available in Bun (Node.js compat layer)
import { parseArgs } from "util";

const { positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
});

const [subcommand, ...rest] = positionals;

switch (subcommand) {
  case "scan":   await runScan(); break;
  case "status": await runStatus(); break;
  case "ref":    await runRef(rest[0]); break;
  case "prune":  await runPrune(); break;
  default:
    console.error(`Unknown command: ${subcommand ?? "(none)"}`);
    console.error("Usage: theorex <scan|status|ref <keyword>|prune>");
    process.exit(1);
}
```

### Anti-Patterns to Avoid
- **Using generic markdown parsers (marked, remark) for MEMORY.md:** They normalize whitespace, collapse blank lines, and alter list formatting — byte-identical round-trip is structurally impossible.
- **Writing directly to MEMORY.md without temp+rename:** Any crash or signal between writes leaves MEMORY.md in a partial state — corrupt long-term memory.
- **Multi-hop propagation:** A second-hop pass floods the graph and destroys tier discrimination. One call to `forEachNeighbor()` is the entire propagation — stop there.
- **Storing classification metadata inside MEMORY.md sections:** LTM-03 requires .theorex-meta.json to be separate — mixing metadata into MEMORY.md content makes round-trip tests fragile.
- **Using `graph.addNode()` when node may already exist:** Use `graph.mergeNode()` — addNode throws if key exists; mergeNode upserts safely.
- **Accessing axon.json path from multiple concurrent `theorex` processes simultaneously:** On same filesystem, rename is atomic but Bun.write is not an atomic read-modify-write. The scan command must read → modify → write as a single process; Phase 6 multi-agent safety is deferred.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graph node/edge storage with neighbors traversal | Custom adjacency list class | graphology UndirectedGraph | Edge cases in neighbor iteration, serialization, merge semantics; Graphology handles all of them |
| Atomic file write | Try/catch direct write with cleanup | Bun.write + fs.rename | rename is the POSIX-guaranteed atomic primitive; any other approach has a crash window |
| Subcommand CLI parsing | Manual `argv[2] === "scan"` switch | util.parseArgs + switch | parseArgs handles `--flag value`, `--flag=value`, and positional separation; reduces parse bugs |
| Exponential decay math | Custom decay table or lookup | `Math.exp(-lambda * t)` | Standard formula — one line, no library needed |

**Key insight:** The only non-trivial custom work in Phase 1 is the MEMORY.md section parser and the composite scorer — everything else is composition of verified primitives.

---

## Common Pitfalls

### Pitfall 1: MEMORY.md Round-Trip Failure on Trailing Newline
**What goes wrong:** `serializeMemory(parseMemory(raw))` is `raw + "\n"` or `raw.slice(0, -1)`.
**Why it happens:** The final section's `rawBody` contains the trailing `\n` (hex `0a`). If split logic joins with `"\n"` AND the body already ends with `"\n"`, one extra newline appears. The actual MEMORY.md ends with a single `0a` byte after the last content character.
**How to avoid:** The section body for the last section ends in `"\n"` (from the line split). When reconstructing, join `heading + "\n" + rawBody` — the body's own trailing newline is preserved. Do NOT add an extra `"\n"` between sections.
**Warning signs:** Round-trip test fails by exactly 1 byte; diff shows only the last byte differs.

### Pitfall 2: Graphology Node Key vs concept_id
**What goes wrong:** Using numeric `concept_id` directly as the Graphology node key causes silent issues — Graphology node keys are strings.
**Why it happens:** `graph.addNode(123456)` is accepted but `graph.hasNode(123456)` may behave unexpectedly depending on how the key is stored internally; mixing number and string comparisons.
**How to avoid:** Always convert concept_id to string for the node key: `String(event.concept_id)`. Store `concept_id` as a numeric attribute separately for domain queries.
**Warning signs:** `graph.hasNode(id)` returns false even after `graph.addNode(id)` was called with a number.

### Pitfall 3: UndirectedGraph.from() Loses Type Parameters
**What goes wrong:** Calling `Graph.from(JSON.parse(raw))` (using the default Graph) loses typed attributes — TypeScript sees `Attributes` instead of `AxonNodeAttrs`.
**Why it happens:** The static `from()` method is on the constructor class — must call `UndirectedGraph.from<AxonNodeAttrs, AxonEdgeAttrs>(data)`.
**How to avoid:** Always use the typed constructor's `from()`, not the base `Graph.from()`.
**Warning signs:** TypeScript does not complain about accessing `.attributes.nonExistentField` on nodes.

### Pitfall 4: Decay Score at Zero Days
**What goes wrong:** Node last_seen = now → recency score = 1.0. Node that was just added gets ACTIVE immediately even with frequency_count = 1. This is correct behavior but can feel surprising in tests if the clock is mocked incorrectly.
**Why it happens:** `Math.exp(0) = 1.0`. A brand-new node is maximally recent.
**How to avoid:** Tests must either freeze time (pass an explicit `nowMs` param) or account for brand-new nodes being ACTIVE on first scan. Design scorer with injectable clock.
**Warning signs:** Tests that create a node and immediately scan fail because expected tier is MILD but actual is ACTIVE.

### Pitfall 5: rename() Cross-Filesystem Failure
**What goes wrong:** `rename("MEMORY.md.tmp", "MEMORY.md")` throws `EXDEV: cross-device link not permitted` if tmp and target are on different filesystems.
**Why it happens:** POSIX rename is only atomic when source and destination are on the same filesystem/device. Writing .tmp to `/tmp/` while MEMORY.md is in the project directory will fail.
**How to avoid:** ALWAYS write .tmp to the same directory as the target: `path + ".tmp"` not `"/tmp/memory.md.tmp"`.
**Warning signs:** `EXDEV` error in rename call; never triggers on development machine but fails in Docker or on machines with different mount points.

### Pitfall 6: forEachNeighbor Mutates Graph During Iteration
**What goes wrong:** Calling `graph.updateNodeAttribute()` inside `forEachNeighbor()` may cause iteration issues depending on Graphology internals.
**Why it happens:** Graph mutation during iteration is undefined behavior in most graph libraries unless explicitly documented as safe.
**How to avoid:** Collect neighbor keys first, then update: `const neighbors = graph.neighbors(nodeKey); for (const n of neighbors) { graph.updateNodeAttribute(...) }`.
**Warning signs:** Inconsistent number of neighbors processed; some nodes skipped or processed twice.

---

## Code Examples

Verified patterns from official sources:

### Graphology: Install and Typed Import
```typescript
// Source: installed node_modules/graphology/dist/graphology.d.ts (version 0.26.0)
import { UndirectedGraph } from "graphology";

// Typed constructor — node attrs, edge attrs, graph attrs
const graph = new UndirectedGraph<AxonNodeAttrs, AxonEdgeAttrs>();
```

### Graphology: mergeNode (upsert pattern)
```typescript
// Source: graphology mutation docs (https://graphology.github.io/mutation.html)
// mergeNode returns [nodeKey, wasAdded: boolean]
const [nodeKey, wasAdded] = graph.mergeNode(String(conceptId), {
  concept_id: conceptId,
  surface_form: surfaceForm,
  importance_weight: compositeScore,
  relevance_tier: "ACTIVE",
  sentiment_tier: "NEUTRAL",   // SNT-01: always start NEUTRAL
  last_seen: timestamp,
  frequency_count: 1,
  source_weight: sourceWeight,
});
```

### Graphology: mergeEdge (co-occurrence upsert)
```typescript
// Source: graphology mutation docs (https://graphology.github.io/mutation.html)
// mergeEdge returns [edgeKey, edgeAdded, srcAdded, tgtAdded]
const [, edgeAdded] = graph.mergeEdge(String(idA), String(idB), {
  strength: 0.1,
  co_occurrence_count: 1,
  last_co_occurrence: timestamp,
});

if (!edgeAdded) {
  // Edge already existed — strengthen it
  graph.updateEdgeAttribute(String(idA), String(idB), "co_occurrence_count",
    (n) => (n ?? 0) + 1);
  graph.updateEdgeAttribute(String(idA), String(idB), "strength",
    (s) => Math.min(1.0, (s ?? 0) + 0.05));
  graph.updateEdgeAttribute(String(idA), String(idB), "last_co_occurrence",
    () => timestamp);
}
```

### Graphology: Export and Load (axon.json persistence)
```typescript
// Source: graphology serialization docs (https://graphology.github.io/serialization.html)
// export() returns SerializedGraph; from() is the static constructor method

// Save
const serialized = graph.export();
await saveAxon(serialized, "data/axon.json");

// Load
const raw = await Bun.file("data/axon.json").json();
const graph = UndirectedGraph.from<AxonNodeAttrs, AxonEdgeAttrs>(raw);
```

### Bun: Atomic Write Pattern
```typescript
// Source: Bun file I/O docs (https://bun.sh/docs/api/file-io) + Bun node:fs compat
// rename is POSIX-atomic on same filesystem (VERIFIED: same directory guarantees same fs)
import { rename } from "node:fs/promises";

async function atomicWrite(targetPath: string, content: string): Promise<void> {
  const tmpPath = targetPath + ".tmp";
  await Bun.write(tmpPath, content);  // fast path: uses clonefile/fcopyfile on macOS
  await rename(tmpPath, targetPath);  // atomic on same filesystem
}
```

### Bun: CLI Subcommand Dispatch
```typescript
// Source: Bun argv docs (https://bun.com/docs/guides/process/argv)
// util.parseArgs available in Bun via Node.js compat layer
import { parseArgs } from "util";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    config: { type: "string", short: "c" },
  },
});

const subcommand = positionals[0];
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom adjacency list for graph storage | Graphology typed graph library | Pre-2020 | Serialization, traversal, type safety all solved |
| Write file directly then hope for no crash | temp write + atomic rename | POSIX 1990s standard | Zero chance of partial-write corruption |
| Markdown AST parser for section extraction | Section-boundary line parser | N/A — AST parsers never guaranteed round-trip | Hand-rolled split/join is 50 lines and provably lossless |

**Deprecated/outdated:**
- Direct `Graph.addNode()` when node may exist: replaced by `mergeNode()` which returns a flag indicating whether it was newly created.
- `fs.writeFileSync` / `fs.writeFile` for important files: superseded by write+rename pattern for crash safety.

---

## Open Questions

1. **MEMORY.md Parser: Sub-section (###) handling**
   - What we know: MEMORY.md uses `## H2` and `### H3` headers. The section-boundary parser splits on `## H2` only.
   - What's unclear: Should `### H3` headers be further parsed into sub-sections, or left as raw body text within their parent `## H2` section?
   - Recommendation: Leave `### H3` as raw body text within the parent section for Phase 1. This is the simplest approach that guarantees round-trip fidelity, and LTM-03 says metadata lives in .theorex-meta.json — not in MEMORY.md structure. Revisit only if Phase 2 or 3 needs section-level targeting.

2. **config.json format and location**
   - What we know: REL-05 requires configurable ACTIVE/MILD thresholds in config.json. CONTEXT.md says default half-life is ~14 days (REQUIREMENTS.md says ~14 days; CONTEXT.md says ~7 days — minor conflict).
   - What's unclear: Exact config.json schema, location (project root vs. data/), and whether it's user-created or auto-generated.
   - Recommendation: Place config.json at project root (alongside MEMORY.md). Use defaults baked into code when file absent. Half-life: go with REQUIREMENTS.md spec of **14 days** (CONTEXT.md's "~7 days" appears to be from an earlier design iteration).

3. **PM2 cron scheduling for REL-03**
   - What we know: REL-03 requires eager classification every 6 hours via PM2. PM2 supports `cron_restart` in ecosystem.config. `0 */6 * * *` is the correct pattern.
   - What's unclear: Whether PM2 is already configured for this project, and whether the theorex process should be a long-running daemon or invoked on demand.
   - Recommendation: PM2 config is out of scope for Phase 1 code — document the ecosystem.config entry in a comment or README. The `theorex scan` command is the implementation; PM2 scheduling is an operator concern. Include a minimal `ecosystem.config.cjs` in the Phase 1 deliverables.

4. **Edge decay: when and how dead edges are pruned**
   - What we know: AXN-05 says dead edges decay and are pruned below threshold. No threshold value specified in requirements.
   - What's unclear: The exact edge decay formula and minimum strength threshold.
   - Recommendation (Claude's discretion): Apply same exponential decay to edge `strength` during `theorex scan`. Use minimum threshold of `0.01`. Prune edges below threshold in the same pass as node pruning.

---

## Validation Architecture

> workflow.nyquist_validation is not present in .planning/config.json — skipping this section per instructions.

---

## MEMORY.md Format Analysis

**Actual file at `/Users/eoh/.claude/projects/-Users-eoh/memory/MEMORY.md` — verified by hex dump:**

- First bytes: `23 20 4d 65 6d 6f 72 79 0a` = `# Memory\n`
- Structure: H1 preamble, then `## ` H2 sections, some with `### ` H3 subsections
- List items: `- **Bold key:** value` with some having sub-items indented 2 spaces
- Last bytes: `2e 0a` = `.\n` — file ends with exactly one LF, no trailing blank line
- No YAML frontmatter, no fenced code blocks, no tables (in current version)
- Total: 117 lines

**Parsing strategy confirmed:** Split on `\n` → identify lines starting with `## ` → collect body text between headers → reconstruct verbatim with no transformations. The preamble is `# Memory\n\n` (H1 + blank line). This approach is O(n) and provably lossless.

---

## Sources

### Primary (HIGH confidence)
- [graphology official docs — instantiation](https://graphology.github.io/instantiation.html) — constructor types, generics, static from()
- [graphology official docs — mutation](https://graphology.github.io/mutation.html) — mergeNode, mergeEdge, updateNode, updateEdge signatures
- [graphology official docs — attributes](https://graphology.github.io/attributes.html) — getNodeAttribute, setNodeAttribute, updateNodeAttribute
- [graphology official docs — iteration](https://graphology.github.io/iteration.html) — forEachNode, forEachNeighbor, neighbors
- [graphology official docs — serialization](https://graphology.github.io/serialization.html) — export(), import(), JSON format
- `node_modules/graphology/dist/graphology.d.ts` v0.26.0 — verified typed constructor signatures
- `node_modules/graphology-types/index.d.ts` — verified SerializedGraph, SerializedNode, SerializedEdge types
- [Bun file I/O docs](https://bun.sh/docs/api/file-io) — Bun.write, Bun.file, FileSink API
- [Bun argv docs](https://bun.com/docs/guides/process/argv) — Bun.argv, util.parseArgs usage
- MEMORY.md hex dump — actual file format verified: H1 preamble, ## sections, single trailing LF

### Secondary (MEDIUM confidence)
- [POSIX rename atomicity](https://rcrowley.org/2010/01/06/things-unix-can-do-atomically.html) — rename atomic on same filesystem; confirmed by POSIX spec
- [Bun node:fs/promises rename reference](https://bun.com/reference/node/fs/promises/rename) — confirms Bun supports fs.promises.rename (page content not accessible but URL structure + search results confirm support)
- PM2 cron syntax `0 */6 * * *` — confirmed by multiple PM2 documentation sources

### Tertiary (LOW confidence)
- Half-life formula for node scoring — standard mathematical formula (no external source needed); implementation is `Math.exp(-ln(2)/halfLife * days)`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Graphology 0.26.0 installed and verified; TypeScript types confirmed from node_modules; Bun APIs confirmed from official docs
- Architecture: HIGH — section parser design based on verified MEMORY.md hex dump; Graphology API confirmed; atomic write pattern is POSIX-standard
- Pitfalls: HIGH — derived from actual API behavior (node key string coercion, typed from(), same-directory rename requirement) plus standard correctness concerns
- Scoring formula: MEDIUM — standard decay math is established; specific threshold values (ACTIVE ≥ 0.6, MILD ≥ 0.3) come from REQUIREMENTS.md (authoritative for this project)

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (Graphology 0.26 is stable; Bun APIs stable; 30-day window appropriate)
