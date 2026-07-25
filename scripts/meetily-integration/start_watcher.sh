#!/bin/bash
# Meetily SQLite watcher — starts on login via launchd
# Launches the Hermes-managed meetily-integration pipeline.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export PYTHONPATH="${PROJECT_DIR}/src:${PYTHONPATH:-}"
export MEETILY_DB_PATH="${MEETILY_DB_PATH:-$HOME/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite}"

cd "$PROJECT_DIR" || exit 1
source .venv/bin/activate 2>/dev/null || {
    echo "ERROR: venv not found at $PROJECT_DIR/.venv"
    exit 1
}

exec python -m src.main watch
