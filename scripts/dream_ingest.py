#!/usr/bin/env python3
"""
dream_ingest.py — Read OC dreaming Deep phase promotions from DREAMS.md
and ingest them into Theorex via the ingest_dream MCP tool.

Runs nightly on m1 after dreaming completes (3:30 AM cron).
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

DREAMS_MD = "/Users/claw/.openclaw/memory/DREAMS.md"
CHECKPOINT_FILE = "/Users/claw/.openclaw/memory/.dreams/ingest_checkpoint.json"
THEOREX_URL = "http://10.10.0.1:18800/mcp"
API_KEY = "kI7TKs8icME9w9IfTxmLZAjB2U9x_8E47Z24w3eCzmpRIG9gXGRx_sg4uyWkyPh7"
DEFAULT_AGENT_ID = "main"
LOG_PREFIX = "[dream_ingest]"


def log(msg: str) -> None:
    print(f"{LOG_PREFIX} {msg}", flush=True)


def load_checkpoint() -> int:
    """Return the last processed line number (0 if no checkpoint exists)."""
    path = Path(CHECKPOINT_FILE)
    if not path.exists():
        return 0
    try:
        data = json.loads(path.read_text())
        return int(data.get("last_processed_line", 0))
    except (json.JSONDecodeError, ValueError, OSError) as exc:
        log(f"Warning: could not read checkpoint ({exc}), starting from line 0")
        return 0


def save_checkpoint(line_count: int) -> None:
    """Write the new checkpoint after successful processing."""
    path = Path(CHECKPOINT_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"last_processed_line": line_count}, indent=2))


def parse_agent_id(section_header: str, preceding_lines: list[str]) -> str:
    """
    Try to extract agent ID from:
    - '## Deep Sleep (meridian)'
    - Lines like 'Agent: secretarius' before the section
    Fall back to DEFAULT_AGENT_ID.
    """
    # Check section header for parenthesised agent name: ## Deep Sleep (meridian)
    match = re.search(r"\((\w[\w-]*)\)", section_header)
    if match:
        return match.group(1).lower()

    # Scan preceding lines (up to 10) for 'Agent: <name>'
    for line in reversed(preceding_lines[-10:]):
        agent_match = re.match(r"^\s*Agent:\s*(\w[\w-]*)\s*$", line, re.IGNORECASE)
        if agent_match:
            return agent_match.group(1).lower()

    return DEFAULT_AGENT_ID


def extract_promotions(lines: list[str]) -> list[tuple[str, str]]:
    """
    Parse lines for ## Deep Sleep sections and return
    a list of (promotion_text, agent_id) tuples.
    """
    promotions: list[tuple[str, str]] = []
    in_deep_sleep = False
    current_agent = DEFAULT_AGENT_ID

    for i, line in enumerate(lines):
        stripped = line.rstrip()

        # Detect any ## heading
        if stripped.startswith("## "):
            if re.match(r"^## Deep Sleep", stripped, re.IGNORECASE):
                in_deep_sleep = True
                current_agent = parse_agent_id(stripped, lines[:i])
            else:
                in_deep_sleep = False
            continue

        # Detect higher-level headings (# Title)
        if stripped.startswith("# "):
            in_deep_sleep = False
            continue

        # Collect promotion items inside a Deep Sleep block
        if in_deep_sleep and stripped.startswith("- "):
            promotion_text = stripped[2:].strip()
            if promotion_text:
                promotions.append((promotion_text, current_agent))

    return promotions


def call_ingest_dream(content: str, agent_id: str) -> bool:
    """
    POST ingest_dream to Theorex MCP.
    Returns True on success, False on failure.
    """
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "ingest_dream",
            "arguments": {
                "content": content,
                "agentId": agent_id,
                "source": "dream_deep",
            },
        },
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        THEOREX_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            response_data = json.loads(resp.read())
            # Check for JSON-RPC error
            if "error" in response_data:
                err = response_data["error"]
                log(f"  MCP error for '{content[:60]}...': {err}")
                return False
            return True
    except urllib.error.URLError as exc:
        raise ConnectionError(f"Theorex unreachable: {exc}") from exc
    except (json.JSONDecodeError, OSError) as exc:
        log(f"  Response parse error for '{content[:60]}': {exc}")
        return False


def main() -> int:
    dreams_path = Path(DREAMS_MD)

    if not dreams_path.exists():
        log("DREAMS.md not found — dreaming hasn't run yet, exiting cleanly")
        return 0

    last_line = load_checkpoint()

    all_lines = dreams_path.read_text().splitlines()
    total_lines = len(all_lines)

    new_lines = all_lines[last_line:]
    if not new_lines:
        log("No new lines since last checkpoint, nothing to process")
        return 0

    promotions = extract_promotions(new_lines)

    if not promotions:
        log(f"No Deep Sleep promotions found in {len(new_lines)} new lines")
        save_checkpoint(total_lines)
        return 0

    log(f"Found {len(promotions)} promotion(s) to ingest")

    # Attempt to reach Theorex before iterating; bail entirely if unreachable
    # (checkpoint not updated so next run retries)
    processed = 0
    failed = 0

    try:
        for content, agent_id in promotions:
            success = call_ingest_dream(content, agent_id)
            if success:
                processed += 1
                log(f"  Ingested [{agent_id}]: {content[:80]}")
            else:
                failed += 1
                log(f"  Skipped (ingest rejected) [{agent_id}]: {content[:80]}")
    except ConnectionError as exc:
        log(f"ERROR: {exc} — checkpoint NOT updated, will retry next run")
        return 1

    # Update checkpoint even when some individual ingests failed (they are skipped,
    # not retried, so we advance past them)
    save_checkpoint(total_lines)
    log(
        f"Processed {processed} promotion(s), skipped {failed} "
        f"(checkpoint advanced to line {total_lines})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
