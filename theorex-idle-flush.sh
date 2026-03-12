#!/usr/bin/env bash
# theorex-idle-flush.sh — Auto-promote after agent activity goes idle.
# 
# Logic: if an agent's axon was modified in the last WINDOW_SECS but NOT in
# the last IDLE_SECS, that agent just went quiet — push their concepts to shared.
#
# Run every 10 minutes via PM2 cron. Low cost: only promotes agents that were
# actually active. Keeps SHARED_CONTEXT.md fresh without manual intervention.
#
# Tuning:
#   IDLE_SECS=600   — agent is "idle" if no writes for 10 minutes
#   WINDOW_SECS=3600 — only care about activity in the last 1 hour

set -euo pipefail

SCRIPT_REAL="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
THEOREX_DIR="$(cd "$(dirname "$SCRIPT_REAL")" && pwd)"
BUN="$HOME/.bun/bin/bun"
CLI="$THEOREX_DIR/src/cli/index.ts"

IDLE_SECS="${IDLE_SECS:-600}"      # 10 min idle = flush
WINDOW_SECS="${WINDOW_SECS:-3600}" # only check activity in last 1hr
AGENTS="${AGENTS:-main qwen-sage secretarius}"
OPENCLAW="$HOME/.openclaw"

cd "$THEOREX_DIR"

flushed=0

for agent in $AGENTS; do
  axon="$OPENCLAW/agents/$agent/theorex/axon.json"
  [ -f "$axon" ] || continue

  # Get file modification time in seconds since epoch
  mtime=$(stat -f %m "$axon" 2>/dev/null || stat -c %Y "$axon" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$((now - mtime))

  # Was the axon written recently (within WINDOW) but not in the last IDLE_SECS?
  if [ "$age" -ge "$IDLE_SECS" ] && [ "$age" -le "$WINDOW_SECS" ]; then
    echo "[idle-flush] $agent went idle ${age}s ago — promoting..."
    "$BUN" run "$CLI" promote --agent "$agent" 2>&1 | tail -1
    flushed=$((flushed + 1))
  fi
done

if [ "$flushed" -gt 0 ]; then
  echo "[idle-flush] Regenerating boot context..."
  "$BUN" run "$CLI" boot-inject 2>&1 | tail -1
else
  echo "[idle-flush] No idle agents. (checked: $AGENTS)"
fi
