#!/usr/bin/env bash
set -euo pipefail

hermes_home="${HERMES_HOME:-$HOME/.hermes}"
queue="${HERMES_AGENT_READY_QUEUE:-$hermes_home/agent-ready/queue.md}"
mkdir -p "$(dirname "$queue")"
touch "$queue"

python3 - "$queue" <<'PY'
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import os
import re
import subprocess
import sys

queue = Path(sys.argv[1])
text = queue.read_text(encoding="utf-8") if queue.exists() else ""

if "# Agent-ready queue" not in text:
    text = "# Agent-ready queue\n\n## Pending\n\n## In progress\n\n## Completed\n\n"

pending_match = re.search(r"^## Pending\s*\n(.*?)(?=^##\s)", text, re.MULTILINE | re.DOTALL)
if not pending_match:
    sys.exit(0)

pending = pending_match.group(1).strip()
blocks = [b.strip() for b in re.split(r"(?=^###\s+\d+\.\s+)", pending, flags=re.MULTILINE) if b.strip()]
if not blocks:
    sys.exit(0)

block = blocks[0]
first = block.splitlines()[0]
title = re.sub(r"^###\s+\d+\.\s*", "", first).strip()
remaining_pending = "\n".join(blocks[1:]).strip()
new_pending = remaining_pending + ("\n" if remaining_pending else "")
new_text = text[: pending_match.start(1)] + new_pending + text[pending_match.end(1) :]

hermes_bin = os.environ.get("HERMES_BIN", "hermes")
workdir = os.environ.get("HERMES_QUEUE_WORKDIR", os.path.expanduser("~"))
prompt = f"""Process this agent-ready queue item. Do not ask clarifying questions unless the item is ambiguous or requires user authorization.

Task: {title}

Item:
{block}

Rules:
- Load relevant skills: loop-control, edgegde-verification-gates, agent-ready-queue.
- For EdgeGDE tasks, load edgegde-core and use .hermes/instructions.md plus ARCHITECTURE.md when present.
- No deploy, no main push, no secrets, and no destructive commands.
- If the same command/test fails twice with the same root cause, stop and switch strategy.
- Verify with the item's verification commands, then run git diff --check when in a git repo.
- Update the queue: move completed work under Completed; keep unfinished or blocked work in Pending.
- Deliver a concise result.
"""

cmd = [hermes_bin, "-w", "chat", "-q", prompt]
started = datetime.now().strftime("%Y-%m-%d %H:%M")
try:
    result = subprocess.run(cmd, cwd=workdir)
    status = "completed" if result.returncode == 0 else "failed"
except Exception as exc:
    print(f"Failed to start Hermes queue worker: {exc}", file=sys.stderr)
    sys.exit(1)

completed_entry = f"### {started} — {title} — {status}\n"
completed_match = re.search(r"^## Completed\s*\n", new_text, re.MULTILINE)
if completed_match:
    insert_at = completed_match.end()
    new_text = new_text[:insert_at] + completed_entry + "\n" + new_text[insert_at:]
else:
    new_text += "\n## Completed\n\n" + completed_entry + "\n"

queue.write_text(new_text, encoding="utf-8")
sys.exit(result.returncode)
PY
