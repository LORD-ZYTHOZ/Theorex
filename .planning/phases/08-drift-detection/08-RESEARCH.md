# Phase 8: Drift Detection — Research

**Researched:** 2026-03-11
**Domain:** Append-only audit log, deterministic drift scoring, JSONL I/O, CLI extension
**Confidence:** HIGH

## Summary

Phase 8 closes the behavioral-consistency loop: every mutation that touches a concept node's tier or sentiment is appended to an audit log, and a drift score is computed by comparing the concept IDs recorded in permanent moment nodes against the currently ACTIVE tier set. The system is entirely deterministic — no LLM calls, no new dependencies, no new storage formats beyond what already exists in the project.

The key insight is that moment nodes are the "ground truth" of the agent's identity: they captured what was important at specific points in time. If the live ACTIVE set has diverged from what those moments recorded, the agent has drifted. Tier instability (ACTIVE → MILD/LESS within a rolling window) and sentiment flips (PREFERRED ↔ DISPREFERRED) are separate signals that amplify the drift reading.

The implementation follows three well-bounded layers: an append-only event logger called from existing mutation sites (scanAxon, pruneAxon, propagateSentiment, graduateToLongTerm, createMoment), a pure scoring engine that consumes axon.json + events.jsonl + data/moments/, and two new CLI commands (`theorex drift`, `theorex audit`) plus an extension to `theorex status`.

**Primary recommendation:** Build three modules — `src/audit/logger.ts` (append-only JSONL writer), `src/audit/scorer.ts` (pure drift math), `src/audit/reader.ts` (filtered log reader) — and wire them into existing call sites minimally.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRF-01 | Maintain JSONL audit event log at `data/events.jsonl` — every concept tier change, sentiment flip, graduation, prune, and moment capture appended with timestamp and source | Append-only JSONL writer; `appendFile` from `node:fs/promises` is the correct Bun idiom for JSONL appends (established in Phase 2 STM) |
| DRF-02 | Drift score (0.0–1.0) computed by comparing moment node concept_ids against current ACTIVE-tier set | Jaccard-style intersection over union: |moment_concept_ids ∩ active_ids| / |moment_concept_ids ∪ active_ids|; purely arithmetic on existing data structures |
| DRF-03 | Tier instability detection — ACTIVE → MILD/LESS within rolling window raises drift signal | Scan events.jsonl for tier_change events within `driftWindowDays` (default 7) where `from === "ACTIVE"` and `to !== "ACTIVE"` |
| DRF-04 | Sentiment flip detection — PREFERRED ↔ DISPREFERRED within rolling window flagged per concept | Scan events.jsonl for sentiment_flip events within window; any concept with both PREFERRED and DISPREFERRED in window is flagged |
| DRF-05 | Drift evaluation is purely deterministic — no LLM calls, no external APIs | All inputs are already on disk: axon.json, events.jsonl, data/moments/*.json |
| DRF-06 | `theorex drift` CLI command — displays drift score, flagged concepts, stability trend | New subcommand in src/cli/index.ts following existing handler export pattern |
| DRF-07 | `theorex status` extended to include drift summary line (score + alert flag) | Append to runStatus() output after the moments block; wrapped in try/catch — non-fatal |
| DRF-08 | `theorex audit` CLI command — recent event log entries, filterable by type and time window | New subcommand; reads events.jsonl with optional --type and --since filters |
| CLI-08 | `theorex drift` — show drift score (0.0–1.0), flagged concepts, trend direction | Same as DRF-06 |
| CLI-09 | `theorex audit [--type <type>] [--since <date>]` — inspect event log | parseArgs strict:false already used for --ref in moment subcommand — same pattern works here |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun built-ins | 1.3.10 | `Bun.file()`, `Bun.write()`, `appendFile` | Already the project standard; `appendFile` from `node:fs/promises` confirmed safe for JSONL in Phase 2 |
| `node:fs/promises` | built-in | `appendFile` for audit log appends, `mkdir` for dir creation | `appendFile` is the only correct idiom for non-destructive JSONL append in Bun (Bun.write silently replaces) |
| `util.parseArgs` | built-in | `--type` and `--since` flag parsing in audit subcommand | Already used in existing CLI dispatch |
| Graphology | 0.26.0 | Reading ACTIVE node set from loaded AxonStore | Already in project; no new dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` | built-in | Not needed — no new UUID generation | - |
| `node:fs/promises` `readFile` | built-in | Streaming/chunked reads for large events.jsonl | Use when events.jsonl exceeds expected size; at Phase 8 scale, full-read is fine |

**No new `npm install` needed.** All required capabilities are already present.

## Architecture Patterns

### Recommended Module Structure
```
src/
├── audit/
│   ├── logger.ts        # appendAuditEvent() — pure I/O, one public function
│   ├── scorer.ts        # computeDriftScore(), detectInstability(), detectSentimentFlips() — pure math
│   └── reader.ts        # readAuditEvents(), filterEvents() — JSONL reader with optional filters
tests/
├── audit/
│   ├── logger.test.ts
│   ├── scorer.test.ts
│   └── reader.test.ts
```

### Pattern 1: AuditEvent Type Union (Discriminated Union)
**What:** A discriminated union with a `type` field enables exhaustive type checking and clean filtering.
**When to use:** Always — every event kind has its own payload shape.

```typescript
// src/audit/logger.ts

export type AuditEventType =
  | "tier_change"
  | "sentiment_flip"
  | "graduation"
  | "prune"
  | "moment_capture";

interface BaseAuditEvent {
  readonly timestamp: string;   // ISO 8601
  readonly source: string;      // "scan" | "prune" | "ref" | "graduate" | "moment" | "cli"
}

interface TierChangeEvent extends BaseAuditEvent {
  readonly type: "tier_change";
  readonly concept_id: number;
  readonly surface_form: string;
  readonly from: "ACTIVE" | "MILD" | "LESS";
  readonly to: "ACTIVE" | "MILD" | "LESS";
}

interface SentimentFlipEvent extends BaseAuditEvent {
  readonly type: "sentiment_flip";
  readonly concept_id: number;
  readonly surface_form: string;
  readonly from: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
  readonly to: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
}

interface GraduationEvent extends BaseAuditEvent {
  readonly type: "graduation";
  readonly surface_form: string;
  readonly concept_id: number;
}

interface PruneEvent extends BaseAuditEvent {
  readonly type: "prune";
  readonly concept_id: number;
  readonly surface_form: string;
}

interface MomentCaptureEvent extends BaseAuditEvent {
  readonly type: "moment_capture";
  readonly moment_id: string;
  readonly story_preview: string;    // first 60 chars of story
  readonly concept_ids: readonly number[];
}

export type AuditEvent =
  | TierChangeEvent
  | SentimentFlipEvent
  | GraduationEvent
  | PruneEvent
  | MomentCaptureEvent;
```

### Pattern 2: Append-Only JSONL Writer
**What:** `appendFile` from `node:fs/promises` is the only safe idiom for JSONL appends in Bun.
**When to use:** Every audit event — NEVER use `Bun.write()` (silently replaces file content).

```typescript
// src/audit/logger.ts
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const EVENTS_PATH = "data/events.jsonl";

export async function appendAuditEvent(
  event: AuditEvent,
  path: string = EVENTS_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(event) + "\n");
}
```

**Confirmed from Phase 2 STATE.md decision:** `appendFile from node:fs/promises is mandatory for JSONL appends — Bun.write silently replaces file content`.

### Pattern 3: Drift Score — Jaccard Overlap
**What:** Score = |moment_concept_ids ∩ active_ids| / |moment_concept_ids ∪ active_ids|.
**When to use:** For DRF-02 drift score computation.

```typescript
// src/audit/scorer.ts — pure function, no I/O

/**
 * Compute drift score: 1.0 = full overlap (stable), 0.0 = complete divergence.
 * Based on Jaccard similarity of moment concept anchors vs live ACTIVE set.
 *
 * Moment concept_ids are the union across ALL moment nodes — each moment anchors
 * a set of concepts. The active set is the current ACTIVE-tier node IDs.
 *
 * Edge cases:
 * - No moments → return 1.0 (no anchor baseline = no evidence of drift)
 * - No active concepts → return 0.0 (everything drifted away)
 * - No concepts in any moment → return 1.0 (moments without concepts = no anchor)
 */
export function computeDriftScore(
  momentConceptIds: ReadonlySet<number>,
  activeConceptIds: ReadonlySet<number>,
): number {
  if (momentConceptIds.size === 0) return 1.0;
  if (activeConceptIds.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const id of momentConceptIds) {
    if (activeConceptIds.has(id)) intersectionSize++;
  }

  const unionSize = momentConceptIds.size + activeConceptIds.size - intersectionSize;
  return intersectionSize / unionSize;
}
```

### Pattern 4: Tier Instability Detection
**What:** Find concepts that were ACTIVE and dropped to MILD or LESS within the rolling window.
**When to use:** For DRF-03 flagging.

```typescript
// src/audit/scorer.ts

export interface InstabilityFlag {
  readonly concept_id: number;
  readonly surface_form: string;
  readonly dropped_at: string;   // ISO 8601 of the tier_change event
  readonly from: "ACTIVE";
  readonly to: "MILD" | "LESS";
}

export function detectInstability(
  events: readonly AuditEvent[],
  windowDays: number,
  nowMs: number = Date.now(),
): InstabilityFlag[] {
  const cutoffMs = nowMs - windowDays * 86_400_000;
  const flags: InstabilityFlag[] = [];

  for (const event of events) {
    if (event.type !== "tier_change") continue;
    if (new Date(event.timestamp).getTime() < cutoffMs) continue;
    if (event.from !== "ACTIVE") continue;
    if (event.to === "ACTIVE") continue;
    flags.push({
      concept_id: event.concept_id,
      surface_form: event.surface_form,
      dropped_at: event.timestamp,
      from: "ACTIVE",
      to: event.to as "MILD" | "LESS",
    });
  }

  return flags;
}
```

### Pattern 5: Sentiment Flip Detection
**What:** Find concepts that appear with both PREFERRED and DISPREFERRED in the rolling window.
**When to use:** For DRF-04 flagging.

```typescript
// src/audit/scorer.ts

export interface SentimentFlipFlag {
  readonly concept_id: number;
  readonly surface_form: string;
  readonly sentiments_seen: readonly string[];  // both sides found in window
}

export function detectSentimentFlips(
  events: readonly AuditEvent[],
  windowDays: number,
  nowMs: number = Date.now(),
): SentimentFlipFlag[] {
  const cutoffMs = nowMs - windowDays * 86_400_000;
  // Track sentiments per concept within window
  const conceptSentiments = new Map<number, { surface_form: string; seen: Set<string> }>();

  for (const event of events) {
    if (event.type !== "sentiment_flip") continue;
    if (new Date(event.timestamp).getTime() < cutoffMs) continue;
    const entry = conceptSentiments.get(event.concept_id) ?? {
      surface_form: event.surface_form,
      seen: new Set<string>(),
    };
    entry.seen.add(event.from);
    entry.seen.add(event.to);
    conceptSentiments.set(event.concept_id, entry);
  }

  const flags: SentimentFlipFlag[] = [];
  for (const [concept_id, { surface_form, seen }] of conceptSentiments) {
    if (seen.has("PREFERRED") && seen.has("DISPREFERRED")) {
      flags.push({ concept_id, surface_form, sentiments_seen: [...seen] });
    }
  }
  return flags;
}
```

### Pattern 6: Trend Classification
**What:** Map drift score + window instability count to a human-readable trend.
**When to use:** DRF-06 `theorex drift` output.

```typescript
// src/audit/scorer.ts

export type DriftTrend = "stable" | "drifting" | "recovering";

export function classifyTrend(
  currentScore: number,
  instabilityCount: number,
): DriftTrend {
  // recovering = high score but recent instability events (bouncing back)
  if (currentScore >= 0.7 && instabilityCount > 0) return "recovering";
  // drifting = low score or heavy instability
  if (currentScore < 0.5 || instabilityCount >= 3) return "drifting";
  return "stable";
}
```

### Pattern 7: Filtered JSONL Reader
**What:** Read events.jsonl line by line, parse each JSON object, apply type/since filters.
**When to use:** `theorex audit` command, and scorer inputs.

```typescript
// src/audit/reader.ts

export interface AuditFilter {
  type?: AuditEventType;
  sinceMs?: number;   // parsed from --since YYYY-MM-DD
}

export async function readAuditEvents(
  path: string = EVENTS_PATH,
  filter: AuditFilter = {},
): Promise<AuditEvent[]> {
  const text = await Bun.file(path).text().catch(() => "");
  const lines = text.split("\n").filter(Boolean);
  const events: AuditEvent[] = [];

  for (const line of lines) {
    let parsed: AuditEvent;
    try { parsed = JSON.parse(line) as AuditEvent; }
    catch { continue; }

    if (filter.type && parsed.type !== filter.type) continue;
    if (filter.sinceMs && new Date(parsed.timestamp).getTime() < filter.sinceMs) continue;
    events.push(parsed);
  }

  return events;
}
```

### Pattern 8: Wiring Audit Events into Existing Mutation Sites
**What:** The six callsites that must emit events. All additions are minimal — one `appendAuditEvent()` call each. Failures MUST NOT propagate (try/catch or void).

| Mutation Site | File | Event Type | Timing |
|--------------|------|-----------|--------|
| scanAxon — node tier changes | `src/axon/scan.ts` | `tier_change` | After `store.graph.setNodeAttribute(key, "relevance_tier", tier)`, compare old vs new |
| pruneAxon — node dropped | `src/axon/prune.ts` | `prune` | Before `graph.dropNode()` (after archive write succeeds) |
| propagateSentiment — sentiment set | `src/axon/propagate.ts` | `sentiment_flip` | After `g.setNodeAttribute(nodeKey, "sentiment_tier", sentiment)`, compare old vs new |
| graduateToLongTerm — entries promoted | `src/short-term/graduate.ts` | `graduation` | After successful write to MEMORY.md |
| createMoment — moment captured | `src/moments/store.ts` OR `src/moments/capture.ts` | `moment_capture` | After atomic rename succeeds |

**Critical pattern for scanAxon:** capture old tier BEFORE re-scoring, compare after. Only emit event when tier actually changed (no-op events create noise).

```typescript
// Inside scanAxon loop — scan.ts modification sketch
const oldTier = attrs.relevance_tier;
// ... compute tier ...
store.graph.setNodeAttribute(key, "relevance_tier", tier);

if (tier !== oldTier) {
  // Non-blocking — audit failure MUST NOT fail scan
  void appendAuditEvent({
    type: "tier_change",
    timestamp: new Date(nowMs).toISOString(),
    source: "scan",
    concept_id: attrs.concept_id,
    surface_form: attrs.surface_form,
    from: oldTier,
    to: tier,
  }, eventsPath).catch(() => {});
}
```

### Pattern 9: runStatus Extension for DRF-07
**What:** Append drift summary after the moments block — wrapped in independent try/catch.

```typescript
// Append to runStatus() in src/cli/index.ts after moments block
try {
  const driftResult = await computeDrift(AXON_PATH, EVENTS_PATH, config);
  const alert = driftResult.score < 0.5 ? " [!]" : "";
  console.log(`\nDrift: ${driftResult.score.toFixed(2)} — ${driftResult.trend}${alert}`);
} catch {
  // drift summary failure is non-fatal
}
```

### Anti-Patterns to Avoid
- **Using `Bun.write()` for the audit log:** Silently overwrites — always use `appendFile`.
- **Emitting audit events for no-op tier transitions:** If `oldTier === newTier`, do not emit — creates log noise and skews instability counts.
- **Blocking scan/prune on audit write failures:** Audit events are observability data. Use `void appendAuditEvent(...).catch(() => {})` at mutation sites.
- **Mutual imports between audit/ and axon/:** audit/logger.ts must have NO imports from axon/ — direction is one-way (axon imports audit, never reverse).
- **Reading the full events.jsonl inside scanAxon:** The scanner should emit events, not read them. Drift scoring happens at CLI invocation time only.
- **Computing drift on every `theorex status` call:** Use try/catch with a graceful no-op if events.jsonl does not exist (cold start — no events yet).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONL append | Custom file lock + write | `appendFile` from `node:fs/promises` | Already proven in Phase 2; handles concurrent appends correctly on single-machine |
| Drift score algorithm | Novel ML or statistical model | Jaccard intersection-over-union on sets | Simple, deterministic, interpretable; DRF-05 explicitly forbids LLM calls |
| CLI flag parsing | Manual argv scanning | `parseArgs` from `util` | Already used in CLI for moment --ref flags |
| Set operations | Manual array loops | `Set` with `.has()` for intersection | O(n) instead of O(n²) with arrays |

**Key insight:** Every data source this phase needs already exists on disk in well-defined formats. The entire phase is wiring + math — no new storage formats, no new dependencies.

## Common Pitfalls

### Pitfall 1: Audit Events on Every Scan Run Even When Tier Unchanged
**What goes wrong:** scanAxon runs every 6 hours. If it emits a tier_change event every run for every node (even stable ones), events.jsonl becomes enormous and instability detection produces false positives.
**Why it happens:** Forgetting to compare old tier to new tier before emitting.
**How to avoid:** Capture `oldTier = attrs.relevance_tier` before computing new tier. Only `appendAuditEvent` when `oldTier !== newTier`.
**Warning signs:** events.jsonl growing > 1MB per day; instability flags on concepts that visually look stable.

### Pitfall 2: Drift Score of 0.0 on Cold Start (No Moments)
**What goes wrong:** If no moment nodes exist, the drift computation tries to compute Jaccard over an empty set and returns 0.0, showing "drifting" when the system just hasn't been used yet.
**Why it happens:** No guard for the empty-moments case.
**How to avoid:** Return `1.0` (fully stable) when `momentConceptIds.size === 0` — no anchors means no baseline for drift.
**Warning signs:** `theorex drift` showing 0.0 on a fresh installation.

### Pitfall 3: Blocking scan on Audit Write Failure
**What goes wrong:** If data/events.jsonl is locked by another process or disk is full, `appendAuditEvent` throws, propagates up through scanAxon, and the entire scheduled scan fails.
**Why it happens:** Awaiting audit append inside scan loop without error handling.
**How to avoid:** Always: `void appendAuditEvent(...).catch(() => {})` at mutation sites. The scan MUST succeed even if audit logging fails.
**Warning signs:** PM2 scan jobs failing silently; tier decay not applied.

### Pitfall 4: `--since` Date Parsing Edge Cases
**What goes wrong:** User passes `--since 2026-03-01` which parses as UTC midnight, but events use local timezone ISO strings, causing events from that day to be excluded.
**Why it happens:** `new Date("2026-03-01")` in JavaScript parses as UTC midnight (00:00:00Z), not local midnight.
**How to avoid:** For `--since` filtering, treat the date as the start of that UTC day — `new Date(since + "T00:00:00.000Z").getTime()`. Document this behavior in CLI help text.
**Warning signs:** Test with an event timestamped at "2026-03-01T08:00:00Z" and `--since 2026-03-01` — it should be included.

### Pitfall 5: events.jsonl Path Not Matching Across Call Sites
**What goes wrong:** `logger.ts` defaults to `"data/events.jsonl"` but mutation sites call `appendAuditEvent` with no path override and the process.cwd() differs between CLI invocation and test environments.
**Why it happens:** Relative paths resolve against `process.cwd()` — test environment uses `/tmp/` temp paths.
**How to avoid:** Export `EVENTS_PATH = "data/events.jsonl"` as a constant. All mutation sites and tests inject the path as a parameter — same pattern used by `AXON_PATH`, `ARCHIVE_DIR`, `MEMORY_PATH` in existing CLI.

### Pitfall 6: Graphology safety — collect node keys BEFORE iterating for drift score
**What goes wrong:** If drift scoring iterates `store.graph.nodes()` while also calling graph methods, it can encounter Graphology iterator invalidation.
**Why it happens:** Same issue as prior phases (documented in STATE.md).
**How to avoid:** `const nodeKeys = store.graph.nodes()` before any loop — already the established pattern for all axon operations in this project.

## Code Examples

### Reading ACTIVE concept IDs from AxonStore (for DRF-02)
```typescript
// Source: existing pattern in src/moments/capture.ts (injectContext activeIds)
import { AxonStore } from "../axon/store";
import { compositeScore, classifyTier } from "../axon/scorer";

async function getActiveConceptIds(
  axonPath: string,
  config: ScoringConfig,
  nowMs: number = Date.now(),
): Promise<Set<number>> {
  const store = await AxonStore.load(axonPath);
  const active = new Set<number>();

  const nodeKeys = store.graph.nodes();
  for (const key of nodeKeys) {
    const attrs = store.graph.getNodeAttributes(key);
    const neighborStrengths = store.graph
      .neighbors(key)
      .map((nbr) => {
        const edgeKey = store.graph.edge(key, nbr);
        return edgeKey ? store.graph.getEdgeAttributes(edgeKey).strength : 0;
      });
    const score = compositeScore(attrs.last_seen, attrs.frequency_count, neighborStrengths, nowMs, config);
    const tier = classifyTier(score, config);
    if (tier === "ACTIVE") active.add(attrs.concept_id);
  }

  return active;
}
```

### Collecting moment concept IDs (for DRF-02)
```typescript
// Source: existing readMoments() in src/moments/store.ts
import { readMoments } from "../moments/store";

async function getMomentConceptIds(momentsDir: string): Promise<Set<number>> {
  const moments = await readMoments(momentsDir);
  const ids = new Set<number>();
  for (const m of moments) {
    for (const id of m.concept_ids) {
      ids.add(id);
    }
  }
  return ids;
}
```

### `theorex audit` dispatch in CLI (DRF-08, CLI-09)
```typescript
// In import.meta.main dispatch block in src/cli/index.ts
case "audit": {
  // Usage: theorex audit [--type <type>] [--since <date>]
  const { values } = parseArgs({
    args: rest,
    options: {
      type: { type: "string" },
      since: { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });
  await runAudit(EVENTS_PATH, {
    type: values.type as AuditEventType | undefined,
    since: values.since,
  });
  break;
}

case "drift": {
  await runDrift(AXON_PATH, EVENTS_PATH, config);
  break;
}
```

### Config extension pattern (Phase 8 additions)
```typescript
// src/config.ts — add fields to Config interface and DEFAULT_CONFIG
interface Config {
  // ... existing fields ...
  // Phase 8: Drift Detection
  driftWindowDays: number;        // default: 7  — rolling window for instability/flip detection
  eventsPath: string;             // default: "data/events.jsonl"
}

DEFAULT_CONFIG additions:
  driftWindowDays: 7,
  eventsPath: "data/events.jsonl",
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A — new phase | Append-only JSONL audit log | Phase 8 | Events are immutable history; never overwritten |
| N/A — new phase | Jaccard score vs moment anchors | Phase 8 | Deterministic, interpretable, zero LLM dependency |

**No deprecated approaches here** — this is a new module with no prior implementation.

## Open Questions

1. **What is the right threshold for "drifting" trend classification?**
   - What we know: DRF-06 requires stable / drifting / recovering trend labels
   - What's unclear: Specific numeric thresholds for each label (< 0.5 drifting, ≥ 0.7 stable?)
   - Recommendation: Use configurable thresholds with documented defaults; initial proposal: score < 0.5 = drifting, score ≥ 0.7 = stable, ≥ 0.7 with recent instability = recovering. Adjust in config.json post-implementation.

2. **Should `theorex drift` use lazy tier correction (like runStatus) or stored tiers?**
   - What we know: runStatus applies `compositeScore + classifyTier` at read time to correct for elapsed decay (REL-03). The drift scorer needs the ACTIVE set.
   - What's unclear: Whether drift score should reflect "what axon.json says" or "what it would say if re-scored now"
   - Recommendation: Apply lazy correction in drift scoring (same as runStatus) for consistency. This means getActiveConceptIds() uses compositeScore+classifyTier with Date.now(), not the stored relevance_tier field.

3. **Should scanAxon emit tier_change events synchronously or asynchronously?**
   - What we know: scanAxon runs on a 6-hour PM2 cron; audit write failure must not fail the scan (pitfall 3 above)
   - What's unclear: Whether `void appendAuditEvent(...).catch(() => {})` (fire-and-forget) is sufficient vs awaiting with error suppression
   - Recommendation: `void appendAuditEvent(...).catch(() => {})` — same pattern as PostToolUse hook's `async: true` fire-and-forget. Scan speed is unaffected.

4. **What is the maximum expected size of events.jsonl?**
   - What we know: Events fire on tier changes only (not every scan of every node); a 6-hour scan might produce 0–20 events for a typical concept web
   - What's unclear: Long-running production behavior
   - Recommendation: No truncation logic in Phase 8. If the file grows unexpectedly, a `theorex audit --rotate` subcommand could be added in a future phase. For now, full read into memory is safe at expected scale.

## Sources

### Primary (HIGH confidence)
- Source code audit: `src/axon/scan.ts`, `src/axon/prune.ts`, `src/axon/propagate.ts`, `src/moments/store.ts`, `src/cli/index.ts`, `src/short-term/graduate.ts` — direct examination of all mutation sites
- `.planning/STATE.md` decisions log — confirmed `appendFile` from `node:fs/promises` mandatory for JSONL (Phase 2 decision), Graphology mutation-safety pattern, CLI dispatch pattern
- `.planning/REQUIREMENTS.md` — DRF-01 through DRF-08, CLI-08, CLI-09 exact specification
- `src/config.ts` — Config interface, DEFAULT_CONFIG pattern for extending

### Secondary (MEDIUM confidence)
- Jaccard similarity coefficient — standard set-theoretic measure; well-known, no external verification needed
- `node:fs/promises` appendFile behavior in Bun 1.3.10 — confirmed by Phase 2 implementation decision; Bun docs note Node.js API compatibility

### Tertiary (LOW confidence)
- None — all research grounded in direct codebase reading and project STATE.md

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all APIs already used in project
- Architecture: HIGH — patterns derived directly from existing working code in same project
- Pitfalls: HIGH — most identified from reading existing STATE.md decisions and code invariants
- Drift score formula: HIGH — Jaccard similarity is textbook; edge cases identified from requirement spec reading

**Research date:** 2026-03-11
**Valid until:** Indefinite — pure math + project-internal patterns, no external library dependencies to track
