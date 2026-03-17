#!/bin/bash
# .claude/hooks/theorex-hook.sh
# Thin dispatcher for all Theorex Claude Code hooks.
#
# INVARIANT: Always exits 0 — never blocks Claude Code.
# HKS-04: Project-scoped via .claude/settings.json; belt-and-suspenders check below.
# HKS-05: set +x suppresses debug output; redirects prevent stdout contamination.
# HKS-06: Never touches ~/.claude/ — only reads/writes within $CLAUDE_PROJECT_DIR.
#
# PREREQUISITE: jq must be installed (brew install jq on macOS).
# Shell startup output: wrap ~/.zshrc echoes with: if [[ $- == *i* ]]; then ... fi

set +x   # no xtrace debug output

# Absolute Bun path — non-interactive shells lack ~/.bun/bin in PATH (HKS-05 / Pitfall 3)
BUN="$HOME/.bun/bin/bun"
PROJECT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Belt-and-suspenders: verify this is the Theorex project (HKS-04)
# Project-scoping in settings.json already handles isolation natively;
# this prevents any edge case where hooks fire from a subdirectory.
if [ ! -f "$PROJECT/package.json" ] || ! grep -q '"name": "theorex"' "$PROJECT/package.json" 2>/dev/null; then
  exit 0
fi

# Verify bun is available
if [ ! -x "$BUN" ]; then
  exit 0  # bun not found — silent exit
fi

# Read stdin (hook input JSON)
INPUT=$(cat)
# Parse session_id — fall back to "unknown" if jq missing or field absent
if command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
else
  SESSION_ID="unknown"
fi

case "${1:-}" in
  post-tool-use)
    # Fire and forget — async:true in settings.json already detaches;
    # & as belt-and-suspenders to ensure non-blocking (HKS-01)
    printf '%s' "$INPUT" | "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-write \
      --session "$SESSION_ID" > /dev/null 2>&1 &
    ;;

  context-monitor)
    # Phase 15: Check context usage — outputs additionalContext JSON to stdout if compression fires.
    # Called synchronously so the response reaches Claude before the next message.
    "$BUN" run --cwd "$PROJECT" src/cli/index.ts context-monitor \
      --session "$SESSION_ID" 2>/dev/null
    ;;

  session-end)
    # Blocking flush — must complete before Claude Code exits (HKS-02)
    # NOTE: This hook does NOT fire on /exit (known bug #17885 — use `theorex flush` manually)
    "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-flush \
      --session "$SESSION_ID" > /dev/null 2>&1
    ;;

  session-start)
    # Stdout injected into Claude's context (HKS-03)
    # Only stdout goes to Claude; stderr is suppressed to avoid JSON contamination (HKS-05)
    "$BUN" run --cwd "$PROJECT" src/cli/index.ts flash-inject \
      --session "$SESSION_ID" 2>/dev/null
    ;;

  *)
    exit 0
    ;;
esac

exit 0
