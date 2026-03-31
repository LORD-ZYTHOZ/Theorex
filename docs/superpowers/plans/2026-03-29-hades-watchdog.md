# Hades Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hardware fault detection to Hades (m4 main OC agent) — panic watcher, OC validator, thermal monitor — with a sandbox remediation pipeline reviewed by Sa'kan.

**Architecture:** Shell scripts managed by launchd, state in JSON files with flock locking, thermal data via privileged helper writing to /var/db/hades/, fault events fed into Theorex resilience layer ErrorEvent bus, sandbox fixes reviewed by Sa'kan before deploy.

**Tech Stack:** Bash scripts, launchd plists, jq for JSON, shasum for hashing, flock for locking, Theorex resilience layer (TypeScript/Bun), Sa'kan MCP (sakan_review)

**Spec:** `docs/superpowers/specs/2026-03-29-hades-watchdog-design.md`

---

### Task 1: Directory structure + state schemas

**Files:**
- Create: `~/.openclaw/workspace/watchdog/watchdog-state.json`
- Create: `~/.openclaw/workspace/watchdog/oc-baseline.json`
- Create: `~/.openclaw/workspace/watchdog/lib/common.sh` (shared functions)

- [ ] **Step 1: Create watchdog directory**

```bash
mkdir -p ~/.openclaw/workspace/watchdog/lib
mkdir -p ~/.openclaw/workspace/watchdog/launchd
```

- [ ] **Step 2: Create watchdog-state.json schema**

```json
{
  "schema_version": 1,
  "panic_watcher": {
    "last_processed_uuid": null,
    "last_check_iso": null
  },
  "oc_validator": {
    "last_check_iso": null,
    "last_hash": null,
    "maintenance_mode": false
  },
  "thermal_monitor": {
    "last_check_iso": null,
    "last_alert_iso": null,
    "sustained_fault_start": null
  }
}
```

- [ ] **Step 3: Create oc-baseline.json schema**

Capture current known-good state:
```bash
HASH=$(ioreg -l -p IODeviceTree | shasum -a 256 | cut -d' ' -f1)
```

```json
{
  "schema_version": 1,
  "captured_iso": "2026-03-29T18:00:00+11:00",
  "ioreg_subtree_hash": "<sha256>",
  "maintenance_mode": false,
  "notes": "Initial baseline captured on m4"
}
```

- [ ] **Step 4: Create lib/common.sh — shared utilities**

```bash
#!/usr/bin/env bash
# Shared watchdog utilities — flock, state read/write, Telegram alert

WATCHDOG_DIR="$HOME/.openclaw/workspace/watchdog"
STATE_FILE="$WATCHDOG_DIR/watchdog-state.json"
LOCKFILE="$WATCHDOG_DIR/.watchdog.lock"
TELEGRAM_BOT_TOKEN="${HADES_TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${HADES_TELEGRAM_CHAT_ID:-}"

# Locked state read — returns JSON to stdout
read_state() {
  flock -s "$LOCKFILE" cat "$STATE_FILE"
}

# Locked state write — reads stdin, writes atomically
write_state() {
  local tmp="$STATE_FILE.tmp"
  cat > "$tmp"
  flock "$LOCKFILE" mv "$tmp" "$STATE_FILE"
}

# Update a single jq path in state
update_state() {
  local jq_expr="$1"
  local current
  current=$(read_state)
  echo "$current" | jq "$jq_expr" | write_state
}

# Send Telegram alert
send_telegram() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d parse_mode="Markdown" \
    -d text="${msg}" > /dev/null 2>&1
}

# ISO 8601 timestamp
now_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}
```

- [ ] **Step 5: Test common.sh manually**

```bash
source ~/.openclaw/workspace/watchdog/lib/common.sh
read_state | jq .
update_state '.panic_watcher.last_check_iso = "test"'
read_state | jq .panic_watcher.last_check_iso
# Should output: "test"
# Reset:
update_state '.panic_watcher.last_check_iso = null'
```

---

### Task 2: Panic Watcher

**Files:**
- Create: `~/.openclaw/workspace/watchdog/panic-watcher.sh`
- Create: `~/.openclaw/workspace/watchdog/launchd/com.hades.panic-watcher.plist`

- [ ] **Step 1: Write panic-watcher.sh**

```bash
#!/usr/bin/env bash
# Panic Watcher — runs at boot, checks for new kernel panics
# Content-based detection using panic UUIDs (not mtime)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

PANIC_LOG="/var/db/panic.log"

main() {
  # Exit if no panic log exists
  if [[ ! -f "$PANIC_LOG" ]]; then
    update_state ".panic_watcher.last_check_iso = \"$(now_iso)\""
    exit 0
  fi

  # Extract all panic UUIDs from the log
  # macOS panic logs contain "UUID: <hex-string>" lines
  local current_uuids
  current_uuids=$(grep -oE 'UUID:\s+[A-F0-9-]+' "$PANIC_LOG" 2>/dev/null | tail -1 | awk '{print $2}' || echo "")

  if [[ -z "$current_uuids" ]]; then
    # No UUID found — fall back to content hash
    current_uuids=$(shasum -a 256 "$PANIC_LOG" | cut -d' ' -f1)
  fi

  local last_uuid
  last_uuid=$(read_state | jq -r '.panic_watcher.last_processed_uuid // ""')

  if [[ "$current_uuids" != "$last_uuid" && -n "$current_uuids" ]]; then
    # New panic detected — extract last segment
    local segment
    segment=$(tail -100 "$PANIC_LOG")

    # Alert via Telegram
    send_telegram "🚨 *KERNEL PANIC DETECTED (m4)*

UUID: \`$current_uuids\`

\`\`\`
$(echo "$segment" | head -30)
\`\`\`

_Hades Watchdog — review /var/db/panic.log_"

    # Update state
    update_state ".panic_watcher.last_processed_uuid = \"$current_uuids\" | .panic_watcher.last_check_iso = \"$(now_iso)\""
  else
    update_state ".panic_watcher.last_check_iso = \"$(now_iso)\""
  fi
}

main "$@"
```

- [ ] **Step 2: Write LaunchDaemon plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hades.panic-watcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/eoh/.openclaw/workspace/watchdog/panic-watcher.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/hades-panic-watcher.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/hades-panic-watcher.log</string>
</dict>
</plist>
```

- [ ] **Step 3: Make executable and test**

```bash
chmod +x ~/.openclaw/workspace/watchdog/panic-watcher.sh
# Dry run (should exit clean if no new panics):
bash ~/.openclaw/workspace/watchdog/panic-watcher.sh
read_state | jq .panic_watcher
```

- [ ] **Step 4: Install LaunchAgent (user-level for now, LaunchDaemon needs root)**

```bash
cp ~/.openclaw/workspace/watchdog/launchd/com.hades.panic-watcher.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hades.panic-watcher.plist
```

---

### Task 3: OC Validator

**Files:**
- Create: `~/.openclaw/workspace/watchdog/oc-validator.sh`
- Create: `~/.openclaw/workspace/watchdog/launchd/com.hades.oc-validator.plist`

- [ ] **Step 1: Capture initial OC baseline**

```bash
# Run on m4 to capture known-good state
HASH=$(ioreg -l -p IODeviceTree | shasum -a 256 | cut -d' ' -f1)
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > ~/.openclaw/workspace/watchdog/oc-baseline.json << EOF
{
  "schema_version": 1,
  "captured_iso": "$NOW",
  "ioreg_subtree_hash": "$HASH",
  "maintenance_mode": false,
  "notes": "Initial baseline captured on m4"
}
EOF
```

- [ ] **Step 2: Write oc-validator.sh**

```bash
#!/usr/bin/env bash
# OC Validator — checks OpenCore boot integrity every 30min
# Compares ioreg subtree hash against known-good baseline
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

BASELINE_FILE="$WATCHDOG_DIR/oc-baseline.json"

main() {
  # Check maintenance mode
  local maint
  maint=$(jq -r '.maintenance_mode // false' "$BASELINE_FILE")
  if [[ "$maint" == "true" ]]; then
    update_state ".oc_validator.last_check_iso = \"$(now_iso)\""
    return 0
  fi

  # Current hash
  local current_hash
  current_hash=$(ioreg -l -p IODeviceTree | shasum -a 256 | cut -d' ' -f1)

  # Baseline hash
  local baseline_hash
  baseline_hash=$(jq -r '.ioreg_subtree_hash' "$BASELINE_FILE")

  if [[ "$current_hash" != "$baseline_hash" ]]; then
    send_telegram "⚠️ *OC INTEGRITY MISMATCH (m4)*

Expected: \`${baseline_hash:0:16}...\`
Current:  \`${current_hash:0:16}...\`

Possible causes:
• macOS update reset boot-args
• OC version changed
• kext modification

_If intentional, run:_
\`jq '.maintenance_mode = true' $BASELINE_FILE | sponge $BASELINE_FILE\`

_Hades Watchdog_"

    update_state ".oc_validator.last_check_iso = \"$(now_iso)\" | .oc_validator.last_hash = \"$current_hash\""
  else
    update_state ".oc_validator.last_check_iso = \"$(now_iso)\" | .oc_validator.last_hash = \"$current_hash\""
  fi
}

main "$@"
```

- [ ] **Step 3: Write LaunchAgent plist (30 min interval)**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hades.oc-validator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/eoh/.openclaw/workspace/watchdog/oc-validator.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>ThrottleInterval</key>
    <integer>60</integer>
    <key>StandardOutPath</key>
    <string>/tmp/hades-oc-validator.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/hades-oc-validator.log</string>
</dict>
</plist>
```

- [ ] **Step 4: Make executable and test**

```bash
chmod +x ~/.openclaw/workspace/watchdog/oc-validator.sh
bash ~/.openclaw/workspace/watchdog/oc-validator.sh
read_state | jq .oc_validator
# Should show last_check_iso set, no alert (hashes match)
```

- [ ] **Step 5: Install LaunchAgent**

```bash
cp ~/.openclaw/workspace/watchdog/launchd/com.hades.oc-validator.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hades.oc-validator.plist
```

---

### Task 4: Thermal Monitor (privileged helper + reader)

**Files:**
- Create: `~/.openclaw/workspace/watchdog/thermal-monitor.sh`
- Create: `~/.openclaw/workspace/watchdog/launchd/com.hades.thermal-helper.plist`

- [ ] **Step 1: Create /var/db/hades/ directory (requires sudo)**

```bash
sudo mkdir -p /var/db/hades
sudo chown root:wheel /var/db/hades
sudo chmod 755 /var/db/hades
```

- [ ] **Step 2: Write thermal helper wrapper script**

Create `~/.openclaw/workspace/watchdog/thermal-helper-writer.sh`:

```bash
#!/usr/bin/env bash
# Privileged thermal helper — runs as root via LaunchDaemon
# Writes powermetrics output atomically to /var/db/hades/thermal.log
set -euo pipefail

OUTPUT_DIR="/var/db/hades"
TMP_FILE="$OUTPUT_DIR/thermal.tmp"
LOG_FILE="$OUTPUT_DIR/thermal.log"

umask 022  # Files readable by all, writable by root only

while true; do
  # Sample once (30s), write to tmp, then atomic mv
  powermetrics --samplers cpu_power -i 30000 -n 1 2>/dev/null > "$TMP_FILE" || true
  mv "$TMP_FILE" "$LOG_FILE"
done
```

- [ ] **Step 3: Write LaunchDaemon plist (runs as root)**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hades.thermal-helper</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/eoh/.openclaw/workspace/watchdog/thermal-helper-writer.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>/var/db/hades/thermal-helper.stdout</string>
    <key>StandardErrorPath</key>
    <string>/var/db/hades/thermal-helper.stderr</string>
</dict>
</plist>
```

- [ ] **Step 4: Install LaunchDaemon (requires sudo)**

```bash
sudo cp ~/.openclaw/workspace/watchdog/launchd/com.hades.thermal-helper.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/com.hades.thermal-helper.plist
# Verify it's running:
sudo launchctl list | grep hades
```

- [ ] **Step 5: Write thermal-monitor.sh (unprivileged reader)**

```bash
#!/usr/bin/env bash
# Thermal Monitor — reads privileged helper output, detects scheduling faults
# Alert: E-core residency >90% AND P-core residency <5% AND aggregate CPU <50%
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

THERMAL_LOG="/var/db/hades/thermal.log"
SUSTAINED_THRESHOLD=60  # seconds before alerting

main() {
  if [[ ! -f "$THERMAL_LOG" ]]; then
    # Helper not running yet
    return 0
  fi

  # Parse residency values from powermetrics output
  # Look for cluster residency lines
  local e_residency p_residency cpu_active
  e_residency=$(grep -i 'E-Cluster.*residency' "$THERMAL_LOG" | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "0")
  p_residency=$(grep -i 'P-Cluster.*residency' "$THERMAL_LOG" | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "0")
  cpu_active=$(grep -i 'Combined.*active' "$THERMAL_LOG" | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "0")

  # Check alert condition
  local is_fault=false
  if (( $(echo "$e_residency > 90" | bc -l) )) && \
     (( $(echo "$p_residency < 5" | bc -l) )) && \
     (( $(echo "$cpu_active < 50" | bc -l) )); then
    is_fault=true
  fi

  if [[ "$is_fault" == "true" ]]; then
    # Check if sustained
    local fault_start
    fault_start=$(read_state | jq -r '.thermal_monitor.sustained_fault_start // ""')

    if [[ -z "$fault_start" ]]; then
      # Start tracking
      update_state ".thermal_monitor.sustained_fault_start = \"$(now_iso)\""
    else
      # Check duration
      local start_epoch now_epoch duration
      start_epoch=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$fault_start" +%s 2>/dev/null || echo "0")
      now_epoch=$(date +%s)
      duration=$((now_epoch - start_epoch))

      if (( duration >= SUSTAINED_THRESHOLD )); then
        local last_alert
        last_alert=$(read_state | jq -r '.thermal_monitor.last_alert_iso // ""')

        # Rate limit: don't alert more than once per 10 min
        if [[ -n "$last_alert" ]]; then
          local alert_epoch
          alert_epoch=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$last_alert" +%s 2>/dev/null || echo "0")
          if (( now_epoch - alert_epoch < 600 )); then
            return 0
          fi
        fi

        send_telegram "🌡️ *THERMAL SCHEDULING FAULT (m4)*

E-core residency: ${e_residency}%
P-core residency: ${p_residency}%
Aggregate CPU: ${cpu_active}%
Sustained: ${duration}s

P-cores idle while E-cores saturated — possible scheduling fault.

_Hades Watchdog_"

        update_state ".thermal_monitor.last_alert_iso = \"$(now_iso)\""
      fi
    fi
  else
    # Clear sustained tracking
    update_state ".thermal_monitor.sustained_fault_start = null | .thermal_monitor.last_check_iso = \"$(now_iso)\""
  fi
}

main "$@"
```

- [ ] **Step 6: Make executable and test**

```bash
chmod +x ~/.openclaw/workspace/watchdog/thermal-monitor.sh
chmod +x ~/.openclaw/workspace/watchdog/thermal-helper-writer.sh
# Wait for thermal-helper to produce a log:
ls -la /var/db/hades/thermal.log
# Run reader:
bash ~/.openclaw/workspace/watchdog/thermal-monitor.sh
read_state | jq .thermal_monitor
```

---

### Task 5: Watchdog Report (unified alerting)

**Files:**
- Create: `~/.openclaw/workspace/watchdog/watchdog-report.sh`

- [ ] **Step 1: Write watchdog-report.sh**

```bash
#!/usr/bin/env bash
# Watchdog Report — unified status check, sends summary to Telegram
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

main() {
  local state
  state=$(read_state)

  local panic_check oc_check thermal_check
  panic_check=$(echo "$state" | jq -r '.panic_watcher.last_check_iso // "never"')
  oc_check=$(echo "$state" | jq -r '.oc_validator.last_check_iso // "never"')
  thermal_check=$(echo "$state" | jq -r '.thermal_monitor.last_check_iso // "never"')

  local oc_maint
  oc_maint=$(jq -r '.maintenance_mode // false' "$WATCHDOG_DIR/oc-baseline.json")

  send_telegram "🔍 *Hades Watchdog Status (m4)*

*Panic Watcher:* last check $panic_check
*OC Validator:* last check $oc_check (maint: $oc_maint)
*Thermal Monitor:* last check $thermal_check

_All watchers operational_"
}

main "$@"
```

- [ ] **Step 2: Make executable and test**

```bash
chmod +x ~/.openclaw/workspace/watchdog/watchdog-report.sh
bash ~/.openclaw/workspace/watchdog/watchdog-report.sh
# Should send status summary to Telegram
```

---

### Task 6: Heartbeat loop

**Files:**
- Create: `~/.openclaw/workspace/watchdog/heartbeat.sh`
- Create: `~/.openclaw/workspace/watchdog/launchd/com.hades.heartbeat.plist`

- [ ] **Step 1: Write heartbeat.sh**

```bash
#!/usr/bin/env bash
# Hades Heartbeat — sends pulse to n8n webhook every 60s
# Includes jitter (0-5s) to prevent thundering herd
set -euo pipefail

N8N_WEBHOOK="${HADES_N8N_WEBHOOK:-}"

main() {
  if [[ -z "$N8N_WEBHOOK" ]]; then
    # No webhook configured — skip silently
    return 0
  fi

  # Jitter: random 0-5 second delay
  sleep $((RANDOM % 6))

  local payload
  payload=$(cat <<EOF
{
  "agent": "hades",
  "machine": "m4",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "status": "alive"
}
EOF
)

  curl -s -X POST "$N8N_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null 2>&1 || true
}

main "$@"
```

- [ ] **Step 2: Write LaunchAgent plist (60s interval)**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hades.heartbeat</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/eoh/.openclaw/workspace/watchdog/heartbeat.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>/tmp/hades-heartbeat.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/hades-heartbeat.log</string>
</dict>
</plist>
```

- [ ] **Step 3: Make executable and install**

```bash
chmod +x ~/.openclaw/workspace/watchdog/heartbeat.sh
cp ~/.openclaw/workspace/watchdog/launchd/com.hades.heartbeat.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hades.heartbeat.plist
```

---

### Task 7: Resilience layer bridge

**Files:**
- Create: `src/resilience/watchdog-bridge.ts`
- Test: `src/tests/resilience/watchdog-bridge.test.ts`

This bridges watchdog shell script alerts into the Theorex TypeScript resilience layer.

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/resilience/watchdog-bridge.test.ts
import { test, expect, describe } from "bun:test";
import { parseWatchdogEvent, toErrorEvent } from "../../resilience/watchdog-bridge";

describe("watchdog-bridge", () => {
  test("parses panic event", () => {
    const raw = {
      type: "panic",
      uuid: "ABC-123",
      message: "Kernel panic detected",
      timestamp: "2026-03-29T18:00:00Z",
    };
    const event = parseWatchdogEvent(raw);
    expect(event.type).toBe("panic");
    expect(event.severity).toBe("critical");
  });

  test("parses oc_mismatch event", () => {
    const raw = {
      type: "oc_mismatch",
      expected_hash: "abc123",
      current_hash: "def456",
      timestamp: "2026-03-29T18:00:00Z",
    };
    const event = parseWatchdogEvent(raw);
    expect(event.type).toBe("oc_mismatch");
    expect(event.severity).toBe("critical");
  });

  test("parses thermal event", () => {
    const raw = {
      type: "thermal",
      e_residency: 95,
      p_residency: 2,
      cpu_active: 30,
      duration_s: 120,
      timestamp: "2026-03-29T18:00:00Z",
    };
    const event = parseWatchdogEvent(raw);
    expect(event.type).toBe("thermal");
    expect(event.severity).toBe("high");
  });

  test("converts to ErrorEvent", () => {
    const raw = {
      type: "panic",
      uuid: "ABC-123",
      message: "Kernel panic detected",
      timestamp: "2026-03-29T18:00:00Z",
    };
    const watchdog = parseWatchdogEvent(raw);
    const error = toErrorEvent(watchdog);
    expect(error.service).toBe("watchdog:panic");
    expect(error.severity).toBe("critical");
    expect(error.agent_id).toBe("hades");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/theorex && bun test src/tests/resilience/watchdog-bridge.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

```typescript
// src/resilience/watchdog-bridge.ts
// Bridges watchdog shell events into Theorex ErrorEvent bus.

import type { ErrorEvent, Severity } from "./types";
import { emitError, emitCritical } from "./error-bus";
import { randomUUID } from "crypto";

export interface WatchdogEvent {
  readonly type: "panic" | "oc_mismatch" | "thermal";
  readonly severity: Severity;
  readonly message: string;
  readonly timestamp: string;
  readonly context: Record<string, unknown>;
}

const SEVERITY_MAP: Record<string, Severity> = {
  panic: "critical",
  oc_mismatch: "critical",
  thermal: "high",
} as const;

export function parseWatchdogEvent(raw: Record<string, unknown>): WatchdogEvent {
  const type = raw.type as string;
  const severity = SEVERITY_MAP[type] ?? "medium";
  const timestamp = (raw.timestamp as string) ?? new Date().toISOString();

  return {
    type: type as WatchdogEvent["type"],
    severity,
    message: (raw.message as string) ?? `Watchdog ${type} event`,
    timestamp,
    context: { ...raw },
  };
}

export function toErrorEvent(event: WatchdogEvent): ErrorEvent {
  return {
    id: randomUUID(),
    service: `watchdog:${event.type}`,
    category: "permanent",
    severity: event.severity,
    message: event.message,
    context: event.context,
    timestamp: event.timestamp,
    agent_id: "hades",
  };
}

export function bridgeWatchdogEvent(raw: Record<string, unknown>): void {
  const event = parseWatchdogEvent(raw);
  const errorEvent = toErrorEvent(event);

  emitError(errorEvent);

  if (event.severity === "critical") {
    emitCritical(errorEvent.service, errorEvent.message, "hades", errorEvent.context);
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/theorex && bun test src/tests/resilience/watchdog-bridge.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full resilience test suite to confirm no regressions**

```bash
cd ~/theorex && bun test src/tests/resilience/
```

Expected: All pass (41 existing + new tests)

- [ ] **Step 6: Export from index**

Add to `src/resilience/index.ts`:
```typescript
export { parseWatchdogEvent, toErrorEvent, bridgeWatchdogEvent } from "./watchdog-bridge";
export type { WatchdogEvent } from "./watchdog-bridge";
```

---

### Task 8: End-to-end validation

- [ ] **Step 1: Verify all scripts are executable**

```bash
ls -la ~/.openclaw/workspace/watchdog/*.sh
# All should have +x
```

- [ ] **Step 2: Verify all launchd agents are loaded**

```bash
launchctl list | grep hades
# Should see: com.hades.panic-watcher, com.hades.oc-validator, com.hades.heartbeat
sudo launchctl list | grep hades
# Should see: com.hades.thermal-helper
```

- [ ] **Step 3: Run watchdog report**

```bash
bash ~/.openclaw/workspace/watchdog/watchdog-report.sh
# Should send status summary to Telegram
```

- [ ] **Step 4: Run full Theorex test suite**

```bash
cd ~/theorex && bun test
```

- [ ] **Step 5: Commit**

```bash
cd ~/theorex
git add src/resilience/watchdog-bridge.ts src/tests/resilience/watchdog-bridge.test.ts src/resilience/index.ts
git commit -m "feat: add watchdog bridge to resilience layer"
```

---

### Task 9 (future): Sandbox remediation + Sa'kan review loop

This task is deferred — it requires the fault classifier (Qwen3 integration) which depends on OC agent dispatch being wired up. Build order:

1. Fault classifier script that calls Qwen3 via LM Studio API
2. Sandbox creation via `mktemp -d`
3. Sa'kan review loop via `sakan_review` MCP
4. Approval gate (Telegram interactive)

Document as a follow-up spec when Tasks 1-8 are deployed and stable.
