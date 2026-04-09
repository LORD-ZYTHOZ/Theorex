#!/usr/bin/env python3
"""
pulse-daemon.py — Theorex Pulse: LISTEN for concept events, write PULSE.md per agent.

Channels:
  concept_new            — individual concept INSERT (batched per agent, 10s window)
  boot_inject_complete   — shared context refresh (writes SHARED_PULSE.md)
  dream_ingest_complete  — nightly dream batch done (writes agent PULSE.md)

Runs as a PM2 process on m1. Reconnects automatically on connection loss.
"""

import json
import os
import select
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extensions

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PG_HOST     = os.environ.get("THEOREX_PG_HOST", "localhost")
PG_PORT     = int(os.environ.get("THEOREX_PG_PORT", "5432"))
PG_USER     = os.environ.get("THEOREX_PG_USER", "claw")
PG_DB       = os.environ.get("THEOREX_PG_DB", "theorex")
WORKSPACE   = Path(os.environ.get("OC_WORKSPACE", Path.home() / ".openclaw/workspace"))
BATCH_SECS  = 10       # flush window per agent
RECONNECT_SECS = 5     # wait before reconnecting after error

LISTEN_CHANNELS = ["concept_new", "boot_inject_complete", "dream_ingest_complete"]

LOG_PREFIX = "[pulse]"


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"{LOG_PREFIX} {ts} {msg}", flush=True)


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

MAX_PENDING_PER_AGENT = 100  # force flush if batch grows too large


def write_pulse(agent_id: str, events: list[dict]) -> None:
    agent_dir = WORKSPACE / agent_id
    try:
        agent_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        log(f"  [WARN] cannot create workspace for {agent_id}: {agent_dir}")
        return

    pulse_path = agent_dir / "PULSE.md"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Group by wing
    by_wing: dict[str, list[dict]] = defaultdict(list)
    for ev in events:
        wing = ev.get("wing") or "unknown"
        by_wing[wing].append(ev)

    lines = [
        f"# Pulse — {agent_id}",
        f"_Last updated: {now}_",
        "",
        f"## {len(events)} new concept(s) since last boot",
        "",
    ]
    for wing, wing_events in by_wing.items():
        lines.append(f"### {wing} ({len(wing_events)})")
        for ev in wing_events[-5:]:  # show last 5 per wing
            label = ev.get("label", "unlabelled")
            mtype = ev.get("memory_type", "")
            lines.append(f"- {label}  `{mtype}`")
        if len(wing_events) > 5:
            lines.append(f"- _...and {len(wing_events) - 5} more_")
        lines.append("")

    pulse_path.write_text("\n".join(lines))
    log(f"  wrote PULSE.md → {agent_id} ({len(events)} concepts, {len(by_wing)} wing(s))")


def write_shared_pulse(payload: dict) -> None:
    """Write SHARED_PULSE.md — notifies all agents that boot context was refreshed."""
    shared_pulse_path = WORKSPACE / "theorex" / "SHARED_PULSE.md"
    try:
        shared_pulse_path.parent.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        log(f"  [WARN] cannot create theorex workspace dir")
        return

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    concepts = payload.get("concepts", "?")
    agent_count = payload.get("agent_count", "?")
    duration_ms = payload.get("duration_ms", "?")
    fired_at = payload.get("fired_at", now)

    lines = [
        "# Shared Context — Boot Inject Complete",
        f"_Refreshed: {fired_at}_",
        "",
        f"- **{concepts}** active concepts promoted",
        f"- **{agent_count}** agents covered",
        f"- Generated in {duration_ms}ms",
        "",
        "_Read SHARED_CONTEXT.md for the full injected context._",
    ]
    shared_pulse_path.write_text("\n".join(lines))
    log(f"  wrote SHARED_PULSE.md ({concepts} concepts, {agent_count} agents)")


def write_dream_pulse(agent_id: str, payload: dict) -> None:
    """Append dream ingest completion notice to agent's PULSE.md."""
    agent_dir = WORKSPACE / agent_id
    try:
        agent_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        log(f"  [WARN] cannot create workspace for {agent_id}: {agent_dir}")
        return

    pulse_path = agent_dir / "PULSE.md"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    count = payload.get("count", "?")
    fired_at = payload.get("fired_at", now)

    section = (
        f"\n## Dream Ingest Complete — {fired_at}\n"
        f"\n- **{count}** dream promotion(s) ingested from DREAMS.md\n"
        f"- Source: `dream_deep` (nightly cron)\n"
    )

    # Append to existing PULSE.md if present, otherwise create
    existing = pulse_path.read_text() if pulse_path.exists() else f"# Pulse — {agent_id}\n_Last updated: {now}_\n"
    pulse_path.write_text(existing.rstrip() + "\n" + section)
    log(f"  wrote dream pulse → {agent_id} ({count} promotions)")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run() -> None:
    log("starting — connecting to Postgres...")

    # pending survives reconnects — events buffered during outage are preserved
    pending: dict[str, tuple[float, list[dict]]] = {}

    while True:
        conn = None
        try:
            conn = psycopg2.connect(
                host=PG_HOST, port=PG_PORT, user=PG_USER, dbname=PG_DB
            )
            conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
            cur = conn.cursor()
            for channel in LISTEN_CHANNELS:
                cur.execute(f"LISTEN {channel};")
            log(f"connected to {PG_DB}@{PG_HOST}, LISTENing on {', '.join(LISTEN_CHANNELS)}")

            while True:
                # Wait up to 2s for a notification
                readable, _, _ = select.select([conn], [], [], 2.0)
                if readable:
                    conn.poll()
                    while conn.notifies:
                        notify = conn.notifies.pop(0)
                        if not notify.payload:
                            continue
                        try:
                            payload = json.loads(notify.payload)
                        except (json.JSONDecodeError, ValueError, TypeError):
                            log(f"  [WARN] bad payload on {notify.channel}: {str(notify.payload)[:100]}")
                            continue

                        channel = notify.channel

                        if channel == "concept_new":
                            agent_id = payload.get("agent_id") or "main"
                            if agent_id not in pending:
                                pending[agent_id] = (time.monotonic(), [])
                            pending[agent_id][1].append(payload)
                            log(f"  recv concept_new: agent={agent_id} label={payload.get('label','?')}")

                            # Force flush if batch is too large
                            if len(pending[agent_id][1]) >= MAX_PENDING_PER_AGENT:
                                _, events = pending.pop(agent_id)
                                write_pulse(agent_id, events)

                        elif channel == "boot_inject_complete":
                            log(f"  recv boot_inject_complete: concepts={payload.get('concepts','?')}")
                            write_shared_pulse(payload)

                        elif channel == "dream_ingest_complete":
                            agent_id = payload.get("agent_id") or "main"
                            log(f"  recv dream_ingest_complete: agent={agent_id} count={payload.get('count','?')}")
                            write_dream_pulse(agent_id, payload)

                # Flush agents whose batch window has elapsed
                now = time.monotonic()
                ready = [a for a, (t, _) in pending.items() if now - t >= BATCH_SECS]
                for agent_id in ready:
                    _, events = pending.pop(agent_id)
                    write_pulse(agent_id, events)

        except Exception as exc:
            log(f"error: {exc} — reconnecting in {RECONNECT_SECS}s")
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
            time.sleep(RECONNECT_SECS)


if __name__ == "__main__":
    run()
