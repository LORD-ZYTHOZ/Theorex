# Post-Session Review Protocol — Multi-Engine Deliberation Channel

Three engines, three perspectives, one debrief. Extract what the overlap teaches.

## Overview

A structured post-session debrief protocol where three trading engines — Singularity (micro/technicals), Divergent (macro/sentiment), and Horizon (predictions) — review completed sessions from their own perspective, cross-reference their views, and extract institutional knowledge that no single engine could reach alone.

The value lives in the disagreements: when engines conflict, the resolution teaches something. When they align and still lose, there's a shared blind spot. When one saw something the others missed, that's a gap to close.

## Engines

| Engine | Lens | What it knows | What it ignores |
|--------|------|---------------|-----------------|
| **Singularity** | Micro / Technicals | Price structure, session profiles, sweep + OB patterns, SL/TP execution | Why gold moves, macro context |
| **Divergent** | Macro / Sentiment | VIX, SPX, regime voting (5 LLM personas), market feeling | Chart structure, entry timing |
| **Horizon** | Predictions | Probabilistic forecasts, accuracy tracking | Real-time execution, sentiment |

All three run on M1. VPS receives signals only.

## Debrief Cycle

### Round 0 — Data Collection (automated)

Pull raw session data from each engine into a single **session packet** — one JSON blob per session. Agents narrate from data, not memory.

| Source | Data | Location |
|--------|------|----------|
| Singularity | Trades taken, P&L, setups triggered/skipped, SL/TP hits, session profile used | `logs/latent_trades.jsonl` + `profiles/sessions/` |
| Divergent | 5 persona regime votes, consensus strength, VIX/SPX snapshot, regime classification | Divergent session report (schema TBD) |
| Horizon | Predictions issued, predicted direction/magnitude, actual outcome, accuracy score | Horizon prediction log (schema TBD) |

### Round 1 — Perspective Reports (3x dispatch to Qwen3 32B)

Each engine produces a structured take on the session from its own lens. One dispatch per engine, all receive the full session packet but respond from their perspective only.

- **Singularity voice:** What did price do? What setups triggered? What hit/missed? Sweep quality, OB reactions, SL distances.
- **Divergent voice:** What was the regime? How did the 5 personas vote? Was sentiment aligned or divergent with price action?
- **Horizon voice:** What did we predict? How accurate was the forecast vs what actually happened?

### Round 2 — Cross-Reference (1x dispatch to Qwen3 32B)

An orchestrator prompt reads all three perspective reports and surfaces:

- **Alignments** — all three agreed and the outcome confirmed it
- **Conflicts** — engines disagreed, which one was right and why
- **Blind spots** — something happened that none of them flagged
- **Missed opportunities** — setup existed but filters blocked it

### Step 3 — Takeaway Extraction (post-processing, no LLM dispatch)

Specific, testable insights parsed from the cross-reference output. Not "be more careful" but:

- "Singularity BUY setups during Divergent bearish consensus lost 4/5 this week"
- "Horizon predicted the LDN reversal 2 hours early, Singularity had no sweep setup yet — timing gap"
- "All three aligned bullish and the trade hit TP — this alignment pattern has won 7/8"

Takeaways get written to agent axons via `batchWriteToAgent()`. They decay naturally. If they persist across sessions, they promote to shared-axon as institutional knowledge.

## Data Model

### Common Types

```typescript
type TradingSession = "LDN" | "NY" | "ASIA";
type DeliberationStatus = "complete" | "partial" | "failed";
```

### Session Packet

```typescript
type SessionPacket = {
  readonly id: string;               // UUID
  readonly date: string;             // ISO 8601 date
  readonly session: TradingSession;
  readonly collected_at: string;     // ISO 8601 timestamp
  readonly singularity: SingularityReport;
  readonly divergent: DivergentReport | null;   // null if unavailable
  readonly horizon: HorizonReport | null;       // null if unavailable
};
```

### Singularity Session Report

```typescript
type SingularityReport = {
  readonly session_profile: string;          // e.g. "london_buy_mon"
  readonly trades: ReadonlyArray<{
    readonly direction: "BUY" | "SELL";
    readonly entry_time: string;
    readonly exit_time: string;
    readonly entry_price: number;
    readonly exit_price: number;
    readonly sl_distance: number;
    readonly rr_ratio: number;
    readonly outcome: "TP" | "SL" | "BE" | "OPEN";
    readonly pnl: number;
    readonly setup_type: string;             // "sweep_ob", "bos_retest", etc.
  }>;
  readonly setups_triggered: number;
  readonly setups_skipped: number;
  readonly session_pnl: number;
  readonly win_rate: number;
};
```

### Divergent Session Report

```typescript
type DivergentReport = {
  readonly regime: string;                   // "risk_on" | "risk_off" | "neutral" | "transitioning"
  readonly persona_votes: ReadonlyArray<{
    readonly persona: string;                // persona identifier
    readonly vote: "bullish" | "bearish" | "neutral";
    readonly confidence: number;             // 0.0 - 1.0
    readonly reasoning: string;
  }>;
  readonly consensus_strength: number;       // 0.0 - 1.0
  readonly consensus_direction: "bullish" | "bearish" | "neutral";
  readonly vix_snapshot: number;
  readonly spx_snapshot: number;
  readonly macro_context: string;            // brief summary
};
```

### Horizon Session Report

```typescript
type HorizonReport = {
  readonly predictions: ReadonlyArray<{
    readonly predicted_at: string;           // ISO 8601
    readonly direction: "up" | "down" | "flat";
    readonly magnitude: string;              // "small" | "medium" | "large"
    readonly confidence: number;             // 0.0 - 1.0
    readonly actual_direction: "up" | "down" | "flat";
    readonly actual_magnitude: string;
    readonly accurate: boolean;
  }>;
  readonly overall_accuracy: number;         // 0.0 - 1.0
  readonly prediction_count: number;
};
```

### Perspective Report

```typescript
type PerspectiveReport = {
  readonly engine: string;
  readonly key_observations: ReadonlyArray<string>;
  readonly session_grade: "strong" | "mixed" | "weak" | "no_data";
  readonly notable_events: ReadonlyArray<string>;
  readonly narrative: string;                // free-text analysis
};
```

### Deliberation Record

```typescript
type DeliberationRecord = {
  readonly version: 1;
  readonly id: string;                       // UUID
  readonly date: string;                     // ISO 8601 date
  readonly session: TradingSession;
  readonly status: DeliberationStatus;
  readonly created_at: string;               // ISO 8601 timestamp
  readonly session_packet: SessionPacket;
  readonly perspectives: {
    readonly singularity: PerspectiveReport | null;
    readonly divergent: PerspectiveReport | null;
    readonly horizon: PerspectiveReport | null;
  };
  readonly cross_reference: {
    readonly alignments: ReadonlyArray<string>;
    readonly conflicts: ReadonlyArray<string>;
    readonly blind_spots: ReadonlyArray<string>;
    readonly missed_opportunities: ReadonlyArray<string>;
  } | null;                                  // null if orchestrator failed
  readonly takeaways: ReadonlyArray<{
    readonly insight: string;
    readonly test_condition: string | null;   // concrete condition that would disprove this
    readonly engines_involved: ReadonlyArray<string>;
    readonly confidence: number;             // 0.0 - 1.0
  }>;
};
```

## Storage

- Deliberation records: `data/deliberations/{date}-{session}.json` (immutable, atomic tmp→rename)
- Takeaways: written to agent axons via `writeToAgent()`, decay naturally
- High-confidence takeaways: promote to shared-axon via existing promotion pipeline
- Session packets: embedded in deliberation record (self-contained)

## Integration Points

### Trigger

Hooks into Singularity's existing loop — runs after the digest cycle completes (10 min post-session close). Can also be triggered manually via CLI or MCP.

### Dispatch

All inference dispatched to Qwen3 32B on M1 via existing `dispatch()` worker. Four **sequential** dispatches per deliberation (sequential to avoid EventBus `inFlight` key collision on `agent_id`):
1. Singularity perspective prompt
2. Divergent perspective prompt
3. Horizon perspective prompt
4. Orchestrator cross-reference prompt

Requires `DispatchTask` to accept an optional `max_tokens` field (default 1024 is insufficient for perspective reports — deliberation dispatches use 4096).

### Failure Policy

- **Round 1:** If a perspective dispatch fails/times out, log it and continue with available perspectives. Record `null` for the missing perspective in the `DeliberationRecord`.
- **Round 2:** If the orchestrator fails, write a partial record (`status: "partial"`) with perspectives only, no cross-reference.
- **Deduplication:** Before starting, check if `data/deliberations/{date}-{session}.json` exists. Skip if it does (or require `--force` flag).

### Token Budget

Session packets can grow large on heavy trading days. Before dispatch, the packet is condensed:
- Singularity: max 20 trades (most recent), summary stats for the rest
- Divergent: full (persona votes are fixed-size)
- Horizon: max 10 predictions (most recent)

Full data stays in the stored record; condensed version goes to the LLM.

### EventBus

New event types added to `BusEventType` union and `BusEventPayloadMap`:

- `DELIBERATION_START` — `{ deliberation_id: string, session: TradingSession, date: string }`
- `DELIBERATION_ROUND` — `{ deliberation_id: string, round: number, engine?: string, success: boolean }`
- `DELIBERATION_COMPLETE` — `{ deliberation_id: string, status: DeliberationStatus, takeaway_count: number }`

### Axon

Takeaways written as concepts with:
- `source: "deliberation"`
- `session: "LDN"` (etc.)
- `engines: ["singularity", "divergent"]` (which engines contributed)
- Standard decay scoring applies

### MCP Tools

- `deliberate` — trigger a deliberation for a specific session/date
- `deliberation_history` — query past deliberations by date range or session

### CLI

```bash
theorex deliberate --session LDN --date 2026-03-24    # manual trigger
theorex deliberate --latest                            # debrief most recent session
theorex deliberations --since 2026-03-20               # list recent deliberations
```

## Output Channels

Every deliberation produces three outputs across three surfaces:

### 1. Telegram Summary (immediate, mobile)

Posted to your existing Telegram bot after each deliberation completes. Condensed format:

```
📊 LDN Debrief — 2026-03-24

Trades: 3W / 1L | Session P&L: +2.4R
Regime: risk_off (4/5 bearish, 0.82 consensus)
Horizon: 2/3 predictions accurate

⚡ Conflicts:
• Singularity took BUY #2 against Divergent bearish consensus → SL hit

💡 Top Takeaways:
• BUY setups against strong bearish consensus (>0.8) lost 4/5 this week
• Horizon called the reversal 90min before Singularity had a setup

Status: complete | 5 takeaways extracted
```

### 2. Markdown Debrief (terminal-readable, audit trail)

Human-readable debrief at `data/deliberations/{date}-{session}.md`. Readable directly from the terminal on M1 when SSHed in — no browser needed. Contains the three perspective narratives, cross-reference findings, and takeaways in plain markdown. Doubles as an audit trail.

### 3. JSON Record (persistent, queryable)

Full `DeliberationRecord` at `data/deliberations/{date}-{session}.json`. Contains the complete session packet, all three perspective reports, cross-reference, and structured takeaways. This is the source of truth.

### 4. Theorex Web UI (visual, historical)

New deliberation tab on the dashboard at `127.0.0.1:7777`:
- Timeline of past deliberations
- Click into any debrief to see perspectives, conflicts, takeaways
- Filter by session (LDN/NY/ASIA), date range, or engine
- Highlight recurring takeaways that promoted to shared-axon

## Build List

### Pre-requisites (engine output schemas)

1. Singularity session report extractor — parse `latent_trades.jsonl` into `SingularityReport`
2. Divergent session report schema — define and implement `DivergentReport` output
3. Horizon session report schema — define and implement `HorizonReport` output

### Core (in Theorex)

4. Session packet builder — collect three reports into `SessionPacket`
5. Perspective prompt templates — three structured prompts, one per engine voice
6. Orchestrator prompt template — cross-reference the three perspectives
7. Takeaway extractor — parse orchestrator output into structured takeaways
8. Deliberation record writer — atomic write of `DeliberationRecord` to `data/deliberations/`
9. CLI command — `theorex deliberate`
10. MCP tool — `deliberate` + `deliberation_history`

### Output

11. Markdown debrief writer — render deliberation as readable markdown to `data/deliberations/{date}-{session}.md`
12. Telegram summary formatter — condense deliberation into mobile-friendly message, post via Singularity's existing Telegram bridge
13. Web UI deliberation panel — timeline view, detail view, filters

### Integration

14. Singularity loop hook — trigger deliberation after digest cycle
15. Axon integration — takeaways → `batchWriteToAgent()` → decay → promote

## Retention

Deliberation files kept for 90 days. Older files archived to `data/deliberations/archive/` (compressed). Takeaways in the axon decay naturally via existing scoring.
