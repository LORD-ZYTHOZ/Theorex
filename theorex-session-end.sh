#!/usr/bin/env bash
# theorex-session-end.sh — Run after an AI agent session to update shared memory.
# Usage: theorex-session-end <agent-id> ["session summary text"]
#
# Steps: synthesize (if summary given) → promote → boot-inject

set -euo pipefail

# Resolve real script path even when called via symlink
SCRIPT_REAL="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
THEOREX_DIR="$(cd "$(dirname "$SCRIPT_REAL")" && pwd)"
BUN="$HOME/.bun/bin/bun"
CLI="$THEOREX_DIR/src/cli/index.ts"

AGENT="${1:-}"
SUMMARY="${2:-}"

if [[ -z "$AGENT" ]]; then
  echo "Usage: theorex-session-end <agent-id> [\"session summary\"]"
  echo "Agents: claude-code-agent, main, qwen-sage, secretarius"
  exit 1
fi

cd "$THEOREX_DIR"

echo "=== Theorex session-end: $AGENT ==="

if [[ -n "$SUMMARY" ]]; then
  echo "--- Synthesizing..."
  "$BUN" run "$CLI" synthesize --agent "$AGENT" "$SUMMARY"
fi

echo "--- Promoting to shared..."
"$BUN" run "$CLI" promote --agent "$AGENT"

echo "--- Regenerating boot context..."
"$BUN" run "$CLI" boot-inject

echo "=== Done ==="
