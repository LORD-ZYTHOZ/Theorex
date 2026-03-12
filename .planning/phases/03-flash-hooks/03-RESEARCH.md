# Phase 3: Flash Lobe + Hooks — Research

**Researched:** 2026-03-11
**Domain:** Claude Code Hooks system + per-session ring buffer implementation in Bun/TypeScript
**Confidence:** HIGH (hooks system), MEDIUM (SessionEnd reliability caveat documented)

## Summary

Phase 3 wires Theorex's significance engine and storage modules to Claude Code's lifecycle via project-scoped hooks. The Flash Lobe is a per-session ring buffer (`data/flash/{session-id}.json`) that records every tool use event during a session. Three hooks drive it: PostToolUse writes events asynchronously (non-blocking, under 1ms), SessionEnd flushes significant events (score >= 0.5) to short-term and clears the flash file, and SessionStart injects ACTIVE-tier context into the conversation.

The hooks system is well-documented and stable as of Claude Code 2.1.0+. Project-scoped hooks live in `.claude/settings.json` at the project root and are isolated to sessions started from within that project directory. The `async: true` field on a hook command makes the hook fire without blocking Claude Code's response — ideal for PostToolUse event recording. Shell startup noise (from `~/.zshrc`) is a documented pitfall that corrupts JSON output; the fix is a one-line `if [[ $- == *i* ]]` guard.

**Known risk: SessionEnd hook reliability.** The SessionEnd hook is documented to NOT fire on `/exit` commands (confirmed bug, Issue #17885, closed as not planned). It fires reliably on `Ctrl+D` on macOS. This means flush-on-end is best-effort; the Plan should build an explicit `theorex flush` CLI command as a fallback that users or hooks can call. Since flash is volatile by design (FLH-05), missed flushes are acceptable with appropriate documentation.

**Primary recommendation:** Build a thin shell dispatch script at `.claude/hooks/theorex-hook.sh` that all three hooks invoke via their respective `bun run src/cli/index.ts` subcommands. Never invoke `bun` with a relative path — always use the absolute path from `$CLAUDE_PROJECT_DIR`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun runtime | 1.3.10 (project) | Hook invocation + file I/O | Project CLAUDE.md mandates Bun |
| node:fs/promises | built-in | Atomic temp+rename writes | Same pattern as Phase 1 LTM-04 |
| crypto.randomUUID | built-in | Session-independent flash IDs | No dependency needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jq | system | JSON parsing in bash hook scripts | Parse stdin JSON in shell wrapper |
| Theorex CLI | internal | Flash write / flush / inject subcommands | Called by hook shell scripts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shell wrapper + bun CLI | HTTP hook (type: "http") | HTTP hooks require a running server; shell + bun is zero-infrastructure |
| Per-event file write | Append-only JSONL for flash | JSONL doesn't enforce ring size; JSON array with atomic overwrite enforces the 4,000-token ceiling in code |
| `bun run` in hook | `npx` or `node` | CLAUDE.md requires Bun exclusively |

**Installation:** No new packages required. All existing dependencies (compromise, graphology, wink-bm25-text-search) are already installed.

## Architecture Patterns

### Recommended Project Structure
```
.claude/
├── settings.json              # project-scoped hooks (committed)
├── settings.local.json        # local overrides (gitignored)
└── hooks/
    └── theorex-hook.sh        # thin shell dispatcher (executable)
src/
├── flash/
│   ├── store.ts               # FlashEvent type, ring buffer read/write, token ceiling
│   └── flush.ts               # flush-to-short-term logic (filter >= 0.5, call appendEntry)
└── cli/index.ts               # add flash-write, flash-flush, flash-inject subcommands
data/
└── flash/
    └── {session-id}.json      # volatile per-session ring buffer files
tests/
└── flash/
    ├── store.test.ts          # ring buffer enforcement, atomic write, token ceiling
    └── flush.test.ts          # significance filter, appendEntry integration
```

### Pattern 1: Project-Scoped Hook Configuration
**What:** Hooks defined in `.claude/settings.json` fire ONLY when Claude Code is launched from within the Theorex project directory (or its subdirectories). They do not affect any session outside the project.
**When to use:** HKS-04 requirement — must not affect sessions outside Theorex.

```json
// .claude/settings.json — project-scoped, committed to repo
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/theorex-hook.sh post-tool-use",
            "async": true,
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/theorex-hook.sh session-end",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/theorex-hook.sh session-start",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Pattern 2: Async Non-Blocking Hook for PostToolUse
**What:** `"async": true` on a hook command fires it in the background. Claude Code does not wait for it to complete before continuing. This satisfies HKS-01 (<1ms blocking time).
**When to use:** Any hook that must not delay Claude Code's response — specifically PostToolUse event recording.

```json
{
  "type": "command",
  "command": "...",
  "async": true,
  "timeout": 5
}
```

Note: async hooks cannot influence Claude's behavior (no output read). They are fire-and-forget. For PostToolUse, this is correct — we are recording, not deciding.

### Pattern 3: PostToolUse Hook JSON Input
**What:** When a tool completes, Claude Code sends JSON to the hook's stdin.
**Format (all fields):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf.jsonl",
  "cwd": "/Users/eoh/theorex",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "..."
  },
  "tool_response": {
    "filePath": "/path/to/file.txt",
    "success": true
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

The `session_id` field is the filename key for the flash buffer: `data/flash/{session_id}.json`.

### Pattern 4: SessionStart Context Injection
**What:** For SessionStart hooks, anything written to stdout (plain text or JSON) is added to Claude's context at the start of the conversation. This is the mechanism for HKS-03.
**Format (plain text — simplest, works):**
```bash
echo "=== THEOREX CONTEXT ==="
echo "ACTIVE concepts: TypeScript, bun, graphology"
```

**Format (structured — same effect, more explicit):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "=== THEOREX ACTIVE CONTEXT ===\nTypeScript [ACTIVE/PREFERRED]\n..."
  }
}
```

For cold start (all three lobes empty), the hook must exit 0 with empty/minimal output. No error.

### Pattern 5: Shell Startup Output Suppression
**What:** Hook scripts run in non-interactive shells that source `~/.zshrc` or `~/.bashrc`. Profile `echo` statements corrupt hook JSON output, causing "JSON validation failed" errors.
**Prevention:** Every hook script must start with:
```bash
#!/bin/bash
# Suppress interactive-only shell startup output to prevent JSON corruption
# (hooks run in non-interactive shells that source ~/.zshrc)
```
And instruct users to wrap profile echoes:
```bash
# In ~/.zshrc or ~/.bashrc
if [[ $- == *i* ]]; then
  echo "Shell ready"  # only in interactive shells
fi
```

### Pattern 6: Atomic Flash Buffer Write (Ring Buffer)
**What:** Multiple concurrent Claude Code sessions can write to the same flash file. Use atomic temp+rename pattern (same as Phase 1 LTM-04).
**Implementation:**
```typescript
// In src/flash/store.ts
import { writeFile, rename, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FLASH_DIR = "data/flash";
const MAX_EVENTS = 50;  // FLH-01: ring buffer of last 50 events
const TOKEN_CEILING = 4000;  // FLH-03: hard ceiling

async function atomicWriteFlash(sessionId: string, events: FlashEvent[]): Promise<void> {
  await mkdir(FLASH_DIR, { recursive: true });
  const flashPath = join(FLASH_DIR, `${sessionId}.json`);
  const tmp = join(tmpdir(), `theorex-flash-${sessionId}-${Date.now()}.json`);
  await writeFile(tmp, JSON.stringify({ session_id: sessionId, events }, null, 2));
  await rename(tmp, flashPath);  // atomic on same filesystem
}
```

### Pattern 7: Token Ceiling Enforcement
**What:** The 4,000-token ceiling (FLH-03) must be enforced in code, not by convention. Use character-based approximation (1 token ≈ 4 chars in English) as the fast check before inserting each event.
**Logic:**
```typescript
function estimateTokens(events: FlashEvent[]): number {
  return Math.ceil(JSON.stringify(events).length / 4);
}

function enforceTokenCeiling(events: FlashEvent[], incoming: FlashEvent): FlashEvent[] {
  const candidate = [...events, incoming];
  // First: trim to max 50 events (ring buffer)
  const trimmed = candidate.slice(-MAX_EVENTS);
  // Then: trim oldest events until under token ceiling
  while (estimateTokens(trimmed) > TOKEN_CEILING && trimmed.length > 0) {
    trimmed.shift();
  }
  return trimmed;
}
```

### Pattern 8: Project Directory Detection in Hook Script
**What:** The hook script must exit 0 without writing when invoked outside the Theorex project directory (HKS-04). Since hooks in `.claude/settings.json` are project-scoped, they will only fire when Claude Code is run from within the Theorex project directory — the project-scoping handles HKS-04 automatically.
**Belt-and-suspenders check in the shell script:**
```bash
#!/bin/bash
# Belt-and-suspenders: verify we are in the Theorex project
if [ ! -f "$CLAUDE_PROJECT_DIR/package.json" ] || ! grep -q '"name": "theorex"' "$CLAUDE_PROJECT_DIR/package.json" 2>/dev/null; then
  exit 0  # not the theorex project, do nothing
fi
```

### Pattern 9: Bun Invocation from Hook
**What:** Hooks must use the absolute path to `bun` since PATH in non-interactive shells may not include `/Users/eoh/.bun/bin`. Use `$CLAUDE_PROJECT_DIR` for the project path.
```bash
#!/bin/bash
export PATH="/Users/eoh/.bun/bin:$PATH"
BUN="$HOME/.bun/bin/bun"
PROJECT="$CLAUDE_PROJECT_DIR"
INPUT=$(cat)  # read stdin JSON

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

case "$1" in
  post-tool-use)
    echo "$INPUT" | "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-write --session "$SESSION_ID" &
    ;;
  session-end)
    "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-flush --session "$SESSION_ID"
    ;;
  session-start)
    "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-inject --session "$SESSION_ID"
    ;;
esac
exit 0
```

Note: For `post-tool-use`, run with `&` to truly detach (belt-and-suspenders alongside `async: true`).

### Anti-Patterns to Avoid
- **Relative `bun` path:** `bun run ...` fails if `~/.bun/bin` is not in the non-interactive shell PATH. Always use `$HOME/.bun/bin/bun` absolute path.
- **`jq` not installed:** Some systems lack `jq`. Check in pre-flight; document it as a dependency.
- **Relying solely on SessionEnd for flush:** Known bug — SessionEnd does not fire on `/exit`. Build `theorex flush` as an explicit CLI fallback.
- **Sync flash writes blocking PostToolUse:** PostToolUse with async:true fires in background; the CLI command itself must use async I/O and not block. Bun's file I/O is async by default.
- **Flash file on remote/networked filesystem:** `rename()` is only atomic on the same filesystem. `data/flash/` must be local.
- **Writing stderr in async PostToolUse hook:** In async mode, stderr output is not shown. Errors are silently dropped. Log to a dedicated error file if debugging is needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom tokenizer | Character-count approximation (length/4) | Claude Code doesn't expose token counts to hooks; approximation is sufficient for a 4,000-token ceiling check |
| Hook discovery | Custom hook runner | Claude Code's native `.claude/settings.json` | Built-in, project-scoped, no extra infrastructure |
| Concurrent file locking | flock / file lock | Atomic temp+rename | Already proven in Phase 1 (LTM-04); rename is atomic on same filesystem |
| Hook process management | Daemon/server | `async: true` + shell `&` | Claude Code handles async hook lifecycle |

**Key insight:** The hooks system is the integration surface. Theorex provides the Bun CLI subcommands (`flash-write`, `flash-flush`, `flash-inject`). The hook shell script is glue only — no business logic there.

## Common Pitfalls

### Pitfall 1: SessionEnd Does Not Fire on `/exit`
**What goes wrong:** `theorex flush` (via SessionEnd hook) never runs when users type `/exit`. Events from the session are not promoted to short-term.
**Why it happens:** Confirmed Claude Code bug (Issue #17885, closed as not planned as of 2025). SessionEnd fires on `Ctrl+D` on macOS but not on the `/exit` slash command.
**How to avoid:** Add `theorex flush` as an explicit CLI command users can run manually. Document the `/exit` limitation in CLAUDE.md. Consider a Stop hook as a backup trigger (Stop fires whenever Claude finishes a response — not ideal but more reliable than SessionEnd).
**Warning signs:** Flash files accumulate in `data/flash/` without being cleared.

### Pitfall 2: Shell Profile Corrupts Hook JSON Output
**What goes wrong:** SessionStart hook returns output like `"Shell ready on arm64\n{json...}"` which Claude Code fails to parse. Hook throws "JSON validation failed" error.
**Why it happens:** Hook scripts run in non-interactive shells that still source `~/.zshrc`. Unconditional `echo` in profiles prepends text to hook stdout.
**How to avoid:** Wrap profile echoes with `if [[ $- == *i* ]]; then`. Document this requirement for all developers using the hooks.
**Warning signs:** Hook works in testing but fails when launched from Claude Code.

### Pitfall 3: Bun Not Found in Hook PATH
**What goes wrong:** Hook script runs `bun run ...`, gets `command not found`, exits with non-zero code, PostToolUse block appears in Claude Code output.
**Why it happens:** Non-interactive shells don't source `~/.zshrc` where `~/.bun/bin` is typically added to PATH.
**How to avoid:** Always use absolute path `$HOME/.bun/bin/bun` in hook scripts. Add `export PATH="$HOME/.bun/bin:$PATH"` as first line in the hook script.
**Warning signs:** Hook works in terminal (`which bun` succeeds) but not from Claude Code.

### Pitfall 4: Race Condition on Concurrent Sessions
**What goes wrong:** Two concurrent Claude Code sessions writing to the same `data/flash/{session-id}.json` produce truncated/invalid JSON.
**Why it happens:** Without atomic writes, a read-modify-write cycle is not safe under concurrency.
**How to avoid:** Use temp file + `rename()` pattern (same as Phase 1 LTM-04). Each session has its OWN file keyed by `session_id`, so cross-session races are impossible. Intra-session races (multiple PostToolUse hooks firing in rapid succession for the same session) are the only real risk; `async: true` means multiple invocations can overlap.
**Warning signs:** `data/flash/{session-id}.json` contains truncated JSON.

### Pitfall 5: Token Ceiling Exceeded by Large tool_response
**What goes wrong:** A single `Read` or `Bash` tool response with thousands of lines gets stored in the flash buffer, pushing total tokens over 4,000.
**Why it happens:** Flash stores full tool_response content without truncation.
**How to avoid:** Truncate `tool_response.content` (or `tool_response.stdout`) to a max of ~500 chars when building the FlashEvent. The raw response is not needed — only the metadata (tool_name, file_path, first N chars of output) is useful for context injection.
**Warning signs:** Flash buffer fills with a single event and older events are aggressively evicted.

### Pitfall 6: Cold Start Injection Fails
**What goes wrong:** SessionStart hook fails with an error when all three lobes are empty (first ever session).
**Why it happens:** Code tries to read non-existent `data/axon.json`, empty `data/short-term/`, and non-existent flash file — crashes instead of returning empty context.
**How to avoid:** All three lobe readers must handle "not found" gracefully (same pattern as Phase 1 AxonStore.load). SessionStart hook must always exit 0 even with empty output.
**Warning signs:** First session after fresh install throws hook errors.

## Code Examples

### FlashEvent Type
```typescript
// src/flash/store.ts
export interface FlashEvent {
  readonly tool_name: string;         // from hook stdin .tool_name
  readonly tool_input: Record<string, unknown>;  // truncated version
  readonly tool_response_preview: string;        // first 500 chars of response
  readonly timestamp: string;         // ISO 8601
  readonly significance_score: number; // computed by significance engine
}

export interface FlashBuffer {
  readonly session_id: string;
  readonly events: readonly FlashEvent[];
}
```

### Hook Shell Dispatcher
```bash
#!/bin/bash
# .claude/hooks/theorex-hook.sh
# Thin dispatcher for all Theorex hooks.
# INVARIANT: Always exits 0 — never blocks Claude Code.

# Suppress any interactive shell output that might corrupt JSON
set +x  # no debug output

# Absolute Bun path (non-interactive shells don't have ~/.bun/bin in PATH)
BUN="$HOME/.bun/bin/bun"
PROJECT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Verify this is the Theorex project (belt-and-suspenders beyond project-scoping)
if [ ! -f "$PROJECT/package.json" ] || ! grep -q '"name": "theorex"' "$PROJECT/package.json" 2>/dev/null; then
  exit 0
fi

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")

case "${1:-}" in
  post-tool-use)
    # Fire and forget — async:true in settings.json already detaches;
    # run with & as belt-and-suspenders
    printf '%s' "$INPUT" | "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-write \
      --session "$SESSION_ID" > /dev/null 2>&1 &
    ;;
  session-end)
    "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-flush \
      --session "$SESSION_ID" > /dev/null 2>&1
    ;;
  session-start)
    # stdout goes to Claude's context
    "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-inject \
      --session "$SESSION_ID" 2>/dev/null
    ;;
  *)
    exit 0
    ;;
esac

exit 0
```

### CLI Subcommand Pattern (following Phase 1 pattern)
```typescript
// Extension to src/cli/index.ts
// Flash subcommands follow same export-handler pattern as scan/status/ref/prune

export async function runFlashWrite(sessionId: string, input: unknown): Promise<void> {
  // parse input JSON, build FlashEvent, write to ring buffer
}

export async function runFlashFlush(sessionId: string): Promise<void> {
  // read flash buffer, filter >= 0.5, write to short-term, clear flash
}

export async function runFlashInject(sessionId: string): Promise<void> {
  // read ACTIVE-tier nodes from axon, recent short-term, flash buffer
  // print formatted context to stdout (Claude reads it)
}
```

### Significance Score for Flash Events
```typescript
// Use existing significance engine from Phase 0
// processText(toolContent) → ConceptEvent[] → take max composite_score as event score
// Source weight for Claude-generated events: 1.0

import { processText } from "../compose.ts";

async function scoreFlashEvent(toolName: string, content: string): Promise<number> {
  if (!content || content.trim().length < 10) return 0;
  const events = await processText({
    text: content.slice(0, 2000),  // don't process huge responses
    sourceWeight: 1.0,
    nodeType: "concept",
    timestamp: new Date().toISOString(),
  });
  if (events.length === 0) return 0;
  return Math.max(...events.map(e => e.composite_score));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PostToolUse blocks Claude | `async: true` non-blocking hooks | Claude Code 2.1.0+ | PostToolUse recording no longer delays responses |
| Global `~/.claude/settings.json` hooks only | Project-scoped `.claude/settings.json` | Stable feature | HKS-04 project isolation is natively supported |
| No context injection | SessionStart stdout → Claude context | Stable feature | HKS-03 ACTIVE-tier injection is first-class |

**Deprecated/outdated:**
- SessionEnd via `/exit` command: fires only on `Ctrl+D` on macOS; `/exit` command is a confirmed bug that is closed as not planned.

## Open Questions

1. **SessionEnd firing on `/exit`**
   - What we know: Known bug (Issue #17885), closed as not planned, affects all platforms differently (macOS: works on Ctrl+D, Windows: no reliable exit)
   - What's unclear: Whether a future Claude Code version will fix this
   - Recommendation: Build `theorex flush` as explicit CLI subcommand; document `/exit` limitation; optionally add a Stop hook as backup (fires on every stop event, not just session end — would cause multiple flushes per session but is idempotent if flash is cleared after each flush)

2. **`jq` availability on all development machines**
   - What we know: `jq` is required to parse stdin JSON in bash; it's available via `brew install jq` on macOS but not universally installed
   - What's unclear: Whether the hook script should use Python/node instead of jq for portability
   - Recommendation: Use `jq` (standard for Claude Code hook examples per official docs); document as a prerequisite; add a check at the top of the hook script that falls back to `exit 0` if `jq` is missing

3. **Per-session flash file cleanup for abandoned sessions**
   - What we know: If SessionEnd fails (e.g., `/exit` bug), `data/flash/{session-id}.json` is never cleared
   - What's unclear: How to garbage-collect stale flash files
   - Recommendation: Add a cleanup step in `rotateStm` (Phase 2) or a new housekeeping function that deletes flash files older than 1 day; flash is volatile by design (FLH-05)

## Validation Architecture

Config `workflow.nyquist_validation` is not present in `.planning/config.json` — falling back to standard test verification using `bun test`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none — bun test auto-discovers `*.test.ts` |
| Quick run command | `bun test tests/flash/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLH-01 | Ring buffer capped at 50 events | unit | `bun test tests/flash/store.test.ts` | ❌ Wave 0 |
| FLH-02 | Atomic write: temp+rename, safe for concurrent sessions | unit | `bun test tests/flash/store.test.ts` | ❌ Wave 0 |
| FLH-03 | Token ceiling enforced at 4,000 — hard code check | unit | `bun test tests/flash/store.test.ts` | ❌ Wave 0 |
| FLH-04 | Events >= 0.5 written to short-term on session end | unit | `bun test tests/flash/flush.test.ts` | ❌ Wave 0 |
| FLH-05 | Flash file cleared after flush | unit | `bun test tests/flash/flush.test.ts` | ❌ Wave 0 |
| HKS-01 | PostToolUse async:true — hook exits before response | manual-only | Verified by inspecting `.claude/settings.json` async field | N/A |
| HKS-02 | SessionEnd flushes flash to short-term | integration | `bun test tests/flash/flush.test.ts` | ❌ Wave 0 |
| HKS-03 | SessionStart injects ACTIVE context; works when empty | unit | `bun test tests/flash/inject.test.ts` | ❌ Wave 0 |
| HKS-04 | Outside-Theorex sessions: no writes, exit 0 | manual-only | Test hook script with mock stdin from outside project dir | N/A |
| HKS-05 | Shell startup output suppressed | manual-only | Verify `if [[ $- == *i* ]]` guard in hook script | N/A |
| HKS-06 | Existing `~/.claude/` hooks preserved | manual-only | Verify no writes to `~/.claude/settings.json` | N/A |

### Sampling Rate
- **Per task commit:** `bun test tests/flash/`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green + manual HKS-01/04/05/06 verification before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/flash/store.test.ts` — covers FLH-01, FLH-02, FLH-03
- [ ] `tests/flash/flush.test.ts` — covers FLH-04, FLH-05, HKS-02
- [ ] `tests/flash/inject.test.ts` — covers HKS-03 cold-start behavior
- [ ] `src/flash/store.ts` — FlashEvent type + ring buffer read/write + token ceiling
- [ ] `src/flash/flush.ts` — significance filter + appendEntry integration
- [ ] `.claude/settings.json` — three hook registrations
- [ ] `.claude/hooks/theorex-hook.sh` — shell dispatcher (chmod +x required)

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FLH-01 | Per-session ring buffer of last 50 events at data/flash/{session-id}.json | session_id from hook stdin JSON; ring buffer enforced by slicing array on write |
| FLH-02 | Flash buffer atomic write (temp file + rename) — safe for concurrent sessions | Rename atomic on same filesystem; proven pattern from Phase 1 LTM-04 |
| FLH-03 | Flash token ceiling 2,000–4,000 tokens enforced in code, not guideline | Character-count approximation (length/4); enforced before/after each ring buffer write |
| FLH-04 | On session end, events >= 0.5 significance written to short-term | Significance engine (Phase 0) reused; appendEntry (Phase 2) provides write target |
| FLH-05 | Flash clears at session end — volatile by design | Flash file deleted or set to empty events array after flush |
| HKS-01 | PostToolUse hook records to flash buffer (async: true — non-blocking) | async:true in hook command config; shell & detach as belt-and-suspenders |
| HKS-02 | SessionEnd hook flushes flash to short-term and triggers significance scoring | SessionEnd hook calls flash-flush CLI subcommand; caveat: /exit bug — must document fallback |
| HKS-03 | SessionStart hook injects relevant context from all three lobes | SessionStart stdout → Claude context; plain text or hookSpecificOutput.additionalContext JSON |
| HKS-04 | All hooks are project-scoped — do not affect sessions outside Theorex | .claude/settings.json (project root) provides native scoping; belt-and-suspenders package.json check in shell script |
| HKS-05 | Hooks suppress shell startup output to prevent JSON corruption | if [[ $- == *i* ]] guard in ~/.zshrc; hook script redirects own output carefully |
| HKS-06 | Hooks are additive — existing ~/.claude/ hooks preserved and unmodified | Hooks written to .claude/settings.json ONLY; never touch ~/.claude/settings.json |
</phase_requirements>

## Sources

### Primary (HIGH confidence)
- https://code.claude.com/docs/en/hooks — Full hooks reference (official Anthropic docs, fetched 2026-03-11)
- https://code.claude.com/docs/en/hooks-guide — Hooks guide with examples (official Anthropic docs, fetched 2026-03-11)
- Project REQUIREMENTS.md — Phase 3 requirements (FLH-01 through HKS-06)
- Project STATE.md — Accumulated decisions from Phases 0-2
- Project CLAUDE.md — Bun-only mandate, project conventions

### Secondary (MEDIUM confidence)
- https://github.com/anthropics/claude-code/issues/17885 — SessionEnd hook /exit bug (confirmed, closed not planned)
- https://github.com/anthropics/claude-code/issues/4809 — PostToolUse exit code behavior (verified: exit 0 allows, exit 2 blocks, exit 1/3 blocks despite docs)
- https://gist.github.com/FrancisBourre/50dca37124ecc43eaf08328cdcccdb34 — Claude Code hook schemas reference
- https://claudefa.st/blog/tools/hooks/session-lifecycle-hooks — Session hook schemas with examples
- https://dev.to/lukaszfryc/claude-code-hooks-complete-guide-with-20-ready-to-use-examples-2026-dcg — async:true behavior, shell startup suppression

### Tertiary (LOW confidence — flag for validation)
- GitHub Issue #10367 — Subdirectory hook firing bug (v2.0.27): hooks may not fire when Claude Code starts from a subdirectory. Validate that hooks fire correctly when started from project root.
- GitHub Issue #8810 — UserPromptSubmit hooks not working from subdirectories: may affect SessionStart in some versions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Bun mandated by CLAUDE.md; all hook APIs verified from official docs
- Architecture: HIGH — Hook JSON schemas and async:true verified from official docs and GitHub issues
- SessionEnd reliability: MEDIUM — Bug confirmed (Issue #17885) but workaround documented
- Pitfalls: HIGH — Shell startup noise, PATH issues, atomic write pattern all verified from multiple sources
- Token ceiling pattern: MEDIUM — No official hook-specific token counting API; approximation approach verified as the standard workaround

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (hooks API stable; re-validate SessionEnd bug status before Phase 3 execution)
