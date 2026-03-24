# Deliberation Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a post-session review protocol where Singularity, Divergent, and Horizon debrief completed trading sessions, cross-reference perspectives, and extract institutional knowledge into the Theorex axon.

**Architecture:** New `src/deliberate/` module in Theorex. Sequential LLM dispatches to Qwen3 32B on M1 (3 perspective prompts + 1 orchestrator). Outputs to JSON record, markdown debrief, Telegram summary, and web UI. Integrates with existing EventBus, AxonStore, and dispatch worker.

**Tech Stack:** TypeScript, Bun, Qwen3 32B (LM Studio), Theorex EventBus/AxonStore/dispatch

**Spec:** `docs/superpowers/specs/2026-03-24-deliberation-channel-design.md`

---

### Task 1: Add max_tokens to DispatchTask

**Files:**
- Modify: `src/dispatch/worker.ts`
- Test: `tests/dispatch/worker.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect, mock } from "bun:test";
import type { DispatchTask } from "../../src/dispatch/worker";

test("DispatchTask accepts max_tokens field", () => {
  const task: DispatchTask = {
    id: "test-max-tokens",
    agent_id: "test",
    task: "say hello",
    context_pct: 0,
    query_tokens: 10,
    tags: [],
    created_at: new Date().toISOString(),
    max_tokens: 2048,
  };
  expect(task.max_tokens).toBe(2048);
});

test("DispatchTask defaults max_tokens to undefined", () => {
  const task: DispatchTask = {
    id: "test-default",
    agent_id: "test",
    task: "say hello",
    context_pct: 0,
    query_tokens: 10,
    tags: [],
    created_at: new Date().toISOString(),
  };
  expect(task.max_tokens).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/dispatch/worker.test.ts`
Expected: FAIL — `max_tokens` does not exist on type `DispatchTask`

- [ ] **Step 3: Add `max_tokens` to DispatchTask type**

In `src/dispatch/worker.ts`, add to the `DispatchTask` interface:
```typescript
readonly max_tokens?: number;  // default 1024
```

- [ ] **Step 4: Use `max_tokens` in callLmStudio**

In `src/dispatch/worker.ts`, replace the hardcoded `max_tokens: 1024` with:
```typescript
max_tokens: task.max_tokens ?? 1024,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/dispatch/worker.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/eoh/theorex && git add src/dispatch/worker.ts tests/dispatch/worker.test.ts
git commit -m "feat: add optional max_tokens to DispatchTask"
```

---

### Task 2: Define deliberation types

**Files:**
- Create: `src/deliberate/types.ts`
- Test: `tests/deliberate/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import type {
  TradingSession,
  DeliberationStatus,
  SingularityReport,
  DivergentReport,
  HorizonReport,
  PerspectiveReport,
  SessionPacket,
  DeliberationRecord,
} from "../../src/deliberate/types";

test("types can be instantiated", () => {
  const session: TradingSession = "LDN";
  const status: DeliberationStatus = "complete";
  expect(session).toBe("LDN");
  expect(status).toBe("complete");
});

test("DeliberationRecord has version 1", () => {
  const record: DeliberationRecord = {
    version: 1,
    id: "test",
    date: "2026-03-24",
    session: "LDN",
    status: "complete",
    created_at: new Date().toISOString(),
    session_packet: {
      id: "pkt-1",
      date: "2026-03-24",
      session: "LDN",
      collected_at: new Date().toISOString(),
      singularity: {
        session_profile: "london_buy_mon",
        trades: [],
        setups_triggered: 0,
        setups_skipped: 0,
        session_pnl: 0,
        win_rate: 0,
      },
      divergent: null,
      horizon: null,
    },
    perspectives: { singularity: null, divergent: null, horizon: null },
    cross_reference: null,
    takeaways: [],
  };
  expect(record.version).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the types file**

Create `src/deliberate/types.ts` with all types from the spec: `TradingSession`, `DeliberationStatus`, `SingularityReport`, `DivergentReport`, `HorizonReport`, `PerspectiveReport`, `SessionPacket`, `DeliberationRecord`. All fields `readonly`. Export all types.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/types.ts tests/deliberate/types.test.ts
git commit -m "feat: add deliberation channel type definitions"
```

---

### Task 3: Add EventBus event types

**Files:**
- Modify: `src/trace/bus.ts`
- Test: `tests/trace/bus.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import { EventBus } from "../../src/trace/bus";

test("EventBus handles DELIBERATION_START event", () => {
  const bus = new EventBus();
  const events: unknown[] = [];
  bus.on("DELIBERATION_START", (payload) => events.push(payload));
  bus.emit("DELIBERATION_START", {
    deliberation_id: "delib-1",
    session: "LDN",
    date: "2026-03-24",
  });
  expect(events).toHaveLength(1);
});

test("EventBus handles DELIBERATION_COMPLETE event", () => {
  const bus = new EventBus();
  const events: unknown[] = [];
  bus.on("DELIBERATION_COMPLETE", (payload) => events.push(payload));
  bus.emit("DELIBERATION_COMPLETE", {
    deliberation_id: "delib-1",
    status: "complete",
    takeaway_count: 3,
  });
  expect(events).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/trace/bus.test.ts`
Expected: FAIL — type errors on new event types

- [ ] **Step 3: Add deliberation event types to BusEventType union and BusEventPayloadMap**

In `src/trace/bus.ts`, add to the `BusEventType` union:
```typescript
| "DELIBERATION_START"
| "DELIBERATION_ROUND"
| "DELIBERATION_COMPLETE"
```

Add to `BusEventPayloadMap`:
```typescript
DELIBERATION_START: {
  readonly deliberation_id: string;
  readonly session: TradingSession;
  readonly date: string;
};
DELIBERATION_ROUND: {
  readonly deliberation_id: string;
  readonly round: number;
  readonly engine?: string;
  readonly success: boolean;
};
DELIBERATION_COMPLETE: {
  readonly deliberation_id: string;
  readonly status: DeliberationStatus;
  readonly takeaway_count: number;
};
```

Import `TradingSession` and `DeliberationStatus` from `../deliberate/types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/trace/bus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/trace/bus.ts tests/trace/bus.test.ts
git commit -m "feat: add deliberation events to EventBus"
```

---

### Task 4: Singularity report extractor

**Files:**
- Create: `src/deliberate/extractors/singularity.ts`
- Test: `tests/deliberate/extractors/singularity.test.ts`

- [ ] **Step 1: Write the failing test**

Create a test that:
- Writes sample JSONL trade data to a temp file (matching `latent_trades.jsonl` format)
- Calls `extractSingularityReport(tradesPath, session, date)`
- Asserts the returned `SingularityReport` has correct trade count, win_rate, session_pnl
- Tests filtering trades by session time window and date
- Tests the empty case (no trades for the session)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/extractors/singularity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the extractor**

Create `src/deliberate/extractors/singularity.ts`:
- `extractSingularityReport(tradesPath: string, session: TradingSession, date: string): Promise<SingularityReport>`
- Read JSONL file with `Bun.file().text()`, parse line by line
- Filter trades by date and session time window (LDN: 07:00-16:00 UTC, NY: 13:00-21:00 UTC, ASIA: 00:00-08:00 UTC)
- Compute win_rate, session_pnl, setups_triggered, setups_skipped
- Return immutable `SingularityReport`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/extractors/singularity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/extractors/singularity.ts tests/deliberate/extractors/singularity.test.ts
git commit -m "feat: add Singularity session report extractor"
```

---

### Task 5: Divergent and Horizon report extractors (stubs)

**Files:**
- Create: `src/deliberate/extractors/divergent.ts`
- Create: `src/deliberate/extractors/horizon.ts`
- Test: `tests/deliberate/extractors/divergent.test.ts`
- Test: `tests/deliberate/extractors/horizon.test.ts`

- [ ] **Step 1: Write failing tests for both**

Each test:
- Calls the extractor with a path that doesn't exist
- Asserts it returns `null` (graceful degradation — engine not yet wired)
- Calls with a path to a valid mock JSON file
- Asserts the returned report matches the schema

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/extractors/`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement both extractors**

`src/deliberate/extractors/divergent.ts`:
- `extractDivergentReport(reportPath: string, session: TradingSession, date: string): Promise<DivergentReport | null>`
- If file doesn't exist, return `null`
- Parse JSON, validate against `DivergentReport` shape, return

`src/deliberate/extractors/horizon.ts`:
- `extractHorizonReport(reportPath: string, session: TradingSession, date: string): Promise<HorizonReport | null>`
- Same pattern: return `null` if unavailable, parse if present

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/extractors/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/extractors/ tests/deliberate/extractors/
git commit -m "feat: add Divergent and Horizon report extractors (with null fallback)"
```

---

### Task 6: Session packet builder

**Files:**
- Create: `src/deliberate/packet.ts`
- Test: `tests/deliberate/packet.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import { buildSessionPacket } from "../../src/deliberate/packet";

test("buildSessionPacket assembles all three reports", async () => {
  const packet = await buildSessionPacket({
    session: "LDN",
    date: "2026-03-24",
    singularityPath: "/tmp/test-trades.jsonl",
    divergentPath: "/tmp/test-divergent.json",
    horizonPath: "/tmp/test-horizon.json",
  });
  expect(packet.session).toBe("LDN");
  expect(packet.date).toBe("2026-03-24");
  expect(packet.id).toBeTruthy();
  expect(packet.singularity).toBeDefined();
});

test("buildSessionPacket handles missing engines", async () => {
  const packet = await buildSessionPacket({
    session: "LDN",
    date: "2026-03-24",
    singularityPath: "/tmp/test-trades.jsonl",
    divergentPath: "/nonexistent/path.json",
    horizonPath: "/nonexistent/path.json",
  });
  expect(packet.divergent).toBeNull();
  expect(packet.horizon).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/packet.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the packet builder**

Create `src/deliberate/packet.ts`:
- `buildSessionPacket(opts: PacketOptions): Promise<SessionPacket>`
- Calls all three extractors, assembles into `SessionPacket`
- Generates UUID for `id`, ISO timestamp for `collected_at`
- All fields immutable

- [ ] **Step 4: Also add `condensePacket(packet: SessionPacket): SessionPacket`**

Produces a condensed version for LLM dispatch:
- Singularity: max 20 trades (most recent), rest summarized as stats
- Horizon: max 10 predictions (most recent)
- Divergent: passed through unchanged (fixed size)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/packet.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/packet.ts tests/deliberate/packet.test.ts
git commit -m "feat: add session packet builder with condensation"
```

---

### Task 7: Perspective prompt templates

**Files:**
- Create: `src/deliberate/prompts.ts`
- Test: `tests/deliberate/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Test that each prompt builder:
- Accepts a condensed `SessionPacket`
- Returns a string containing the session date and session name
- Contains the engine-specific framing (e.g. "technicals" for Singularity, "regime" for Divergent)
- Returns the orchestrator prompt containing all three perspective reports

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/prompts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement prompt templates**

Create `src/deliberate/prompts.ts`:

```typescript
export function buildSingularityPrompt(packet: SessionPacket): string
export function buildDivergentPrompt(packet: SessionPacket): string
export function buildHorizonPrompt(packet: SessionPacket): string
export function buildOrchestratorPrompt(
  packet: SessionPacket,
  perspectives: {
    singularity: PerspectiveReport | null;
    divergent: PerspectiveReport | null;
    horizon: PerspectiveReport | null;
  }
): string
```

Each perspective prompt:
- Includes the full condensed session packet as context
- Instructs the LLM to respond ONLY from its engine's perspective
- Requests structured JSON output matching `PerspectiveReport`

The orchestrator prompt:
- Includes all available perspective reports
- Instructs to find alignments, conflicts, blind spots, missed opportunities
- Requests structured JSON output with `cross_reference` fields AND `takeaways` array

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/prompts.ts tests/deliberate/prompts.test.ts
git commit -m "feat: add perspective and orchestrator prompt templates"
```

---

### Task 8: Takeaway extractor (post-processing)

**Files:**
- Create: `src/deliberate/takeaways.ts`
- Test: `tests/deliberate/takeaways.test.ts`

- [ ] **Step 1: Write the failing test**

Test that `extractTakeaways()`:
- Parses a mock orchestrator JSON response
- Extracts `takeaways` array with `insight`, `test_condition`, `engines_involved`, `confidence`
- Handles malformed JSON gracefully (returns empty array)
- Filters out takeaways with confidence < 0.3

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/takeaways.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the extractor**

Create `src/deliberate/takeaways.ts`:
```typescript
export function extractTakeaways(orchestratorResponse: string): ReadonlyArray<Takeaway>
```
- Parse JSON from the orchestrator response
- Validate each takeaway field
- Filter by minimum confidence threshold (0.3)
- Return immutable array

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/takeaways.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/takeaways.ts tests/deliberate/takeaways.test.ts
git commit -m "feat: add takeaway extractor for orchestrator output"
```

---

### Task 9: Deliberation record writer

**Files:**
- Create: `src/deliberate/writer.ts`
- Test: `tests/deliberate/writer.test.ts`

- [ ] **Step 1: Write the failing test**

Test that `writeDeliberation()`:
- Writes a `DeliberationRecord` to `{dir}/{date}-{session}.json` atomically (tmp → rename)
- Also writes `{dir}/{date}-{session}.md` markdown debrief
- Deduplication: throws/returns error if file already exists (unless `force: true`)
- The markdown contains perspective narratives, cross-reference sections, and takeaways

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/writer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the writer**

Create `src/deliberate/writer.ts`:
```typescript
export async function writeDeliberation(
  record: DeliberationRecord,
  dir: string,
  opts?: { force?: boolean }
): Promise<{ jsonPath: string; mdPath: string }>
```
- Atomic write: `Bun.write(tmpPath, JSON.stringify(record, null, 2))` → rename
- Generate markdown from record (see `renderMarkdown` helper)
- Dedup check: `Bun.file(targetPath).exists()`

```typescript
export function renderMarkdown(record: DeliberationRecord): string
```
- Renders the full debrief as readable markdown with headers, bullet lists, and sections

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/writer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/writer.ts tests/deliberate/writer.test.ts
git commit -m "feat: add deliberation record + markdown writer"
```

---

### Task 10: Telegram summary formatter

**Files:**
- Create: `src/deliberate/telegram.ts`
- Test: `tests/deliberate/telegram.test.ts`

- [ ] **Step 1: Write the failing test**

Test that `formatTelegramSummary()`:
- Takes a `DeliberationRecord`
- Returns a condensed string matching the spec format (trades, regime, conflicts, takeaways)
- Handles partial records (missing perspectives) gracefully
- Output is under 4096 characters (Telegram message limit)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/telegram.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the formatter**

Create `src/deliberate/telegram.ts`:
```typescript
export function formatTelegramSummary(record: DeliberationRecord): string
```
- Formats the condensed summary matching the spec example
- Includes: session header, trade stats, regime, prediction accuracy, conflicts, top takeaways, status

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/telegram.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/telegram.ts tests/deliberate/telegram.test.ts
git commit -m "feat: add Telegram summary formatter for deliberations"
```

---

### Task 11: Core deliberation orchestrator

**Files:**
- Create: `src/deliberate/orchestrate.ts`
- Test: `tests/deliberate/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test**

Test that `runDeliberation()`:
- Accepts session, date, config, and paths
- Returns a `DeliberationRecord`
- Calls dispatch sequentially (mock dispatch for test)
- Handles dispatch failure gracefully (sets status to "partial", null perspectives)
- Emits `DELIBERATION_START` and `DELIBERATION_COMPLETE` events
- Writes takeaways to axon via `batchWriteToAgent()`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/orchestrate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the orchestrator**

Create `src/deliberate/orchestrate.ts`:
```typescript
export async function runDeliberation(opts: {
  session: TradingSession;
  date: string;
  config: Config;
  paths: {
    singularity: string;
    divergent: string;
    horizon: string;
  };
  outputDir: string;
  force?: boolean;
}): Promise<DeliberationRecord>
```

Flow:
1. Emit `DELIBERATION_START`
2. `buildSessionPacket()` — Round 0
3. `condensePacket()` for LLM dispatch
4. Sequential dispatch: Singularity → Divergent → Horizon perspectives (Round 1)
   - Each uses `dispatch()` with `max_tokens: 4096`
   - Parse response as `PerspectiveReport`
   - On failure: log, set to `null`, emit `DELIBERATION_ROUND` with `success: false`
5. Dispatch orchestrator prompt with all perspectives (Round 2)
   - On failure: set `cross_reference: null`, `status: "partial"`
6. `extractTakeaways()` — Step 3
7. Build `DeliberationRecord`
8. `writeDeliberation()` — JSON + markdown
9. `batchWriteToAgent()` — write takeaways to axon
10. `formatTelegramSummary()` — format for Telegram (caller handles sending)
11. Emit `DELIBERATION_COMPLETE`
12. Return record

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/orchestrate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/orchestrate.ts tests/deliberate/orchestrate.test.ts
git commit -m "feat: add core deliberation orchestrator"
```

---

### Task 12: CLI command — `theorex deliberate`

**Files:**
- Create: `src/deliberate/cli.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/deliberate/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Test that `runDeliberateCli()`:
- Parses `--session LDN --date 2026-03-24` args
- Parses `--latest` flag
- Parses `--force` flag
- Rejects missing required args with helpful error message

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/cli.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CLI handler**

Create `src/deliberate/cli.ts`:
```typescript
export async function runDeliberateCli(args: string[], config: Config): Promise<void>
```
- Parse args: `--session`, `--date`, `--latest`, `--force`, `--since` (for listing)
- If `--latest`: determine most recent session from Singularity logs
- Call `runDeliberation()` with parsed options
- Print summary to stdout
- Handle `deliberations` subcommand for listing

- [ ] **Step 4: Wire into `src/cli/index.ts`**

Add `"deliberate"` and `"deliberations"` to the command dispatch switch statement. Import and call `runDeliberateCli`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/cli.ts src/cli/index.ts tests/deliberate/cli.test.ts
git commit -m "feat: add theorex deliberate CLI command"
```

---

### Task 13: MCP tools — `deliberate` + `deliberation_history`

**Files:**
- Create: `src/deliberate/mcp.ts`
- Modify: `src/mcp/server.ts`
- Test: `tests/deliberate/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Test that:
- `handleDeliberateTool()` accepts `{ session, date, force? }` and returns a result
- `handleDeliberationHistoryTool()` accepts `{ since?, session? }` and returns records
- Both return proper JSON-RPC response format

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/mcp.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MCP tool handlers**

Create `src/deliberate/mcp.ts`:
```typescript
export function deliberateToolDef(): ToolDefinition
export function deliberationHistoryToolDef(): ToolDefinition
export async function handleDeliberateTool(args: Record<string, unknown>, config: Config): Promise<McpResult>
export async function handleDeliberationHistoryTool(args: Record<string, unknown>, config: Config): Promise<McpResult>
```

- [ ] **Step 4: Wire into `src/mcp/server.ts`**

Add both tools to `handleToolsList()` array. Add cases to `handleToolCall()` switch.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/mcp.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/eoh/theorex && git add src/deliberate/mcp.ts src/mcp/server.ts tests/deliberate/mcp.test.ts
git commit -m "feat: add deliberate and deliberation_history MCP tools"
```

---

### Task 14: Web UI deliberation panel

**Files:**
- Modify: `src/web/server.ts`
- Modify: `src/web/index.html`
- Test: Manual browser test

- [ ] **Step 1: Add API route for deliberation data**

In `src/web/server.ts`, add:
- `GET /api/deliberations` — list deliberation records (read `data/deliberations/*.json`)
- `GET /api/deliberations/:id` — single deliberation detail

- [ ] **Step 2: Add deliberation tab to web UI**

In `src/web/index.html`, add a new tab/section:
- Timeline view of past deliberations (date, session, status, takeaway count)
- Click to expand: perspectives, cross-reference sections, takeaways
- Filter controls: session (LDN/NY/ASIA), date range
- Highlight takeaways that promoted to shared-axon

- [ ] **Step 3: Test in browser**

Run: `cd /Users/eoh/theorex && bun run src/web/server.ts`
Open: `http://127.0.0.1:7777`
Verify: deliberation tab loads, shows test data

- [ ] **Step 4: Commit**

```bash
cd /Users/eoh/theorex && git add src/web/server.ts src/web/index.html
git commit -m "feat: add deliberation panel to web UI"
```

---

### Task 15: Singularity loop integration

**Files:**
- Modify: Singularity loop trigger point (likely `singularity_loop.py` or a new Theorex hook)
- Test: `tests/deliberate/integration.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow end-to-end:
- Write mock trade data to a temp dir
- Write mock Divergent/Horizon reports
- Call `runDeliberation()` with real config
- Assert: JSON file written, markdown file written, takeaways extracted
- Assert: EventBus received DELIBERATION_START and DELIBERATION_COMPLETE

- [ ] **Step 2: Run integration test**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/integration.test.ts`
Expected: PASS (with mocked dispatch)

- [ ] **Step 3: Wire Singularity loop trigger**

Add a call from Singularity's post-digest hook to trigger:
```bash
cd /Users/eoh/theorex && bun run src/cli/index.ts deliberate --latest
```

This runs after the existing digest → war-game → patch → verify cycle. The exact integration point depends on how Singularity's loop calls external tools — may be a subprocess call from Python or a webhook.

- [ ] **Step 4: Commit**

```bash
cd /Users/eoh/theorex && git add tests/deliberate/integration.test.ts
git commit -m "feat: add deliberation integration test and loop hook"
```

---

### Task 16: Run full test suite and verify

- [ ] **Step 1: Run all deliberation tests**

Run: `cd /Users/eoh/theorex && bun test tests/deliberate/`
Expected: All PASS

- [ ] **Step 2: Run full project test suite**

Run: `cd /Users/eoh/theorex && bun test`
Expected: No regressions

- [ ] **Step 3: Manual end-to-end test**

```bash
cd /Users/eoh/theorex && bun run src/cli/index.ts deliberate --session LDN --date 2026-03-24
```

Verify:
- `data/deliberations/2026-03-24-LDN.json` exists and is valid
- `data/deliberations/2026-03-24-LDN.md` exists and is readable
- Telegram summary is formatted correctly (check stdout)
- Web UI shows the deliberation at `http://127.0.0.1:7777`

- [ ] **Step 4: Commit any fixes**

```bash
cd /Users/eoh/theorex && git add -A && git commit -m "fix: address issues from e2e deliberation test"
```
