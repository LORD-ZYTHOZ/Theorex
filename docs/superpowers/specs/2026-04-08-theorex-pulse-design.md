# Theorex Pulse — Design Spec
_2026-04-08_

## Problem

Theorex is pull-only. m1 agents read from Theorex at session start but Theorex has no way to tell agents their knowledge has changed. When dream_ingest, session-end synthesis, or nightly evolve-review writes new concepts to Postgres, agents don't know until their next boot — and even then they don't know _what_ changed.

## Goal

When Theorex writes concepts to Postgres, the relevant agent's workspace on m1 gets a `PULSE.md` file within 10 seconds. Agent reads it on next boot. Bidirectional link established.

## Architecture

```
[Theorex MCP on m4]
    ↓ writes concepts
[Postgres on m1 — localhost to Pulse daemon]
    ↓ trg_concept_new → pg_notify('concept_new', payload)
[pulse-daemon.py — PM2 on m1, always-on]
    ↓ batches events per agent (10s window)
~/.openclaw/workspace/{agent}/PULSE.md
```

No cross-machine HTTP. No polling. No Telegram. Postgres is local to m1 so LISTEN is a local socket call.

## Components

### 1. SQL Trigger (Theorex migration)

New migration in `scripts/migrations/008-pulse-trigger.sql`:

```sql
CREATE OR REPLACE FUNCTION notify_concept_new()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'concept_new',
    json_build_object(
      'agent_id', NEW.agent_id,
      'wing',     NEW.wing,
      'label',    NEW.label,
      'memory_type', NEW.memory_type,
      'inserted_at', now()
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_concept_new
AFTER INSERT ON concepts
FOR EACH ROW EXECUTE FUNCTION notify_concept_new();
```

### 2. pulse-daemon.py (m1)

Location: `~/.openclaw/workspace/bridge/pulse-daemon.py`

Responsibilities:
- Connect to local Postgres (same credentials as Theorex uses)
- `LISTEN concept_new`
- Buffer incoming events per `agent_id` for 10 seconds
- On flush: write `PULSE.md` to `~/.openclaw/workspace/{agent}/`
- Reconnect automatically on connection loss

PULSE.md format:
```
# Pulse — {agent_id}
Last updated: {ISO timestamp}

## New concepts since last boot
- {count} concept(s) added to {wing}
  Latest: {label} ({memory_type})
```

### 3. PM2 registration (m1)

Added to m1 ecosystem or via direct `pm2 start`:
```
pm2 start pulse-daemon.py --name pulse-daemon --interpreter python3 --restart-delay 5000
pm2 save
```

## Event Routing

| Trigger source | agent_id in payload | PULSE.md written to |
|---|---|---|
| dream_ingest.py | parsed from DREAMS.md section | `workspace/{agent}/` |
| theorex-session-end | passed via CLI arg | `workspace/{agent}/` |
| theorex-nightly | all agents in loop | `workspace/{agent}/` each |
| any direct MCP ingest | from MCP call params | `workspace/{agent}/` |

## What We Skip

- No SSE endpoint on Theorex
- No reverse HTTP push m4→m1
- No Telegram notifications
- No axon JSON files (deprecated, fully on Postgres)
- No new MCP tools

## Success Criteria

- Concept inserted on m4 → PULSE.md written on m1 within 10 seconds
- Daemon survives Postgres restart (reconnects automatically)
- Daemon survives own crash (PM2 restarts it)
- Multiple rapid inserts batched into one PULSE.md write per agent
- Works for all event sources: dream_ingest, session-end, nightly, direct MCP
