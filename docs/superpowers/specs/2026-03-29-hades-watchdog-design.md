# Hades Watchdog — Hardware Monitoring + Safe Remediation

**Date:** 2026-03-29
**Status:** Design
**Owner:** Hades (main OC agent, m4)

## Problem

No hardware fault detection exists. OC resets, kernel panics, and thermal scheduling faults go unnoticed until something breaks badly. Failures cascade unobserved across the m4/m1 fleet.

## Solution

Add three monitoring loops to Hades with a sandbox remediation pipeline. Faults are detected, classified, fixed in isolation, reviewed by Sa'kan (GLM-4.7), then deployed through an approval gate.

## Architecture

```
Hades (main OC, m4)
├── Panic Watcher      ─── at-boot check
├── OC Validator       ─── interval check
├── Thermal Monitor    ─── privileged helper + reader
│
└── Fault Pipeline
    detect → classify → sandbox fix → Sa'kan review → gate → deploy
```

## 1. Panic Watcher

Kernel panics halt I/O before the log flushes — live tailing misses the event. Instead, check the log **after reboot**.

- **Mechanism:** LaunchDaemon runs at boot
- **Logic:** Parse `/var/db/panic.log` content, extract panic UUID from each entry. Compare against last-processed UUID stored in `watchdog-state.json`. Resilient to clock skew and log rotation — content-based, not timestamp-based
- **If new UUID found:** Extract panic segment, classify via Hades (Qwen3), alert via Telegram + n8n
- **State file:** `~/.openclaw/workspace/watchdog/watchdog-state.json` (all reads/writes use `flock` to prevent concurrent corruption from multiple watchers running simultaneously)

## 2. OC Validator

Direct `nvram -x -p` is brittle on Apple Silicon. Use `ioreg` instead.

- **Mechanism:** Interval check (every 30 minutes via launchd or cron)
- **Read method:** `ioreg -l -p IODeviceTree` — hash the relevant subtree (SHA-256) rather than parsing raw XML. Compare hash vs baseline hash. Abstracts away formatting changes between macOS versions
- **Baseline:** `oc-baseline.json` with schema version field + subtree hash
- **Maintenance mode:** Boolean flag in baseline — when flipped, suppresses alerts for one cycle (use during intentional OC/macOS updates)
- **Detects:** Boot-arg resets, OC version downgrades, kext signature changes
- **On mismatch:** Alert via Telegram, feed fault event to resilience layer

## 3. Thermal/Efficiency Monitor

`powermetrics` requires root. The agent must never run as root.

- **Privileged helper:** A launchd plist that runs `powermetrics --samplers cpu_power -i 30000` as root with `umask 077`, writes to `/var/db/hades/thermal.tmp` then atomically `mv` to `/var/db/hades/thermal.log`. Directory `/var/db/hades/` is root-owned (0755) with log files at 0644 so the unprivileged agent can read but not write. NOT `/tmp` — world-writable dirs allow data poisoning
- **Reader:** Hades reads `/var/db/hades/thermal.log` (no sudo needed, file is world-readable). Reads are safe — file is only replaced atomically, never written in-place
- **Metric:** CPU residency values (% time threads spend on P vs E clusters)
- **Alert condition:** E-core residency >90% AND P-core residency <5% sustained for >60s, BUT only when aggregate CPU load is <50% (filters out legitimate high-load scenarios like builds where E-core saturation is expected)
- **Sampling:** 30s intervals (not 5s — aggressive polling causes the thermal issues it monitors)
- **Output:** Structured JSON appended to `watchdog-state.json`

## 4. Fault Pipeline

When any watcher detects a fault:

### Classification (Hades/Qwen3)
- **Timeout:** 45s on Qwen3 inference
- **Fallback chain:** Qwen3 → Ministral → skip classification, alert raw fault
- **Categories:** `critical` (panic, OC corruption), `high` (thermal fault), `medium` (minor drift), `info` (no action)

### Sandbox Remediation
- **Workspace:** Created via `mktemp -d /tmp/hades-sandbox.XXXXXX` (secure random suffix, prevents symlink attacks from predictable paths)
- **Hades writes** the fix (scripts, configs) in the sandbox
- **Sa'kan reviews** the fix via `sakan_review` MCP tool
  - Pass → proceed to gate
  - Fail → Hades revises, Sa'kan reviews again (max 3 iterations, 5 minute total timeout)
  - 3 failures OR timeout → escalate to human via Telegram with full context (fault, attempted fixes, review feedback). Do not deploy. Do not block pipeline — other faults can still be processed
- **Atomic deploy:** `mv` within same filesystem — single syscall, crash-safe. Pre-flight check: verify source and dest are on same mount (`df` check) before `mv`. If different filesystems, `cp` + `rm` with verification
- **Sandbox NEVER has write access** to production paths during fix development

### Approval Gate
- **Critical faults:** Telegram message to eoh, require explicit approval before deploy
- **High faults:** Auto-deploy if Sa'kan review passes, notify via Telegram
- **Medium/info:** Log only, no remediation

## 5. Fleet Communication

### Heartbeat
- Hades sends heartbeat to n8n webhook every 60s
- Missed heartbeat detection uses exponential backoff: miss 1 → wait 2min, miss 2 → wait 4min, miss 3 → fault alert. Prevents alert floods from brief network flaps
- Heartbeat includes jitter (0-5s random delay) to avoid thundering herd if multiple agents heartbeat simultaneously

### Alert Pipeline
- All fault events feed into Theorex resilience layer `ErrorEvent` bus
- Telegram alerts for critical/high faults
- Future: Red Pulse / Orphan Node in Theorex 3D viz

## 6. File Structure

```
~/.openclaw/workspace/watchdog/
├── panic-watcher.sh            — at-boot LaunchDaemon script
├── oc-validator.sh             — interval OC integrity check
├── thermal-monitor.sh          — reads privileged helper output
├── watchdog-report.sh          — unified alert → n8n + Telegram
├── watchdog-state.json         — timestamps, thermal history
├── oc-baseline.json            — versioned known-good OC state
└── launchd/
    ├── com.hades.panic-watcher.plist    — all ProgramArguments use absolute paths
    ├── com.hades.oc-validator.plist
    └── com.hades.thermal-helper.plist   — runs as root (LaunchDaemon, not LaunchAgent)
```

## 7. Integration Points

| System | Integration |
|---|---|
| Theorex resilience layer | Fault events → `ErrorEvent` bus, circuit breaker |
| Sa'kan (GLM-4.7) | Code review of sandbox fixes via MCP `sakan_review` |
| Telegram | Alerts for critical/high faults, approval gate |
| n8n | Heartbeat webhook, visual dashboards |
| Theorex 3D (future) | Red Pulse / Orphan Node for hardware faults |

## 8. Non-Goals

- NOT monitoring trading strategies (Singularity/Divergence handle their own)
- NOT cross-machine state sync (m1 has its own agent, Nova)
- NOT auto-fixing critical faults without human approval
- NOT replacing the existing security sweep (complementary)

## 9. Build Order

1. `watchdog-state.json` + `oc-baseline.json` schemas
2. Panic watcher script + LaunchDaemon plist
3. OC validator script + LaunchDaemon plist
4. Thermal privileged helper plist + reader script
5. Fault classifier (Qwen3 with timeout + fallback)
6. Sandbox remediation + Sa'kan review loop
7. Watchdog report (Telegram + n8n alerts)
8. Wire into Theorex resilience layer ErrorEvent bus
9. Heartbeat loop

## 10. Sa'kan Review Log

### Round 1 (4/10) — all applied
- [x] `powermetrics` sudo → privileged launchd helper
- [x] Atomic deploy → `mv` within same filesystem
- [x] Panic log tailing → at-boot check instead
- [x] E-core/P-core math → residency values
- [x] `nvram` brittleness → `ioreg`
- [x] Baseline staleness → schema version + maintenance mode
- [x] LLM timeout → 45s + fallback chain
- [x] Sampling rate → 30s

### Round 2 (7/10) — all applied
- [x] Thermal file race → atomic `mv` rotation (write to .tmp, mv to .log)
- [x] ioreg parsing fragility → hash subtree (SHA-256) instead of raw parsing
- [x] State file locking → `flock` on all watchdog-state.json reads/writes
- [x] 3-iteration deadlock → added 5min total timeout + non-blocking escalation
- [x] Thermal false positives → aggregate CPU load <50% gate added
- [x] Heartbeat alert floods → exponential backoff + jitter
- [x] Hardcoded launchd paths → absolute paths in all ProgramArguments

### Round 3 (7/10) — critical fixes applied
- [x] /tmp thermal data poisoning → moved to root-owned /var/db/hades/ (0755 dir, 0644 files)
- [x] mtime fragility → content-based panic UUID tracking instead of timestamps
- [x] Sandbox path predictability → `mktemp -d` with random suffix
- [x] mv atomicity assumption → pre-flight df check for same-filesystem guarantee
- [ ] OC baseline signing (deferred — implement during build if keychain integration is straightforward)
- [ ] ioreg key specificity (deferred — define exact keys during OC validator implementation)
- [ ] LaunchDaemon KeepAlive/ThrottleInterval keys (deferred — add during plist creation)
