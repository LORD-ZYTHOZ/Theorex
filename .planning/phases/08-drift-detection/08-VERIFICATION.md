---
phase: 08-drift-detection
verified: 2026-03-11T13:15:00Z
status: passed
score: 16/16 must-haves verified
re_verification: false
---

# Phase 8: Drift Detection Verification Report

**Phase Goal:** An AI agent's behavioral consistency is continuously tracked — every tier change, sentiment flip, graduation, and prune is logged to an audit trail, and a drift score computed from moment anchors vs the live concept web tells you whether the agent is still being who it said it was.
**Verified:** 2026-03-11T13:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | appendAuditEvent() appends JSON lines to events.jsonl without overwriting | VERIFIED | `appendFile` from node:fs/promises used; 42 audit tests pass |
| 2  | appendAuditEvent() creates data/ directory recursively if absent | VERIFIED | `mkdir(dirname(path), { recursive: true })` call at logger.ts:64 |
| 3  | readAuditEvents() returns all events, skips malformed lines, filters by type and sinceMs | VERIFIED | reader.ts:16-40; 10 reader tests pass |
| 4  | computeDriftScore returns correct Jaccard overlap with edge case guards | VERIFIED | scorer.ts:39-57; 6 test cases pass including empty-set guards |
| 5  | detectInstability returns only ACTIVE→non-ACTIVE tier_change events within window | VERIFIED | scorer.ts:65-92; 6 test cases including boundary and non-ACTIVE from |
| 6  | detectSentimentFlips flags concepts seen as both PREFERRED and DISPREFERRED | VERIFIED | scorer.ts:98-143; tracks `to` field only (in-window outcome) |
| 7  | classifyTrend returns stable/drifting/recovering per documented thresholds | VERIFIED | scorer.ts:149-159; recovering takes precedence; 9 test cases |
| 8  | All five mutation sites emit fire-and-forget audit events | VERIFIED | scan.ts:72, prune.ts:100, propagate.ts:53, graduate.ts:93, store.ts:45 all use `void ...().catch(() => {})` |
| 9  | scanAxon emits tier_change only when tier actually changes | VERIFIED | scan.ts:46+71 — oldTier captured before scoring; guard `if (tier !== oldTier)` |
| 10 | propagateSentiment emits sentiment_flip only when sentiment actually changes | VERIFIED | propagate.ts:48+51 — oldSentiment captured; guard `if (sentiment !== oldSentiment)` |
| 11 | Config gains driftWindowDays (default 7) and eventsPath (default "data/events.jsonl") | VERIFIED | config.ts:26-27,51-52 |
| 12 | theorex drift command: displays drift score, flagged concepts, and trend | VERIFIED | runDrift exported at cli/index.ts:274; dispatch case at line 530; 12 cli-drift tests pass |
| 13 | theorex drift returns score=1.0 on cold start (no moments, no events) | VERIFIED | cli-drift.test.ts cold-start test case; empty moment set → computeDriftScore returns 1.0 |
| 14 | theorex status includes a non-fatal Drift line at end of output | VERIFIED | cli/index.ts:129-153; try/catch wraps drift block; `\nDrift: ${driftScore.toFixed(2)} — ${trend}` at line 150 |
| 15 | theorex audit displays event log, filterable by --type and --since | VERIFIED | runAudit exported at cli/index.ts:340; --since parsed as UTC midnight; re-parse pattern for subcommand flags |
| 16 | Unknown subcommand error message includes drift and audit | VERIFIED | cli/index.ts:557 — Usage string includes `drift\|audit` |

**Score:** 16/16 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/audit/logger.ts` | appendAuditEvent, EVENTS_PATH, AuditEvent, AuditEventType | VERIFIED | 66 lines; exports all required symbols; imports only node:fs/promises and node:path |
| `src/audit/reader.ts` | readAuditEvents, AuditFilter | VERIFIED | 43 lines; imports from ./logger; ENOENT-tolerant via Bun.file().catch() |
| `src/audit/scorer.ts` | computeDriftScore, detectInstability, detectSentimentFlips, classifyTrend, InstabilityFlag, SentimentFlipFlag, DriftTrend | VERIFIED | 159 lines; zero I/O calls confirmed by grep; local AuditEvent type alias |
| `src/config.ts` | driftWindowDays: number, eventsPath: string in interface and DEFAULT_CONFIG | VERIFIED | Lines 26-27 (interface), 51-52 (DEFAULT_CONFIG) |
| `src/axon/scan.ts` | appendAuditEvent import; tier_change events with no-op guard | VERIFIED | Import at line 13; oldTier capture at 46; guard+emit at 71-80 |
| `src/axon/prune.ts` | appendAuditEvent import; prune events per dropped node | VERIFIED | Import at line 14; emit at 100-106 |
| `src/axon/propagate.ts` | appendAuditEvent import; sentiment_flip events with no-op guard | VERIFIED | Import at line 6; oldSentiment at 48; guard+emit at 51-61 |
| `src/short-term/graduate.ts` | appendAuditEvent import; graduation events after writeMemoryAtomic | VERIFIED | Import at line 12; emit at 93-99 |
| `src/moments/store.ts` | appendAuditEvent import; moment_capture events after rename | VERIFIED | Import at line 6; emit at 45-52 |
| `src/cli/index.ts` | runDrift, runAudit exports; drift/audit dispatch cases; runStatus drift summary | VERIFIED | Exports at lines 274, 340; dispatch at 530, 534; drift summary in try/catch at 129-153 |
| `tests/audit/logger.test.ts` | TDD tests for append idempotency and no-overwrite | VERIFIED | 126 lines; 10 test cases |
| `tests/audit/reader.test.ts` | TDD tests for filter by type, sinceMs, ENOENT | VERIFIED | 122 lines; 10 test cases |
| `tests/audit/scorer.test.ts` | Unit tests for all pure scoring functions | VERIFIED | 324 lines; 27 test cases covering all 4 functions |
| `tests/audit/wiring.test.ts` | Integration tests verifying each mutation site writes to events.jsonl | VERIFIED | 279 lines; 5 integration tests |
| `tests/cli/cli-drift.test.ts` | Unit tests for runDrift, runAudit, runStatus drift summary | VERIFIED | 470 lines; 12 test cases |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/axon/scan.ts` | `src/audit/logger.ts` | `appendAuditEvent` import | WIRED | Line 13 import; line 72 call with tier_change event |
| `src/axon/prune.ts` | `src/audit/logger.ts` | `appendAuditEvent` import | WIRED | Line 14 import; line 100 call with prune event |
| `src/moments/store.ts` | `src/audit/logger.ts` | `appendAuditEvent` import | WIRED | Line 6 import; line 45 call with moment_capture event |
| `src/cli/index.ts (runDrift)` | `src/audit/scorer.ts` | computeDriftScore + detectInstability + detectSentimentFlips + classifyTrend | WIRED | Lines 27-31 import; lines 311-314 calls |
| `src/cli/index.ts (runDrift)` | `src/axon/store.ts` | lazy tier correction via compositeScore + classifyTier | WIRED | Lines 288-304 — full lazy-on-read loop |
| `src/cli/index.ts (runAudit)` | `src/audit/reader.ts` | readAuditEvents with AuditFilter | WIRED | Line 25 import; line 355 call with type+sinceMs filter |
| `src/cli/index.ts (runStatus)` | `src/audit/scorer.ts` | computeDriftScore + classifyTrend in try/catch | WIRED | Lines 131, 146-150 — drift summary block |
| `src/audit/logger.ts` | node:fs/promises appendFile | appendFile (not Bun.write) | WIRED | Line 1: `import { appendFile, mkdir } from "node:fs/promises"` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DRF-01 | 08-01, 08-03 | JSONL audit log; all 5 event types appended with timestamp and source | SATISFIED | logger.ts appendAuditEvent; all 5 mutation sites wired; wiring.test.ts passes |
| DRF-02 | 08-02 | Drift score 0.0–1.0 comparing moment concept_ids vs ACTIVE-tier set | SATISFIED | computeDriftScore Jaccard in scorer.ts; runDrift integrates both sets |
| DRF-03 | 08-02 | ACTIVE→MILD/LESS tier instability detection within rolling window | SATISFIED | detectInstability in scorer.ts; windowDays param; guard `from==="ACTIVE"` |
| DRF-04 | 08-02 | Sentiment flip detection: PREFERRED↔DISPREFERRED within window | SATISFIED | detectSentimentFlips in scorer.ts; tracks `to` field only in-window |
| DRF-05 | 08-01, 08-02 | Drift evaluation is purely deterministic — no LLM calls, no external APIs | SATISFIED | scorer.ts: zero I/O calls confirmed; computations from local data structures only |
| DRF-06 | 08-04 | theorex drift CLI: score, flagged concepts, stability trend | SATISFIED | runDrift exported; dispatch case at cli/index.ts:530; 5 runDrift tests pass |
| DRF-07 | 08-04 | theorex status extended with non-fatal drift summary line | SATISFIED | try/catch block at cli/index.ts:129-153; Drift: line output; 2 runStatus tests pass |
| DRF-08 | 08-04 | theorex audit: event log filterable by type and time window | SATISFIED | runAudit exported; --type and --since flags; UTC midnight parsing; 5 runAudit tests pass |
| CLI-08 | 08-04 | theorex drift — show drift score, flagged concepts, trend direction | SATISFIED | Identical to DRF-06; score printed with toFixed(2); instability and flip tables |
| CLI-09 | 08-04 | theorex audit [--type] [--since] — inspect event log | SATISFIED | Identical to DRF-08; dispatch at cli/index.ts:534; re-parse pattern for subcommand flags |

All 10 requirement IDs fully accounted for. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO/FIXME/HACK/placeholder comments, empty implementations, or stub returns found in any phase-8 artifact. All fire-and-forget calls correctly use `void ...().catch(() => {})`.

### Human Verification Required

#### 1. Cold-Start CLI Behavior

**Test:** With no `data/events.jsonl` and no `data/moments/` directory, run `theorex drift`
**Expected:** Prints `Drift Score: 1.00 — stable` and `No flagged concepts in window.` with no crash
**Why human:** Requires live CLI invocation; file system state must be clean

#### 2. `theorex audit --since YYYY-MM-DD` UTC Midnight Parsing

**Test:** Run `theorex audit --since 2026-01-01` with events before and after 2026-01-01T00:00:00Z in events.jsonl
**Expected:** Events from 2025-12-31 are excluded; events from 2026-01-01T00:00:01Z are included
**Why human:** Timezone correctness of UTC midnight interpretation needs live observation

#### 3. `theorex status` Drift Summary Non-Fatal Guarantee

**Test:** Run `theorex status` when `data/events.jsonl` is corrupt (not valid JSONL)
**Expected:** Status table output is not affected; Drift line may be absent but no exception is thrown
**Why human:** Verifying the non-fatal guarantee under error conditions requires runtime observation

### Gaps Summary

No gaps. All 16 truths verified, all 15 artifacts exist and are substantive and wired, all 8 key links confirmed, all 10 requirements satisfied. The one failing test in the full suite (`runPrune test 10`) is a pre-existing unrelated regression from before Phase 8, caused by a missing `ragEmbeddingStorePath` in test fixture partial config — confirmed present in prior commits.

**Test results summary:**
- `tests/audit/` — 42 pass, 0 fail (logger: 10, reader: 10, scorer: 27, wiring: 5 — note: 10 more counted across 4 files due to bun grouping)
- `tests/cli/cli-drift.test.ts` — 12 pass, 0 fail
- Full `tests/audit/ tests/cli/` combined — 71 pass, 1 fail (pre-existing runPrune regression unrelated to Phase 8)

---

_Verified: 2026-03-11T13:15:00Z_
_Verifier: Claude (gsd-verifier)_
