#!/usr/bin/env bash
# theorex-nightly.sh — Full nightly decay cycle for all agent axons.
#
# Runs at 3am via PM2 cron. Does the heavy work:
#   1. scan-agent: re-score all nodes with compositeScore (recency decays over time,
#      frequency keeps active concepts alive, co-occurrence strengthens related pairs)
#   2. prune: remove LESS-tier nodes older than pruneThresholdDays (default 30 days)
#   3. promote: push qualifying concepts to shared axon
#   4. boot-inject: regenerate SHARED_CONTEXT.md with fresh scores + relative ages
#
# Effect over time:
#   - Concept unseen for 14 days: score halved (halfLifeDays=14)
#   - Concept unseen for 28 days: score quartered → likely LESS tier
#   - Concept unseen for 30+ days: pruned
#   - Concept used frequently: frequency score keeps it ACTIVE despite age

set -euo pipefail

SCRIPT_REAL="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
THEOREX_DIR="$(cd "$(dirname "$SCRIPT_REAL")" && pwd)"
BUN="$HOME/.bun/bin/bun"
CLI="$THEOREX_DIR/src/cli/index.ts"
AGENTS="${AGENTS:-main qwen-sage secretarius}"

cd "$THEOREX_DIR"

echo "=== Theorex nightly decay: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

for agent in $AGENTS; do
  axon="$HOME/.openclaw/agents/$agent/theorex/axon.json"
  [ -f "$axon" ] || continue
  echo "--- $agent"
  "$BUN" run "$CLI" scan-agent --agent "$agent" 2>&1
  "$BUN" run "$CLI" prune-agent --agent "$agent" 2>&1 | tail -1
  "$BUN" run "$CLI" promote --agent "$agent" 2>&1 | tail -1
done

echo "--- Regenerating boot context..."
"$BUN" run "$CLI" boot-inject 2>&1

echo "=== Done ==="
